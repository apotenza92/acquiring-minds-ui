#!/usr/bin/env node
import { ensureCorpusDirs } from "./lib/corpus.mjs";
import { writeJson } from "./lib/io.mjs";
import { writeCoverageReport } from "./lib/corpus-report.mjs";

await ensureCorpusDirs();
writeJson(await writeCoverageReport());
