#!/usr/bin/env node
import { discoverEpisodesFromIndex, extractArticleMetadata, extractHighlights, extractShowNotes, extractTranscriptSegments, getNextEpisodeIndexUrl } from "./adapters/acquiring-minds.mjs";
import { fetchYouTubeCaptionSegments, searchYouTubeForEpisode } from "./adapters/youtube.mjs";
import {
  ensureCorpusDirs,
  rawHtmlPath,
  readEpisodes,
  transcriptPath,
  writeEpisodes,
  writeTranscript,
} from "./lib/corpus.mjs";
import { getNumberArg, hasFlag, nowIso, sleep, writeJson } from "./lib/io.mjs";
import { readFile as readFileSafe, writeFile } from "node:fs/promises";
import { writeCoverageReport } from "./lib/corpus-report.mjs";

const startUrl = "https://acquiringminds.co/episodes";
const maxPages = getNumberArg("--max-pages", 50);
const maxEpisodes = getNumberArg("--max-episodes", Number.POSITIVE_INFINITY);
const delayMs = getNumberArg("--delay-ms", 300);
const force = hasFlag("--force");
const dryRun = hasFlag("--dry-run");
const skipYouTube = hasFlag("--skip-youtube");

await ensureCorpusDirs();

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`Fetch failed for ${url}: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function discoverAllEpisodes() {
  const discovered = [];
  const seenEpisodeUrls = new Set();
  const visitedPages = [];
  let nextUrl = startUrl;

  for (let index = 0; nextUrl && index < maxPages; index += 1) {
    if (visitedPages.includes(nextUrl)) {
      break;
    }

    const html = await fetchText(nextUrl);
    visitedPages.push(nextUrl);
    for (const episode of discoverEpisodesFromIndex(html, nextUrl)) {
      if (!seenEpisodeUrls.has(episode.officialUrl)) {
        seenEpisodeUrls.add(episode.officialUrl);
        discovered.push(episode);
      }
    }

    nextUrl = getNextEpisodeIndexUrl(html, nextUrl);
    if (nextUrl) {
      await sleep(delayMs);
    }
  }

  return { episodes: discovered.slice(0, maxEpisodes), pages: visitedPages };
}

async function readCachedHtml(episode) {
  if (force) {
    return undefined;
  }

  try {
    return await readFileSafe(rawHtmlPath(episode.id), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function fetchOfficialHtml(episode) {
  const cached = await readCachedHtml(episode);
  if (cached) {
    return { html: cached, fromCache: true };
  }

  const html = await fetchText(episode.officialUrl);
  if (!dryRun) {
    await writeFile(rawHtmlPath(episode.id), html, "utf8");
  }
  await sleep(delayMs);
  return { html, fromCache: false };
}

function normaliseOfficialTranscript(episode, html, status = 200) {
  const metadata = extractArticleMetadata(html, episode.officialUrl);
  const segments = extractTranscriptSegments(html);
  const transcriptAvailability = segments.length > 0 ? "official" : metadata.transcriptAvailability;

  return {
    episode: {
      ...episode,
      ...metadata,
      id: episode.id,
      title: metadata.title || episode.title,
      guest: metadata.guest || episode.guest,
      date: metadata.date || episode.date,
      transcriptAvailability,
    },
    sources: [
      {
        kind: segments.length > 0 ? "official" : "summary-only",
        url: episode.officialUrl,
        fetchedAt: nowIso(),
        status,
      },
    ],
    showNotes: extractShowNotes(html),
    highlights: extractHighlights(html),
    segments,
    generatedAt: nowIso(),
  };
}

async function addYouTubeFallback(document) {
  if (document.segments.length > 0 || skipYouTube) {
    return document;
  }

  let youtubeUrl = document.episode.youtubeUrl;
  if (!youtubeUrl) {
    const searchResult = await searchYouTubeForEpisode(document.episode);
    if (!searchResult.ok) {
      return {
        ...document,
        sources: [
          ...document.sources,
          {
            kind: "missing",
            fetchedAt: nowIso(),
            reason: searchResult.reason,
            candidates: searchResult.candidates,
          },
        ],
      };
    }
    youtubeUrl = searchResult.youtubeUrl;
  }

  const captionResult = await fetchYouTubeCaptionSegments(youtubeUrl);
  if (!captionResult.ok || captionResult.segments.length === 0) {
    return {
      ...document,
      episode: {
        ...document.episode,
        youtubeUrl,
        transcriptAvailability: document.episode.transcriptAvailability,
      },
      sources: [
        ...document.sources,
        {
          kind: "missing",
          url: youtubeUrl,
          fetchedAt: nowIso(),
          reason: captionResult.reason,
        },
      ],
    };
  }

  return {
    ...document,
    episode: {
      ...document.episode,
      youtubeUrl,
      transcriptAvailability: "youtube-auto",
    },
    sources: [...document.sources, captionResult.source],
    segments: captionResult.segments,
    generatedAt: nowIso(),
  };
}

const existingEpisodes = await readEpisodes();
const discovery = dryRun && existingEpisodes.length > 0
  ? { episodes: existingEpisodes.slice(0, maxEpisodes), pages: [] }
  : await discoverAllEpisodes();

if (!dryRun) {
  await writeEpisodes(discovery.episodes);
}

const written = [];
const failures = [];

for (const episode of discovery.episodes) {
  try {
    const existingTranscript = !force ? await readFileSafe(transcriptPath(episode.id), "utf8").catch(() => undefined) : undefined;
    if (existingTranscript && !dryRun) {
      written.push({ episodeId: episode.id, skipped: true });
      continue;
    }

    const { html, fromCache } = await fetchOfficialHtml(episode);
    let document = normaliseOfficialTranscript(episode, html);
    document = await addYouTubeFallback(document);

    if (!dryRun) {
      await writeTranscript(episode.id, document);
    }

    written.push({
      episodeId: episode.id,
      fromCache,
      source: document.segments.length > 0 ? document.segments[0].source : document.sources.at(-1)?.kind,
      segmentCount: document.segments.length,
    });
  } catch (error) {
    failures.push({
      episodeId: episode.id,
      officialUrl: episode.officialUrl,
      reason: error.message,
    });
  }
}

const coverage = dryRun ? undefined : await writeCoverageReport();

writeJson({
  ok: failures.length === 0,
  dryRun,
  pagesVisited: discovery.pages.length,
  episodes: discovery.episodes.length,
  written: written.length,
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
  failures,
});
