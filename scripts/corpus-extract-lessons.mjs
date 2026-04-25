#!/usr/bin/env node
import { writeJson } from "./lib/io.mjs";

writeJson({
  ok: false,
  deprecated: true,
  reason: "The old whole-transcript lesson extractor has been replaced by staged extraction commands.",
  commands: [
    "npm run lessons:extract-episodes -- --sample 20 --allow-transmit",
    "npm run lessons:cluster -- --sample 20 --allow-transmit",
    "npm run lessons:promote -- --input .corpus/acquiring-minds/extractions/reviewed-lessons.json",
  ],
});

process.exit(1);
