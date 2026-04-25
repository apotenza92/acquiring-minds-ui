#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { getNumberArg, hasFlag, readJsonInput, sleep, writeJson, writeTextFile } from "./lib/io.mjs";
import { rawHtmlPath } from "./lib/corpus.mjs";

const input = await readJsonInput();
const episodes = Array.isArray(input) ? input : input.episodes;
const delayMs = getNumberArg("--delay-ms", 300);
const retries = getNumberArg("--retries", 2);
const useCache = hasFlag("--cache");
const force = hasFlag("--force");

if (!Array.isArray(episodes)) {
  throw new Error("Expected an array of episodes or an object with episodes");
}

const pages = [];

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) {
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError;
}

for (const episode of episodes) {
  if (!episode.officialUrl) {
    continue;
  }

  const cachePath = rawHtmlPath(episode.id);

  if (useCache && !force) {
    try {
      pages.push({
        episodeId: episode.id,
        officialUrl: episode.officialUrl,
        ok: true,
        fromCache: true,
        html: await readFile(cachePath, "utf8"),
      });
      continue;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const response = await fetchWithRetry(episode.officialUrl);
  if (!response.ok) {
    pages.push({
      episodeId: episode.id,
      officialUrl: episode.officialUrl,
      ok: false,
      status: response.status,
    });
    continue;
  }

  const html = await response.text();
  if (useCache) {
    await writeTextFile(cachePath, html);
  }

  pages.push({
    episodeId: episode.id,
    officialUrl: episode.officialUrl,
    ok: true,
    fromCache: false,
    html,
  });

  await sleep(delayMs);
}

writeJson({ pages });
