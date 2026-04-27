import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTranscriptChunks,
  parseJsonOutput,
  shouldSkipJob,
  mergeEpisodeSources,
  toUiKnowledgeBase,
  validateEpisodeExtraction,
  validateLessonClusterFile,
} from "./lesson-extraction.mjs";

const episode = {
  id: "episode-one",
  podcastId: "acquiring-minds",
  title: "Episode One",
  guest: "Guest",
  date: "2026-01-01",
  officialUrl: "https://example.test/episode-one",
  youtubeUrl: "https://youtube.test/watch?v=one",
  audioUrl: "https://example.test/audio.mp3",
};

function validEvidence(overrides = {}) {
  return {
    episodeId: "episode-one",
    timestamp: "00:01:00",
    end: "00:02:00",
    sourceProvider: "official",
    officialUrl: episode.officialUrl,
    youtubeUrl: episode.youtubeUrl,
    audioUrl: episode.audioUrl,
    ...overrides,
  };
}

function validEpisodeExtraction(overrides = {}) {
  return {
    schemaVersion: "1",
    promptVersion: "episode-extraction-v1",
    episode,
    businessProfile: { industry: "services", businessModel: "B2B" },
    acquisitionProfile: { dealType: "self-funded search" },
    operatingProfile: { growthLevers: ["pricing"] },
    risks: ["customer concentration"],
    notableClaims: [{
      id: "claim-one",
      claim: "Pricing discipline mattered after close.",
      confidence: "high",
      evidence: [validEvidence()],
    }],
    lessonCandidates: [{
      id: "lesson-one",
      title: "Pricing is an early operating lever",
      category: "operating",
      summary: "Small companies can have obvious pricing gaps that a new owner can fix.",
      playbook: ["Audit stale pricing before adding new channels."],
      tags: ["pricing", "first year"],
      confidence: "medium",
      evidence: [validEvidence()],
    }],
    ...overrides,
  };
}

describe("lesson extraction helpers", () => {
  it("chunks transcripts without reordering segment timestamps", () => {
    const chunks = buildTranscriptChunks({
      episode,
      sources: [],
      segments: [
        { start: "00:00:01", end: "00:00:02", text: "first segment", source: "official" },
        { start: "00:00:03", end: "00:00:04", text: "second segment with more text", source: "official" },
        { start: "00:00:05", end: "00:00:06", text: "third segment", source: "official" },
      ],
    }, { maxChars: 70 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.start)).toEqual(["00:00:01", "00:00:03", "00:00:05"]);
    expect(chunks.flatMap((chunk) => chunk.text.match(/\[00:00:\d\d/g) ?? [])).toEqual([
      "[00:00:01",
      "[00:00:03",
      "[00:00:05",
    ]);
  });

  it("parses fenced model JSON output", () => {
    expect(parseJsonOutput("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
  });

  it("validates episode extractions and rejects unknown categories", () => {
    expect(validateEpisodeExtraction(validEpisodeExtraction()).episode.id).toBe("episode-one");

    expect(() =>
      validateEpisodeExtraction(validEpisodeExtraction({
        lessonCandidates: [{
          ...validEpisodeExtraction().lessonCandidates[0],
          category: "random",
        }],
      })),
    ).toThrow("known lesson category");
  });

  it("rejects transcript-like fields and long quotations", () => {
    expect(() =>
      validateEpisodeExtraction(validEpisodeExtraction({
        lessonCandidates: [{
          ...validEpisodeExtraction().lessonCandidates[0],
          quote: "This field should never be present.",
        }],
      })),
    ).toThrow("transcript text");

    expect(() =>
      validateEpisodeExtraction(validEpisodeExtraction({
        lessonCandidates: [{
          ...validEpisodeExtraction().lessonCandidates[0],
          summary: "\"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six\"",
        }],
      })),
    ).toThrow("long quotation");
  });

  it("skips completed jobs but allows force and retry-failed paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amkb-extraction-test-"));
    const outputPath = join(dir, "episode-one.json");
    await writeFile(outputPath, "{}");

    expect(shouldSkipJob({
      manifest: { jobs: { "episode-one": { state: "completed" } } },
      id: "episode-one",
      outputPath,
    })).toBe(true);
    expect(shouldSkipJob({
      manifest: { jobs: { "episode-one": { state: "completed" } } },
      id: "episode-one",
      outputPath,
      force: true,
    })).toBe(false);
    expect(shouldSkipJob({
      manifest: { jobs: { "episode-one": { state: "failed" } } },
      id: "episode-one",
      outputPath,
    })).toBe(true);
    expect(shouldSkipJob({
      manifest: { jobs: { "episode-one": { state: "failed" } } },
      id: "episode-one",
      outputPath,
      retryFailed: true,
    })).toBe(false);
  });

  it("validates clusters and promotes reviewed lessons into UI shape", () => {
    const clusterFile = {
      schemaVersion: "1",
      promptVersion: "lesson-cluster-v1",
      lessons: [{
        id: "operating-pricing",
        title: "Pricing discipline compounds",
        category: "operating",
        summary: "Pricing can be a simple but high-impact first-year lever.",
        playbook: ["Audit stale pricing."],
        tags: ["pricing"],
        confidence: "high",
        evidence: [validEvidence()],
      }],
    };

    expect(validateLessonClusterFile(clusterFile).lessons).toHaveLength(1);

    const promoted = toUiKnowledgeBase({
      podcast: {
        id: "acquiring-minds",
        title: "Acquiring Minds",
        host: "Will Smith",
        officialUrl: "https://acquiringminds.co",
        episodeIndexUrl: "https://acquiringminds.co/episodes",
        adapters: ["official-acquiring-minds"],
      },
      episodes: [{ ...episode, transcriptAvailability: "official" }],
      lessons: [],
    }, clusterFile);

    expect(promoted.lessons).toEqual([{
      id: "operating-pricing",
      title: "Pricing discipline compounds",
      category: "operating",
      summary: "Pricing can be a simple but high-impact first-year lever.",
      playbook: ["Audit stale pricing."],
      tags: ["pricing"],
      evidence: [{
        episodeId: "episode-one",
        timestamp: "00:01:00",
        officialUrl: episode.officialUrl,
        youtubeUrl: episode.youtubeUrl,
        audioUrl: episode.audioUrl,
      }],
    }]);
  });

  it("merges corpus episode metadata and derives dates from RSS publish timestamps", () => {
    const merged = mergeEpisodeSources([], [{
      ...episode,
      date: "",
      rssPublishedAt: "Tue, 22 Feb 2022 03:00:00 -0500",
      transcriptAvailability: "youtube-auto",
    }]);

    expect(merged).toEqual([{
      id: "episode-one",
      podcastId: "acquiring-minds",
      title: "Episode One",
      guest: "Guest",
      date: "2022-02-22",
      officialUrl: "https://example.test/episode-one",
      youtubeUrl: "https://youtube.test/watch?v=one",
      audioUrl: "https://example.test/audio.mp3",
      transcriptAvailability: "youtube-auto",
    }]);
  });
});
