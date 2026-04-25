#!/usr/bin/env node
import { importJsonCorpus, openCorpusDb } from "./lib/corpus-db.mjs";
import { corpusPaths } from "./lib/corpus.mjs";
import { writeJson } from "./lib/io.mjs";

const db = await openCorpusDb();
const result = await importJsonCorpus(db);
db.close();

writeJson({
  ok: true,
  database: corpusPaths.database,
  ...result,
});
