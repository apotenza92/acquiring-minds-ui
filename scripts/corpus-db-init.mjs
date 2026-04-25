#!/usr/bin/env node
import { openCorpusDb } from "./lib/corpus-db.mjs";
import { corpusPaths } from "./lib/corpus.mjs";
import { writeJson } from "./lib/io.mjs";

const db = await openCorpusDb();
db.close();

writeJson({
  ok: true,
  database: corpusPaths.database,
});
