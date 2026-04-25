#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { corpusPaths, ensureCorpusDirs } from "./lib/corpus.mjs";
import { getArg, hasFlag, readJsonFile, writeJson, writeJsonFile } from "./lib/io.mjs";
import { reviewedInputLabel, toUiKnowledgeBase } from "./lib/lesson-extraction.mjs";

await ensureCorpusDirs();

const inputPath = resolve(getArg("--input") ?? corpusPaths.reviewedLessons);
const outputPath = resolve(getArg("--output") ?? "src/data/acquiring-minds.lessons.json");
const dryRun = hasFlag("--dry-run");

const existingKnowledgeBase = JSON.parse(await readFile(outputPath, "utf8"));
const reviewedClusterFile = await readJsonFile(inputPath);

if (!reviewedClusterFile) {
  throw new Error(`Reviewed lesson file not found: ${inputPath}`);
}

const promoted = toUiKnowledgeBase(existingKnowledgeBase, reviewedClusterFile);

if (!dryRun) {
  await writeJsonFile(outputPath, promoted);
}

writeJson({
  ok: true,
  dryRun,
  input: inputPath,
  output: outputPath,
  source: reviewedInputLabel(inputPath),
  podcast: promoted.podcast.id,
  episodes: promoted.episodes.length,
  lessons: promoted.lessons.length,
});
