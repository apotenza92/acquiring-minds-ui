import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { corpusPaths, ensureCorpusDirs, listTranscriptIds, readEpisodes, transcriptPath } from "./corpus.mjs";
import { nowIso } from "./io.mjs";

export const schemaSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  official_url TEXT,
  episode_index_url TEXT,
  rss_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id),
  title TEXT NOT NULL,
  guest TEXT,
  date TEXT,
  official_url TEXT NOT NULL,
  youtube_url TEXT,
  audio_url TEXT,
  rss_guid TEXT,
  rss_published_at TEXT,
  transcript_availability TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcript_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT,
  model TEXT,
  attempted_at TEXT NOT NULL,
  failure_reason TEXT,
  cache_path TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES transcript_sources(id) ON DELETE SET NULL,
  segment_index INTEGER NOT NULL,
  segment_id TEXT,
  start TEXT NOT NULL,
  end TEXT,
  speaker TEXT,
  text TEXT NOT NULL,
  source_kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcript_documents (
  episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  show_notes_json TEXT NOT NULL,
  highlights_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcript_jobs (
  episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  current_fallback_step TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_episode ON transcript_sources(episode_id);
CREATE INDEX IF NOT EXISTS idx_segments_episode ON transcript_segments(episode_id, segment_index);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON transcript_jobs(state);
`;

export async function openCorpusDb(path = corpusPaths.database) {
  await ensureCorpusDirs();
  const db = new DatabaseSync(path);
  db.exec(schemaSql);
  return db;
}

export function hasCorpusDb(path = corpusPaths.database) {
  return existsSync(path);
}

export function upsertPodcast(db, podcast = {}) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO podcasts (id, title, official_url, episode_index_url, rss_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      official_url = excluded.official_url,
      episode_index_url = excluded.episode_index_url,
      rss_url = excluded.rss_url,
      updated_at = excluded.updated_at
  `).run(
    podcast.id ?? "acquiring-minds",
    podcast.title ?? "Acquiring Minds",
    podcast.officialUrl ?? "https://acquiringminds.co",
    podcast.episodeIndexUrl ?? "https://acquiringminds.co/episodes",
    podcast.rssUrl ?? "https://feeds.transistor.fm/acquiring-minds",
    now,
    now,
  );
}

export function upsertEpisode(db, episode) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO episodes (
      id, podcast_id, title, guest, date, official_url, youtube_url, audio_url,
      rss_guid, rss_published_at, transcript_availability, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      podcast_id = excluded.podcast_id,
      title = excluded.title,
      guest = excluded.guest,
      date = excluded.date,
      official_url = excluded.official_url,
      youtube_url = COALESCE(excluded.youtube_url, episodes.youtube_url),
      audio_url = COALESCE(excluded.audio_url, episodes.audio_url),
      rss_guid = COALESCE(excluded.rss_guid, episodes.rss_guid),
      rss_published_at = COALESCE(excluded.rss_published_at, episodes.rss_published_at),
      transcript_availability = excluded.transcript_availability,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    episode.id,
    episode.podcastId ?? "acquiring-minds",
    episode.title ?? "",
    episode.guest ?? "",
    episode.date ?? "",
    episode.officialUrl,
    episode.youtubeUrl ?? null,
    episode.audioUrl ?? null,
    episode.rssGuid ?? null,
    episode.rssPublishedAt ?? null,
    episode.transcriptAvailability ?? "unknown",
    JSON.stringify({
      rssTranscriptUrls: episode.rssTranscriptUrls ?? [],
    }),
    now,
    now,
  );
}

function sourceStatus(source, segments) {
  if (source.kind === "missing") {
    return "failed";
  }
  if (segments.length > 0 && ["official", "rss-transcript", "youtube-auto", "local-whisper"].includes(source.kind)) {
    return "success";
  }
  return source.kind === "summary-only" ? "summary-only" : "attempted";
}

export function deleteEpisodeTranscript(db, episodeId) {
  db.prepare("DELETE FROM transcript_segments WHERE episode_id = ?").run(episodeId);
  db.prepare("DELETE FROM transcript_sources WHERE episode_id = ?").run(episodeId);
  db.prepare("DELETE FROM transcript_documents WHERE episode_id = ?").run(episodeId);
}

export function insertTranscriptSource(db, episodeId, source, status = undefined) {
  const result = db.prepare(`
    INSERT INTO transcript_sources (
      episode_id, provider, kind, status, url, model, attempted_at, failure_reason, cache_path, metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    episodeId,
    source.provider ?? source.kind ?? "unknown",
    source.kind ?? "missing",
    status ?? source.statusText ?? "attempted",
    source.url ?? null,
    source.model ?? null,
    source.fetchedAt ?? nowIso(),
    source.reason ?? null,
    source.cachePath ?? null,
    JSON.stringify({
      httpStatus: source.status,
      candidates: source.candidates ?? [],
      clipSeconds: source.clipSeconds,
      fallbackReason: source.fallbackReason,
    }),
  );
  return Number(result.lastInsertRowid);
}

export function putTranscriptDocument(db, document, options = {}) {
  const episode = document.episode;
  upsertEpisode(db, episode);

  db.exec("BEGIN");
  try {
    if (options.replace !== false) {
      deleteEpisodeTranscript(db, episode.id);
    }

    db.prepare(`
      INSERT INTO transcript_documents (
        episode_id, show_notes_json, highlights_json, generated_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET
        show_notes_json = excluded.show_notes_json,
        highlights_json = excluded.highlights_json,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at
    `).run(
      episode.id,
      JSON.stringify(document.showNotes ?? []),
      JSON.stringify(document.highlights ?? []),
      document.generatedAt ?? nowIso(),
      nowIso(),
    );

    const sources = document.sources?.length
      ? document.sources
      : [{ kind: document.segments?.[0]?.source ?? "missing", fetchedAt: document.generatedAt ?? nowIso() }];
    const matchingSources = sources.filter((source) =>
      source.kind === document.segments?.[0]?.source,
    );
    const primarySource = matchingSources.at(-1) ?? sources.at(-1);
    const sourceIds = new Map();

    for (const source of sources) {
      sourceIds.set(source, insertTranscriptSource(db, episode.id, source, sourceStatus(source, document.segments ?? [])));
    }

    const primarySourceId = sourceIds.get(primarySource) ?? [...sourceIds.values()].at(-1) ?? null;
    for (const [index, segment] of (document.segments ?? []).entries()) {
      db.prepare(`
        INSERT INTO transcript_segments (
          episode_id, source_id, segment_index, segment_id, start, end, speaker, text, source_kind
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        episode.id,
        primarySourceId,
        index,
        segment.id ?? null,
        segment.start ?? "00:00:00",
        segment.end ?? null,
        segment.speaker ?? null,
        segment.text,
        segment.source ?? primarySource?.kind ?? "missing",
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markJob(db, episodeId, fields) {
  const existing = db.prepare("SELECT attempt_count FROM transcript_jobs WHERE episode_id = ?").get(episodeId);
  const now = nowIso();
  db.prepare(`
    INSERT INTO transcript_jobs (
      episode_id, state, current_fallback_step, attempt_count, started_at, completed_at, last_error, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(episode_id) DO UPDATE SET
      state = excluded.state,
      current_fallback_step = excluded.current_fallback_step,
      attempt_count = excluded.attempt_count,
      started_at = COALESCE(excluded.started_at, transcript_jobs.started_at),
      completed_at = excluded.completed_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `).run(
    episodeId,
    fields.state,
    fields.currentFallbackStep ?? null,
    fields.incrementAttempt ? Number(existing?.attempt_count ?? 0) + 1 : Number(existing?.attempt_count ?? 0),
    fields.startedAt ?? null,
    fields.completedAt ?? null,
    fields.lastError ?? null,
    now,
  );
}

export function getSegmentCount(db, episodeId) {
  return Number(db.prepare("SELECT COUNT(*) AS count FROM transcript_segments WHERE episode_id = ?").get(episodeId).count);
}

export function getEpisode(db, episodeId) {
  return db.prepare("SELECT * FROM episodes WHERE id = ?").get(episodeId);
}

export function getNextEpisodeForBackfill(db, options = {}) {
  if (options.episodeId) {
    return getEpisode(db, options.episodeId);
  }

  const failedClause = options.retryFailed ? "" : "WHERE COALESCE(j.state, '') != 'failed'";
  return db.prepare(`
    SELECT e.*
    FROM episodes e
    LEFT JOIN transcript_jobs j ON j.episode_id = e.id
    LEFT JOIN transcript_segments s ON s.episode_id = e.id
    ${failedClause}
    GROUP BY e.id
    HAVING COUNT(s.id) = 0
    ORDER BY COALESCE(e.rss_published_at, '' ) DESC, e.id ASC
    LIMIT 1
  `).get();
}

export function getTranscriptDocument(db, episodeId) {
  const episode = getEpisode(db, episodeId);
  if (!episode) {
    return undefined;
  }

  const sources = db.prepare("SELECT * FROM transcript_sources WHERE episode_id = ? ORDER BY id ASC").all(episodeId);
  const segments = db.prepare("SELECT * FROM transcript_segments WHERE episode_id = ? ORDER BY segment_index ASC").all(episodeId);
  const documentMetadata = db.prepare("SELECT * FROM transcript_documents WHERE episode_id = ?").get(episodeId);

  return {
    episode: rowToEpisode(episode),
    sources: sources.map((source) => ({
      kind: source.kind,
      provider: source.provider,
      url: source.url,
      fetchedAt: source.attempted_at,
      status: JSON.parse(source.metadata_json ?? "{}").httpStatus,
      reason: source.failure_reason,
      cachePath: source.cache_path,
      model: source.model,
      candidates: JSON.parse(source.metadata_json ?? "{}").candidates,
    })),
    showNotes: JSON.parse(documentMetadata?.show_notes_json ?? "[]"),
    highlights: JSON.parse(documentMetadata?.highlights_json ?? "[]"),
    segments: segments.map((segment) => ({
      id: segment.segment_id ?? `${segment.source_kind}-${segment.segment_index + 1}`,
      start: segment.start,
      end: segment.end,
      speaker: segment.speaker,
      text: segment.text,
      source: segment.source_kind,
    })),
    generatedAt: documentMetadata?.generated_at ?? sources.at(-1)?.attempted_at ?? nowIso(),
  };
}

export function rowToEpisode(row) {
  const metadata = JSON.parse(row.metadata_json ?? "{}");
  return {
    id: row.id,
    podcastId: row.podcast_id,
    title: row.title,
    guest: row.guest ?? "",
    date: row.date ?? "",
    officialUrl: row.official_url,
    youtubeUrl: row.youtube_url ?? undefined,
    audioUrl: row.audio_url ?? undefined,
    rssGuid: row.rss_guid ?? undefined,
    rssPublishedAt: row.rss_published_at ?? undefined,
    rssTranscriptUrls: metadata.rssTranscriptUrls ?? [],
    transcriptAvailability: row.transcript_availability ?? "unknown",
  };
}

export async function importJsonCorpus(db) {
  upsertPodcast(db);
  const episodes = await readEpisodes();
  for (const episode of episodes) {
    upsertEpisode(db, episode);
  }

  let transcripts = 0;
  let segments = 0;
  for (const episodeId of await listTranscriptIds()) {
    const document = JSON.parse(await readFile(transcriptPath(episodeId), "utf8"));
    putTranscriptDocument(db, document);
    transcripts += 1;
    segments += document.segments?.length ?? 0;
  }

  return { episodes: episodes.length, transcripts, segments };
}
