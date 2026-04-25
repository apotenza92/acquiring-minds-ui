#!/usr/bin/env node
import { discoverEpisodesFromIndex, getNextEpisodeIndexUrl } from "./adapters/acquiring-minds.mjs";
import { getArg, getNumberArg, hasFlag, readTextInput, sleep, writeJson } from "./lib/io.mjs";

const inputHtml = await readTextInput();
const startUrl = getArg("--url") || "https://acquiringminds.co/episodes";
const maxPages = getNumberArg("--max-pages", 50);
const delayMs = getNumberArg("--delay-ms", 250);

async function fetchPage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

const allEpisodes = [];
const seenUrls = new Set();
const visitedPages = [];

if (inputHtml.trim()) {
  allEpisodes.push(...discoverEpisodesFromIndex(inputHtml, startUrl));
} else {
  let nextUrl = startUrl;
  for (let page = 0; nextUrl && page < maxPages; page += 1) {
    if (visitedPages.includes(nextUrl)) {
      break;
    }

    const html = await fetchPage(nextUrl);
    visitedPages.push(nextUrl);
    allEpisodes.push(...discoverEpisodesFromIndex(html, nextUrl));
    nextUrl = getNextEpisodeIndexUrl(html, nextUrl);

    if (nextUrl && !hasFlag("--no-delay")) {
      await sleep(delayMs);
    }
  }
}

const episodes = allEpisodes.filter((episode) => {
  if (seenUrls.has(episode.officialUrl)) {
    return false;
  }
  seenUrls.add(episode.officialUrl);
  return true;
});

writeJson({
  adapter: "official-acquiring-minds",
  pages: visitedPages,
  episodes,
});
