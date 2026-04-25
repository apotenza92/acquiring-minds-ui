#!/usr/bin/env node
import { openCorpusDb, rowToEpisode, upsertEpisode, insertTranscriptSource } from "./lib/corpus-db.mjs";
import { getArg, getNumberArg, hasFlag, nowIso, readJsonFile, writeJson } from "./lib/io.mjs";
import { searchYouTubeWithYtDlp, selectBestYtDlpIndexResult } from "./adapters/ytdlp.mjs";
import { readOpenVideoDownloaderDefaults } from "./adapters/open-video-downloader.mjs";
import { corpusPaths, writeEpisodes, writeTranscript } from "./lib/corpus.mjs";
import { getTranscriptDocument } from "./lib/corpus-db.mjs";

const episodeId = getArg("--episode-id");
const maxEpisodes = getNumberArg("--max-episodes", Number.POSITIVE_INFINITY);
const force = hasFlag("--force");
const retryFailed = hasFlag("--retry-failed");
const dryRun = hasFlag("--dry-run");
const useOpenVideoDownloader = hasFlag("--use-open-video-downloader");
const openVideoDownloaderDefaults = useOpenVideoDownloader ? await readOpenVideoDownloaderDefaults() : {};
const ytdlpBinary = getArg("--ytdlp-bin") ?? openVideoDownloaderDefaults.binary;
const cookiesFromBrowser = getArg("--cookies-from-browser") ?? openVideoDownloaderDefaults.cookiesFromBrowser;
const cookieFile = getArg("--cookies") ?? openVideoDownloaderDefaults.cookieFile;
const youtubeIndexPath = getArg("--youtube-index") ?? corpusPaths.youtubeIndex;
const youtubeIndex = hasFlag("--skip-youtube-index")
  ? null
  : await readJsonFile(youtubeIndexPath, null);

const db = await openCorpusDb();
const rows = db.prepare(`
  SELECT e.*
  FROM episodes e
  LEFT JOIN transcript_segments s ON s.episode_id = e.id
  WHERE (? IS NULL OR e.id = ?)
    AND (
      ? = 1
      OR ? = 1
      OR ? IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM transcript_sources ys
        WHERE ys.episode_id = e.id
          AND ys.provider = 'youtube-resolve'
          AND ys.status = 'failed'
      )
    )
  GROUP BY e.id
  HAVING COUNT(s.id) = 0
  ORDER BY COALESCE(e.rss_published_at, '' ) DESC, e.id ASC
`).all(episodeId ?? null, episodeId ?? null, force ? 1 : 0, retryFailed ? 1 : 0, episodeId ?? null);

const results = [];
for (const row of rows) {
  if (results.length >= maxEpisodes) {
    break;
  }

  const episode = rowToEpisode(row);
  if (episode.youtubeUrl && !force) {
    results.push({
      episodeId: episode.id,
      skipped: true,
      youtubeUrl: episode.youtubeUrl,
      reason: "already has youtubeUrl",
    });
    continue;
  }

  let result = youtubeIndex?.entries?.length
    ? selectBestYtDlpIndexResult(episode, youtubeIndex.entries)
    : { ok: false, reason: "No YouTube index available", candidates: [] };
  if (result.ok) {
    result = {
      ...result,
      resolverProvider: "youtube-index",
    };
  } else if (!dryRun && youtubeIndex?.entries?.length) {
    insertTranscriptSource(db, episode.id, {
      kind: "missing",
      provider: "youtube-index",
      fetchedAt: nowIso(),
      reason: result.reason,
      candidates: result.candidates?.map((candidate) => candidate.url),
    }, "failed");
  }

  if (!result.ok) {
    result = await searchYouTubeWithYtDlp(episode, {
      binary: ytdlpBinary,
      cookiesFromBrowser,
      cookieFile,
    });
  }
  if (result.ok) {
    const nextEpisode = {
      ...episode,
      youtubeUrl: result.youtubeUrl,
    };
    if (!dryRun) {
      upsertEpisode(db, nextEpisode);
      insertTranscriptSource(db, episode.id, {
        kind: "youtube-auto",
        provider: result.resolverProvider ?? "youtube-resolve",
        url: result.youtubeUrl,
        fetchedAt: nowIso(),
        candidates: result.candidates?.map((candidate) => candidate.url),
      }, "resolved");
    }
    results.push({
      episodeId: episode.id,
      ok: true,
      youtubeUrl: result.youtubeUrl,
      title: result.candidate.title,
      score: result.candidate.score,
    });
  } else {
    if (!dryRun) {
      insertTranscriptSource(db, episode.id, {
        kind: "missing",
        provider: "youtube-resolve",
        fetchedAt: nowIso(),
        reason: result.reason,
        candidates: result.candidates?.map((candidate) => candidate.url),
      }, "failed");
    }
    results.push({
      episodeId: episode.id,
      ok: false,
      reason: result.reason,
      candidates: result.candidates,
    });
  }
}

if (!dryRun) {
  const episodeRows = db.prepare("SELECT * FROM episodes ORDER BY COALESCE(rss_published_at, '' ) DESC, id ASC").all();
  await writeEpisodes(episodeRows.map(rowToEpisode));
  for (const row of episodeRows) {
    const document = getTranscriptDocument(db, row.id);
    if (document) {
      await writeTranscript(row.id, document);
    }
  }
}

db.close();

writeJson({
  ok: true,
  dryRun,
  retryFailed,
  usingOpenVideoDownloader: useOpenVideoDownloader,
  processed: results.length,
  resolved: results.filter((result) => result.ok).length,
  results,
});
