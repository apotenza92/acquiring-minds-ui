#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  extractArticleMetadata,
  extractHighlights,
  extractShowNotes,
  extractTranscriptSegments,
} from "./adapters/acquiring-minds.mjs";
import { fetchYouTubeCaptionSegments, searchYouTubeForEpisode } from "./adapters/youtube.mjs";
import { fetchYtDlpCaptionSegments, searchYouTubeWithYtDlp, selectBestYtDlpIndexResult } from "./adapters/ytdlp.mjs";
import { readOpenVideoDownloaderDefaults } from "./adapters/open-video-downloader.mjs";
import { transcribeAudioWithLocalWhisper } from "./adapters/local-whisper.mjs";
import { corpusPaths, rawHtmlPath } from "./lib/corpus.mjs";
import {
  deleteEpisodeTranscript,
  getEpisode,
  getNextEpisodeForBackfill,
  getSegmentCount,
  importJsonCorpus,
  insertTranscriptSource,
  markJob,
  openCorpusDb,
  putTranscriptDocument,
  rowToEpisode,
  upsertEpisode,
} from "./lib/corpus-db.mjs";
import { getArg, getNumberArg, hasFlag, nowIso, readJsonFile, sleep, writeJson } from "./lib/io.mjs";
import { writeCoverageReport } from "./lib/corpus-report.mjs";

const episodeId = getArg("--episode-id");
const all = hasFlag("--all");
const force = hasFlag("--force");
const dryRun = hasFlag("--dry-run");
const retryFailed = hasFlag("--retry-failed");
const maxEpisodes = getNumberArg("--max-episodes", all ? Number.POSITIVE_INFINITY : 1);
const concurrency = getNumberArg("--concurrency", 1);
const delayMs = getNumberArg("--delay-ms", 300);
const youtubeTimeoutMs = getNumberArg("--youtube-timeout-ms", 3000);
const sleepSubtitlesMs = getNumberArg("--sleep-subtitles-ms", 0);
const localProvider = getArg("--local-provider") ?? "mlx";
const localModel = getArg("--local-model") ?? (
  localProvider === "mlx" ? "mlx-community/whisper-large-v3-turbo" : "small.en"
);
const fallbackModel = getArg("--fallback-model") ?? "small.en";
const useOpenVideoDownloader = hasFlag("--use-open-video-downloader");
const openVideoDownloaderDefaults = useOpenVideoDownloader ? await readOpenVideoDownloaderDefaults() : {};
const ytdlpBinary = getArg("--ytdlp-bin") ?? openVideoDownloaderDefaults.binary;
const cookiesFromBrowser = getArg("--cookies-from-browser") ?? openVideoDownloaderDefaults.cookiesFromBrowser;
const cookieFile = getArg("--cookies") ?? openVideoDownloaderDefaults.cookieFile;
const subLanguages = getArg("--sub-langs") ?? openVideoDownloaderDefaults.subLanguages;
const subFormats = getArg("--sub-format") ?? openVideoDownloaderDefaults.subFormats;
const youtubeIndexPath = getArg("--youtube-index") ?? corpusPaths.youtubeIndex;
const youtubeIndex = hasFlag("--skip-youtube-index")
  ? null
  : await readJsonFile(youtubeIndexPath, null);

if (concurrency !== 1) {
  throw new Error("Only --concurrency 1 is supported while the corpus is written one episode at a time.");
}

process.env.AMKB_YOUTUBE_TIMEOUT_MS = String(youtubeTimeoutMs);

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`Fetch failed for ${url}: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function readOrFetchOfficialHtml(episode) {
  try {
    return {
      html: await readFile(rawHtmlPath(episode.id), "utf8"),
      fromCache: true,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const html = await fetchText(episode.officialUrl);
  if (!dryRun) {
    await writeFile(rawHtmlPath(episode.id), html, "utf8");
  }
  await sleep(delayMs);
  return { html, fromCache: false };
}

async function tryOfficial(db, episode) {
  const { html, fromCache } = await readOrFetchOfficialHtml(episode);
  const metadata = extractArticleMetadata(html, episode.officialUrl);
  const segments = extractTranscriptSegments(html);
  const nextEpisode = {
    ...episode,
    ...metadata,
    id: episode.id,
    title: metadata.title || episode.title,
    guest: metadata.guest || episode.guest,
    date: metadata.date || episode.date,
    audioUrl: episode.audioUrl,
    rssGuid: episode.rssGuid,
    rssPublishedAt: episode.rssPublishedAt,
    rssTranscriptUrls: episode.rssTranscriptUrls ?? [],
    transcriptAvailability: segments.length > 0 ? "official" : metadata.transcriptAvailability,
  };

  if (!dryRun) {
    upsertEpisode(db, nextEpisode);
  }

  if (segments.length === 0) {
    if (!dryRun) {
      insertTranscriptSource(db, episode.id, {
        kind: "summary-only",
        provider: "official",
        url: episode.officialUrl,
        fetchedAt: nowIso(),
        cachePath: rawHtmlPath(episode.id),
        reason: "Official page has no static transcript segments",
      }, "summary-only");
    }
    return { ok: false, reason: "Official page has no static transcript segments", fromCache };
  }

  if (!dryRun) {
    putTranscriptDocument(db, {
      episode: nextEpisode,
      sources: [{
        kind: "official",
        provider: "official",
        url: episode.officialUrl,
        fetchedAt: nowIso(),
        status: 200,
        cachePath: rawHtmlPath(episode.id),
      }],
      showNotes: extractShowNotes(html),
      highlights: extractHighlights(html),
      segments,
      generatedAt: nowIso(),
    }, { replace: false });
  }

  return { ok: true, source: "official", segmentCount: segments.length, fromCache };
}

function secondsToTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function normaliseTimedTranscript(text, sourceKind = "rss-transcript") {
  const blocks = String(text)
    .replace(/^WEBVTT[^\n]*\n+/i, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const segments = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => /-->/i.test(line));
    if (timeIndex === -1) {
      continue;
    }

    const [startRaw, endRaw] = lines[timeIndex].split(/\s*-->\s*/);
    const normaliseTime = (value) => {
      const cleaned = value.replace(",", ".").split(/\s+/)[0];
      const parts = cleaned.split(":").map(Number);
      if (parts.length === 2) {
        return secondsToTimestamp((parts[0] * 60) + parts[1]);
      }
      return secondsToTimestamp((parts[0] * 3600) + (parts[1] * 60) + parts[2]);
    };
    const body = lines.slice(timeIndex + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (body) {
      segments.push({
        id: `${sourceKind}-${segments.length + 1}`,
        start: normaliseTime(startRaw),
        end: normaliseTime(endRaw),
        text: body,
        source: sourceKind,
      });
    }
  }

  return segments;
}

async function tryRssTranscript(db, episode) {
  const urls = episode.rssTranscriptUrls ?? [];
  if (urls.length === 0) {
    return { ok: false, reason: "No RSS transcript tags available" };
  }

  for (const transcript of urls) {
    try {
      const response = await fetch(transcript.url);
      if (!response.ok) {
        throw new Error(`RSS transcript fetch failed with ${response.status}`);
      }
      const text = await response.text();
      const segments = normaliseTimedTranscript(text);
      if (segments.length === 0) {
        throw new Error("RSS transcript had no usable timed segments");
      }
      if (!dryRun) {
        putTranscriptDocument(db, {
          episode: {
            ...episode,
            transcriptAvailability: "official",
          },
          sources: [{
            kind: "rss-transcript",
            provider: "rss-transcript",
            url: transcript.url,
            fetchedAt: nowIso(),
            status: response.status,
          }],
          showNotes: [],
          highlights: [],
          segments,
          generatedAt: nowIso(),
        }, { replace: false });
      }
      return { ok: true, source: "rss-transcript", segmentCount: segments.length };
    } catch (error) {
      if (!dryRun) {
        insertTranscriptSource(db, episode.id, {
          kind: "rss-transcript",
          provider: "rss-transcript",
          url: transcript.url,
          fetchedAt: nowIso(),
          reason: error.message,
        }, "failed");
      }
    }
  }

  return { ok: false, reason: "No RSS transcript source succeeded" };
}

async function tryYouTube(db, episode) {
  let youtubeUrl = episode.youtubeUrl;
  if (!youtubeUrl) {
    let searchResult = youtubeIndex?.entries?.length
      ? selectBestYtDlpIndexResult(episode, youtubeIndex.entries)
      : { ok: false, reason: "No YouTube index available", candidates: [] };
    if (searchResult.ok) {
      searchResult = {
        ...searchResult,
        resolverProvider: "youtube-index",
      };
    } else if (!dryRun && youtubeIndex?.entries?.length) {
      insertTranscriptSource(db, episode.id, {
        kind: "missing",
        provider: "youtube-index",
        fetchedAt: nowIso(),
        reason: searchResult.reason,
        candidates: searchResult.candidates?.map((candidate) => candidate.url),
      }, "failed");
    }

    if (!searchResult.ok) {
      searchResult = await searchYouTubeWithYtDlp(episode, {
      binary: ytdlpBinary,
      cookiesFromBrowser,
      cookieFile,
      });
    }
    if (!searchResult.ok) {
      if (!dryRun) {
        insertTranscriptSource(db, episode.id, {
          kind: "missing",
          provider: "youtube-resolve",
          fetchedAt: nowIso(),
          reason: searchResult.reason,
          candidates: searchResult.candidates?.map((candidate) => candidate.url),
        }, "failed");
      }
      searchResult = await searchYouTubeForEpisode(episode);
    }
    await sleep(delayMs);
    if (!searchResult.ok) {
      if (!dryRun) {
        insertTranscriptSource(db, episode.id, {
          kind: "missing",
          provider: "youtube-search",
          fetchedAt: nowIso(),
          reason: searchResult.reason,
          candidates: searchResult.candidates,
        }, "failed");
      }
      return { ok: false, reason: searchResult.reason };
    }
    youtubeUrl = searchResult.youtubeUrl;
    if (!dryRun) {
      upsertEpisode(db, {
        ...episode,
        youtubeUrl,
      });
      insertTranscriptSource(db, episode.id, {
        kind: "youtube-auto",
        provider: searchResult.resolverProvider ?? "youtube-resolve",
        url: youtubeUrl,
        fetchedAt: nowIso(),
        candidates: searchResult.candidates?.map((candidate) => candidate.url ?? candidate),
      }, "resolved");
    }
  }

  const ytdlpResult = await fetchYtDlpCaptionSegments(youtubeUrl, {
    outputDir: join(corpusPaths.youtubeCaptionsDir, episode.id),
    binary: ytdlpBinary,
    sleepSubtitlesMs,
    timeoutMs: Math.max(youtubeTimeoutMs, 180000),
    cookiesFromBrowser,
    cookieFile,
    subLanguages,
    subFormats,
  });
  if (ytdlpResult.ok && ytdlpResult.segments.length > 0) {
    if (!dryRun) {
      putTranscriptDocument(db, {
        episode: {
          ...episode,
          youtubeUrl,
          transcriptAvailability: "youtube-auto",
        },
        sources: [ytdlpResult.source],
        showNotes: [],
        highlights: [],
        segments: ytdlpResult.segments,
        generatedAt: nowIso(),
      }, { replace: false });
    }
    return { ok: true, source: "youtube-auto", provider: "yt-dlp", segmentCount: ytdlpResult.segments.length };
  }

  if (!dryRun) {
    insertTranscriptSource(db, episode.id, {
      kind: "youtube-auto",
      provider: "yt-dlp",
      url: youtubeUrl,
      fetchedAt: nowIso(),
      reason: ytdlpResult.reason,
    }, "failed");
  }

  const directResult = await fetchYouTubeCaptionSegments(youtubeUrl);
  if (directResult.ok && directResult.segments.length > 0) {
    if (!dryRun) {
      putTranscriptDocument(db, {
        episode: {
          ...episode,
          youtubeUrl,
          transcriptAvailability: "youtube-auto",
        },
        sources: [{
          ...directResult.source,
          provider: "direct",
        }],
        showNotes: [],
        highlights: [],
        segments: directResult.segments,
        generatedAt: nowIso(),
      }, { replace: false });
    }
    return { ok: true, source: "youtube-auto", provider: "direct", segmentCount: directResult.segments.length };
  }

  if (!dryRun) {
    insertTranscriptSource(db, episode.id, {
      kind: "youtube-auto",
      provider: "direct",
      url: youtubeUrl,
      fetchedAt: nowIso(),
      reason: directResult.reason,
    }, "failed");
  }

  return { ok: false, reason: `yt-dlp: ${ytdlpResult.reason}; direct: ${directResult.reason}` };
}

async function tryLocalTranscription(db, episode) {
  if (!episode.audioUrl) {
    if (!dryRun) {
      insertTranscriptSource(db, episode.id, {
        kind: "missing",
        provider: "local-whisper",
        fetchedAt: nowIso(),
        reason: "No RSS audio URL available",
      }, "failed");
    }
    return { ok: false, reason: "No RSS audio URL available" };
  }

  const result = await transcribeAudioWithLocalWhisper(episode.audioUrl, {
    outputDir: join(corpusPaths.localTranscriptsDir, episode.id),
    provider: localProvider,
    model: localModel,
    fallbackModel,
    keepAudio: false,
  });

  if (!result.ok || result.segments.length === 0) {
    if (!dryRun) {
      insertTranscriptSource(db, episode.id, {
        kind: "missing",
        provider: "local-whisper",
        url: episode.audioUrl,
        fetchedAt: nowIso(),
        reason: result.reason,
      }, "failed");
    }
    return { ok: false, reason: result.reason };
  }

  if (!dryRun) {
    putTranscriptDocument(db, {
      episode: {
        ...episode,
        transcriptAvailability: "local-whisper",
      },
      sources: [result.source],
      showNotes: [],
      highlights: [],
      segments: result.segments,
      generatedAt: nowIso(),
    }, { replace: false });
  }

  return { ok: true, source: "local-whisper", provider: result.source.provider, segmentCount: result.segments.length };
}

async function processEpisode(db, episodeRow) {
  const episode = rowToEpisode(episodeRow);
  const existingSegments = getSegmentCount(db, episode.id);
  if (existingSegments > 0 && !force) {
    return { episodeId: episode.id, skipped: true, reason: "already has transcript segments", segmentCount: existingSegments };
  }

  if (force && !dryRun) {
    deleteEpisodeTranscript(db, episode.id);
  }

  if (!dryRun) {
    markJob(db, episode.id, {
      state: "running",
      currentFallbackStep: "official",
      incrementAttempt: true,
      startedAt: nowIso(),
    });
  }

  const attempts = [];
  const steps = [
    ["official", tryOfficial],
    ["rss-transcript", tryRssTranscript],
    ["youtube-auto", tryYouTube],
    ["local-whisper", tryLocalTranscription],
  ];

  for (const [step, fn] of steps) {
    if (!dryRun) {
      markJob(db, episode.id, {
        state: "running",
        currentFallbackStep: step,
      });
    }
    const result = await fn(db, getEpisode(db, episode.id) ? rowToEpisode(getEpisode(db, episode.id)) : episode);
    attempts.push({ step, ...result });
    if (result.ok) {
      if (!dryRun) {
        markJob(db, episode.id, {
          state: "completed",
          currentFallbackStep: step,
          completedAt: nowIso(),
        });
      }
      return {
        episodeId: episode.id,
        skipped: false,
        source: result.source,
        provider: result.provider,
        segmentCount: result.segmentCount,
        attempts,
      };
    }
  }

  const lastReason = attempts.at(-1)?.reason ?? "All transcript fallbacks failed";
  if (!dryRun) {
    insertTranscriptSource(db, episode.id, {
      kind: "missing",
      provider: "fallback-hierarchy",
      fetchedAt: nowIso(),
      reason: lastReason,
    }, "failed");
    markJob(db, episode.id, {
      state: "failed",
      currentFallbackStep: "missing",
      completedAt: nowIso(),
      lastError: lastReason,
    });
  }

  return {
    episodeId: episode.id,
    skipped: false,
    source: "missing",
    segmentCount: 0,
    attempts,
    reason: lastReason,
  };
}

const db = await openCorpusDb();
const dbEpisodeCount = Number(db.prepare("SELECT COUNT(*) AS count FROM episodes").get().count);
if (dbEpisodeCount === 0) {
  await importJsonCorpus(db);
}

if (dryRun) {
  const episode = getNextEpisodeForBackfill(db, {
    episodeId,
    retryFailed,
  });
  db.close();
  writeJson({
    ok: true,
    dryRun: true,
    selectedEpisode: episode ? {
      id: episode.id,
      title: episode.title,
      officialUrl: episode.official_url,
      youtubeUrl: episode.youtube_url,
      audioUrl: episode.audio_url,
    } : undefined,
    plannedFallbacks: [
      "existing-sqlite-segments",
      "official",
      "rss-transcript",
      "youtube-resolve",
      "youtube-auto",
      "local-whisper",
      "missing",
    ],
    localProvider,
    localModel,
    fallbackModel,
    usingOpenVideoDownloader: useOpenVideoDownloader,
  });
  process.exit(0);
}

const results = [];
for (let processed = 0; processed < maxEpisodes; processed += 1) {
  const episode = getNextEpisodeForBackfill(db, {
    episodeId,
    retryFailed,
  });
  if (!episode) {
    break;
  }

  const result = await processEpisode(db, episode);
  results.push(result);
  if (episodeId || !all) {
    break;
  }
}

const coverage = dryRun ? undefined : await writeCoverageReport();
db.close();

writeJson({
  ok: true,
  dryRun,
  all,
  processed: results.length,
  localProvider,
  localModel,
  fallbackModel,
  results,
  coverage: coverage
    ? {
        totalEpisodes: coverage.totalEpisodes,
        officialTranscripts: coverage.officialTranscripts,
        rssTranscripts: coverage.rssTranscripts,
        youtubeAutoCaptions: coverage.youtubeAutoCaptions,
        localWhisperTranscripts: coverage.localWhisperTranscripts,
        missing: coverage.missing,
        failed: coverage.failed,
        remaining: coverage.remaining,
      }
    : undefined,
});
