#!/usr/bin/env node
import { readEpisodes, readTranscript } from "./lib/corpus.mjs";
import { getNumberArg, writeJson } from "./lib/io.mjs";

const limit = getNumberArg("--limit", 10);
const episodes = (await readEpisodes()).slice(0, limit);
const samples = [];

for (const episode of episodes) {
  const document = await readTranscript(episode.id);
  samples.push({
    id: episode.id,
    title: episode.title,
    guest: episode.guest,
    date: episode.date,
    transcriptAvailability: document?.episode?.transcriptAvailability ?? episode.transcriptAvailability,
    segmentCount: document?.segments?.length ?? 0,
    sources: document?.sources?.map((source) => ({
      kind: source.kind,
      url: source.url,
      status: source.status,
      reason: source.reason,
    })) ?? [],
  });
}

writeJson({ samples });
