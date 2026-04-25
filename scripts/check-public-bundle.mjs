#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeJson } from "./lib/io.mjs";

const forbiddenPatterns = [
  /\.corpus/,
  /corpus\.sqlite/,
  /transcript_segments/,
  /local-transcripts/,
  /youtube-captions\//,
  /OPENAI_API_KEY/,
  /AMKB_OPENAI/,
  /AMKB_ALLOW_TRANSMIT/,
  /\.codex/,
  /auth\.json/,
  /cookies\.txt/,
];

async function listFiles(dir) {
  const entries = await readdir(dir);
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      files.push(...await listFiles(path));
    } else {
      files.push(path);
    }
  }

  return files;
}

const findings = [];

for (const file of await listFiles("src")) {
  const text = await readFile(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) {
      findings.push({ file, pattern: pattern.source });
    }
  }
}

if (findings.length > 0) {
  writeJson({
    ok: false,
    reason: "Public UI source references local corpus, transcript storage, or auth material.",
    findings,
  });
  process.exit(1);
}

writeJson({
  ok: true,
  checked: "src",
});
