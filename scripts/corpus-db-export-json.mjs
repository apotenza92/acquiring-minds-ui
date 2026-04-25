#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { corpusPaths, transcriptPath, writeEpisodes, writeTranscript } from "./lib/corpus.mjs";
import { getTranscriptDocument, openCorpusDb, rowToEpisode } from "./lib/corpus-db.mjs";
import { writeJson } from "./lib/io.mjs";

const db = await openCorpusDb();
const rows = db.prepare("SELECT * FROM episodes ORDER BY COALESCE(rss_published_at, '' ) DESC, id ASC").all();
const episodes = rows.map(rowToEpisode);

await writeEpisodes(episodes);
await mkdir(dirname(transcriptPath("placeholder")), { recursive: true });

let transcripts = 0;
let segments = 0;
for (const episode of episodes) {
  const document = getTranscriptDocument(db, episode.id);
  if (!document) {
    continue;
  }
  await writeTranscript(episode.id, document);
  transcripts += 1;
  segments += document.segments.length;
}

db.close();

writeJson({
  ok: true,
  database: corpusPaths.database,
  episodes: episodes.length,
  transcripts,
  segments,
});
