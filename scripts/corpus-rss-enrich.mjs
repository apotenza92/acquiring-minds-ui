#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { corpusPaths, ensureCorpusDirs, readEpisodes, readTranscript, writeEpisodes, writeTranscript } from "./lib/corpus.mjs";
import { getArg, hasFlag, nowIso, writeJson } from "./lib/io.mjs";
import { matchRssItemsToEpisodes, parseTransistorRss } from "./adapters/transistor-rss.mjs";

const feedUrl = getArg("--feed-url") ?? "https://feeds.transistor.fm/acquiring-minds";
const inputPath = getArg("--input");
const dryRun = hasFlag("--dry-run");

await ensureCorpusDirs();

async function fetchFeed() {
  if (inputPath) {
    return readFile(inputPath, "utf8");
  }

  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error(`RSS fetch failed with ${response.status}`);
  }
  return response.text();
}

const xml = await fetchFeed();
if (!dryRun) {
  await writeFile(corpusPaths.rssFeed, xml, "utf8");
}

const rssItems = parseTransistorRss(xml);
const episodes = await readEpisodes();
const matches = matchRssItemsToEpisodes(episodes, rssItems);

const enrichedEpisodes = matches.map(({ episode, item }) => {
  if (!item) {
    return episode;
  }

  return {
    ...episode,
    audioUrl: item.audioUrl || episode.audioUrl,
    rssGuid: item.guid || episode.rssGuid,
    rssPublishedAt: item.pubDate || episode.rssPublishedAt,
    rssTranscriptUrls: item.transcripts,
  };
});

const updatedTranscripts = [];
if (!dryRun) {
  await writeEpisodes(enrichedEpisodes);
}

for (const { episode, item, matched } of matches) {
  if (!matched || dryRun) {
    continue;
  }

  const document = await readTranscript(episode.id).catch(() => undefined);
  if (!document) {
    continue;
  }

  const nextDocument = {
    ...document,
    episode: {
      ...document.episode,
      audioUrl: item.audioUrl || document.episode.audioUrl,
      rssGuid: item.guid || document.episode.rssGuid,
      rssPublishedAt: item.pubDate || document.episode.rssPublishedAt,
      rssTranscriptUrls: item.transcripts,
    },
    generatedAt: nowIso(),
  };
  await writeTranscript(episode.id, nextDocument);
  updatedTranscripts.push(episode.id);
}

writeJson({
  ok: true,
  dryRun,
  feedUrl,
  rssItems: rssItems.length,
  episodes: episodes.length,
  matched: matches.filter((match) => match.matched).length,
  audioUrls: matches.filter((match) => match.item?.audioUrl).length,
  rssTranscriptTags: rssItems.reduce((total, item) => total + item.transcripts.length, 0),
  unmatchedEpisodeIds: matches.filter((match) => !match.matched).map((match) => match.episode.id),
  updatedTranscripts: updatedTranscripts.length,
});
