import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getNextEpisodeForBackfill,
  getSegmentCount,
  getTranscriptDocument,
  insertTranscriptSource,
  markJob,
  openCorpusDb,
  putTranscriptDocument,
  upsertEpisode,
  upsertPodcast,
} from "./corpus-db.mjs";

async function openTempDb() {
  const dir = await mkdtemp(join(tmpdir(), "amkb-db-test-"));
  return openCorpusDb(join(dir, "corpus.sqlite"));
}

const episode = {
  id: "episode-one",
  podcastId: "acquiring-minds",
  title: "Episode One",
  guest: "Guest",
  date: "2026-01-01",
  officialUrl: "https://example.test/episode-one",
  audioUrl: "https://example.test/audio.mp3",
  transcriptAvailability: "unknown",
};

describe("corpus SQLite database", () => {
  it("creates the schema and indexes", async () => {
    const db = await openTempDb();
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map((row) => row.name);

    expect(tables).toEqual(expect.arrayContaining([
      "episodes",
      "podcasts",
      "transcript_jobs",
      "transcript_documents",
      "transcript_segments",
      "transcript_sources",
    ]));
    db.close();
  });

  it("stores and reads transcript documents", async () => {
    const db = await openTempDb();
    upsertPodcast(db);
    putTranscriptDocument(db, {
      episode,
      sources: [{ kind: "official", provider: "official", url: episode.officialUrl }],
      showNotes: ["Show note"],
      highlights: ["Highlight"],
      segments: [{
        id: "official-1",
        start: "00:00:00",
        end: "00:00:10",
        speaker: "Host",
        text: "A concise transcript segment.",
        source: "official",
      }],
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(getSegmentCount(db, episode.id)).toBe(1);
    const document = getTranscriptDocument(db, episode.id);
    expect(document?.showNotes).toEqual(["Show note"]);
    expect(document?.highlights).toEqual(["Highlight"]);
    expect(document?.segments[0]).toMatchObject({
      speaker: "Host",
      source: "official",
      text: "A concise transcript segment.",
    });
    db.close();
  });

  it("selects only missing episodes unless failed retries are requested", async () => {
    const db = await openTempDb();
    upsertPodcast(db);
    upsertEpisode(db, episode);
    upsertEpisode(db, { ...episode, id: "failed-episode", title: "Failed" });
    markJob(db, "failed-episode", {
      state: "failed",
      currentFallbackStep: "missing",
      lastError: "No transcript",
    });

    expect(getNextEpisodeForBackfill(db)?.id).toBe("episode-one");
    markJob(db, "episode-one", {
      state: "failed",
      currentFallbackStep: "missing",
      lastError: "No transcript",
    });
    expect(getNextEpisodeForBackfill(db)).toBeUndefined();
    expect(["episode-one", "failed-episode"]).toContain(getNextEpisodeForBackfill(db, { retryFailed: true })?.id);
    db.close();
  });

  it("records failed source attempts without adding segments", async () => {
    const db = await openTempDb();
    upsertPodcast(db);
    upsertEpisode(db, episode);
    insertTranscriptSource(db, episode.id, {
      kind: "youtube-auto",
      provider: "yt-dlp",
      reason: "YouTube blocked caption download with HTTP 429",
    }, "failed");

    const sources = db.prepare("SELECT * FROM transcript_sources WHERE episode_id = ?").all(episode.id);
    expect(sources).toHaveLength(1);
    expect(sources[0].status).toBe("failed");
    expect(getSegmentCount(db, episode.id)).toBe(0);
    db.close();
  });

  it("attributes segments to the final matching transcript source", async () => {
    const db = await openTempDb();
    upsertPodcast(db);
    putTranscriptDocument(db, {
      episode,
      sources: [
        { kind: "youtube-auto", provider: "youtube-resolve", url: "https://youtu.be/example" },
        { kind: "missing", provider: "youtube", reason: "HTTP 429" },
        { kind: "youtube-auto", provider: "yt-dlp", url: "https://youtu.be/example" },
      ],
      segments: [{
        id: "youtube-auto-1",
        start: "00:00:00",
        end: "00:00:01",
        text: "Caption segment.",
        source: "youtube-auto",
      }],
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    const row = db.prepare(`
      SELECT ts.provider
      FROM transcript_segments seg
      JOIN transcript_sources ts ON ts.id = seg.source_id
      WHERE seg.episode_id = ?
    `).get(episode.id);
    expect(row.provider).toBe("yt-dlp");
    db.close();
  });
});
