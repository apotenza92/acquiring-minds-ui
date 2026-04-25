#!/usr/bin/env node
import { join } from "node:path";
import { getArg, getNumberArg, hasFlag, nowIso, sleep, writeJson } from "./lib/io.mjs";
import {
  corpusPaths,
  ensureCorpusDirs,
  readEpisodes,
  readTranscript,
  writeTranscript,
} from "./lib/corpus.mjs";
import { fetchYouTubeCaptionSegments, searchYouTubeForEpisode } from "./adapters/youtube.mjs";
import { fetchYtDlpCaptionSegments, searchYouTubeWithYtDlp } from "./adapters/ytdlp.mjs";
import { readOpenVideoDownloaderDefaults } from "./adapters/open-video-downloader.mjs";
import { writeCoverageReport } from "./lib/corpus-report.mjs";

await ensureCorpusDirs();

const delayMs = getNumberArg("--delay-ms", 300);
const timeoutMs = getNumberArg("--timeout-ms", 2500);
const maxEpisodes = getNumberArg("--max-episodes", Number.POSITIVE_INFINITY);
const sleepSubtitlesMs = getNumberArg("--sleep-subtitles-ms", 0);
const episodeId = getArg("--episode-id");
const force = hasFlag("--force");
const dryRun = hasFlag("--dry-run");
const useOpenVideoDownloader = hasFlag("--use-open-video-downloader");
const providers = new Set((getArg("--provider") ?? "ytdlp,direct").split(",").map((provider) => provider.trim()).filter(Boolean));
const openVideoDownloaderDefaults = useOpenVideoDownloader ? await readOpenVideoDownloaderDefaults() : {};
const ytdlpBinary = getArg("--ytdlp-bin") ?? openVideoDownloaderDefaults.binary;
const cookiesFromBrowser = getArg("--cookies-from-browser") ?? openVideoDownloaderDefaults.cookiesFromBrowser;
const cookieFile = getArg("--cookies") ?? openVideoDownloaderDefaults.cookieFile;
const subLanguages = getArg("--sub-langs") ?? openVideoDownloaderDefaults.subLanguages;
const subFormats = getArg("--sub-format") ?? openVideoDownloaderDefaults.subFormats;

const episodes = await readEpisodes();
const results = [];
process.env.AMKB_YOUTUBE_TIMEOUT_MS = String(timeoutMs);

function missingSource(youtubeUrl, provider, reason) {
  return {
    kind: "missing",
    provider,
    url: youtubeUrl,
    fetchedAt: nowIso(),
    reason,
  };
}

async function fetchCaptionSegments(episode, youtubeUrl) {
  const attempts = [];

  if (providers.has("ytdlp")) {
    const result = await fetchYtDlpCaptionSegments(youtubeUrl, {
      outputDir: join(corpusPaths.youtubeCaptionsDir, episode.id),
      binary: ytdlpBinary,
      force,
      sleepSubtitlesMs,
      timeoutMs: Math.max(timeoutMs, 180000),
      cookiesFromBrowser,
      cookieFile,
      subLanguages,
      subFormats,
    });
    attempts.push({ provider: "yt-dlp", result });
    if (result.ok && result.segments.length > 0) {
      return { ...result, attempts };
    }
  }

  if (providers.has("direct")) {
    const result = await fetchYouTubeCaptionSegments(youtubeUrl);
    attempts.push({ provider: "direct", result });
    if (result.ok && result.segments.length > 0) {
      return { ...result, attempts };
    }
  }

  const reasons = attempts.map((attempt) => `${attempt.provider}: ${attempt.result.reason}`).filter(Boolean);
  return {
    ok: false,
    reason: reasons.join("; ") || "No YouTube caption provider was enabled",
    segments: [],
    attempts,
  };
}

async function fallbackDocument(episode, document) {
  if (!force && document.segments?.length > 0) {
    return { skipped: true, reason: "already has segments", document };
  }

  if (
    !force &&
    document.sources?.some((source) => source.kind === "youtube-auto" || source.reason === "Ambiguous YouTube search results")
  ) {
    return { skipped: true, reason: "already attempted youtube fallback", document };
  }

  let youtubeUrl = document.episode?.youtubeUrl || episode.youtubeUrl;
  if (!youtubeUrl) {
    let searchResult = await searchYouTubeWithYtDlp(document.episode || episode, {
      binary: ytdlpBinary,
      cookiesFromBrowser,
      cookieFile,
    });
    if (!searchResult.ok) {
      searchResult = await searchYouTubeForEpisode(document.episode || episode);
    }
    await sleep(delayMs);

    if (!searchResult.ok) {
      return {
        skipped: false,
        document: {
          ...document,
          sources: [
            ...(document.sources ?? []),
            {
              kind: "missing",
              fetchedAt: nowIso(),
              reason: searchResult.reason,
              candidates: searchResult.candidates,
            },
          ],
        },
      };
    }
    youtubeUrl = searchResult.youtubeUrl;
  }

  const captionResult = await fetchCaptionSegments(episode, youtubeUrl);
  await sleep(delayMs);

  if (!captionResult.ok || captionResult.segments.length === 0) {
    return {
      skipped: false,
      document: {
        ...document,
        episode: {
          ...document.episode,
          youtubeUrl,
        },
        sources: [
          ...(document.sources ?? []),
          missingSource(youtubeUrl, "youtube", captionResult.reason),
        ],
      },
    };
  }

  return {
    skipped: false,
    document: {
      ...document,
      episode: {
        ...document.episode,
        youtubeUrl,
        transcriptAvailability: "youtube-auto",
      },
      sources: [...(document.sources ?? []), captionResult.source],
      segments: captionResult.segments,
      generatedAt: nowIso(),
    },
  };
}

let processed = 0;

for (const episode of episodes) {
  if (episodeId && episode.id !== episodeId) {
    continue;
  }

  if (processed >= maxEpisodes) {
    break;
  }

  const document = await readTranscript(episode.id);
  if (!document || document.segments?.length > 0) {
    continue;
  }

  processed += 1;
  try {
    const result = await fallbackDocument(episode, document);
    if (!dryRun && !result.skipped) {
      await writeTranscript(episode.id, result.document);
    }

    results.push({
      episodeId: episode.id,
      skipped: result.skipped,
      reason: result.reason,
      segmentCount: result.document.segments?.length ?? 0,
      source: result.document.segments?.[0]?.source ?? result.document.sources?.at(-1)?.kind,
      missingReason: result.document.sources?.at(-1)?.reason,
    });
  } catch (error) {
    const failedDocument = {
      ...document,
      sources: [
        ...(document.sources ?? []),
        {
          kind: "missing",
          fetchedAt: nowIso(),
          reason: error.message,
        },
      ],
    };
    if (!dryRun) {
      await writeTranscript(episode.id, failedDocument);
    }
    results.push({
      episodeId: episode.id,
      skipped: false,
      segmentCount: 0,
      source: "missing",
      missingReason: error.message,
    });
  }
}

const coverage = dryRun ? undefined : await writeCoverageReport();

writeJson({
  ok: true,
  dryRun,
  episodeId,
  processed,
  providers: [...providers],
  updated: results.filter((result) => !result.skipped).length,
  results,
  coverage: coverage
    ? {
        officialTranscripts: coverage.officialTranscripts,
        youtubeAutoCaptions: coverage.youtubeAutoCaptions,
        summaryOnly: coverage.summaryOnly,
        missing: coverage.missing,
        parseFailures: coverage.parseFailures,
        unresolvedYouTube: coverage.unresolvedYouTube,
      }
    : undefined,
});
