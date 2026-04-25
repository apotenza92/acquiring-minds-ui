#!/usr/bin/env node
import { ensureCorpusDirs } from "./lib/corpus.mjs";
import { createOpenAIResponse } from "./lib/openai-client.mjs";
import { getArg, getNumberArg, hasFlag, nowIso, writeJson, writeJsonFile } from "./lib/io.mjs";
import {
  clusterFileName,
  clusterManifestPath,
  clusterPromptVersion,
  clusterExtractionPath,
  flattenLessonCandidates,
  groupCandidatesByCategory,
  parseJsonOutput,
  readEpisodeExtractionFiles,
  readJobManifest,
  shouldSkipJob,
  validateLessonClusterFile,
  writeJobManifest,
} from "./lib/lesson-extraction.mjs";

await ensureCorpusDirs();

const clusterModel = getArg("--cluster-model") ?? process.env.AMKB_CLUSTER_MODEL ?? "gpt-5.5";
const clusterReasoningEffort =
  getArg("--cluster-reasoning-effort") ?? process.env.AMKB_CLUSTER_REASONING_EFFORT ?? "high";
const all = hasFlag("--all");
const force = hasFlag("--force");
const retryFailed = hasFlag("--retry-failed");
const dryRun = hasFlag("--dry-run");
const sample = getNumberArg("--sample", undefined);
const limit = getNumberArg("--limit", undefined);
const maxCandidatesPerCategory = getNumberArg("--max-candidates-per-category", 160);
const effectiveLimit = sample ?? limit ?? (all ? Number.POSITIVE_INFINITY : 20);
const sampleSize = Number.isFinite(effectiveLimit) ? effectiveLimit : undefined;

const manifestPath = clusterManifestPath();
const manifest = await readJobManifest(manifestPath);
manifest.promptVersion = clusterPromptVersion;

function buildInstructions(category) {
  return [
    "You synthesise Acquiring Minds ETA lesson candidates into broader knowledge-base lessons.",
    "Use only the supplied structured episode extraction JSON. Do not ask for or use raw transcript text.",
    "Return JSON only. Do not include transcript excerpts, quotes, or long copied phrases.",
    `Use schemaVersion \"1\" and promptVersion \"${clusterPromptVersion}\".`,
    `All returned lessons must use category \"${category}\".`,
    "Return {schemaVersion, promptVersion, category, lessons}.",
    "Each lesson must include: id, title, category, summary, playbook, tags, confidence, evidence.",
    "Evidence must include episodeId, timestamp, optional end, sourceProvider, officialUrl, optional youtubeUrl, optional audioUrl.",
    "Prefer lessons supported by multiple episodes, but keep distinctive high-signal single-episode lessons when useful.",
    "Keep summaries concise and playbook notes operational.",
  ].join(" ");
}

function normaliseClusterFile(parsed, category) {
  const file = Array.isArray(parsed)
    ? { schemaVersion: "1", promptVersion: clusterPromptVersion, category, lessons: parsed }
    : parsed.lessons
      ? parsed
      : parsed.clusterFile;
  if (!file) {
    throw new Error("Cluster response must include a lessons array");
  }
  return validateLessonClusterFile({
    schemaVersion: file.schemaVersion ?? "1",
    promptVersion: file.promptVersion ?? clusterPromptVersion,
    category: file.category ?? category,
    lessons: file.lessons ?? [],
  });
}

const extractions = await readEpisodeExtractionFiles({ limit: effectiveLimit });
const candidates = flattenLessonCandidates(extractions);
const groups = groupCandidatesByCategory(candidates);
const results = [];

for (const [category, items] of groups) {
  const selected = items.slice(0, maxCandidatesPerCategory);
  const name = clusterFileName({ category, sampleSize });
  const outputPath = clusterExtractionPath(name);
  if (shouldSkipJob({ manifest, id: name, outputPath, force, retryFailed })) {
    results.push({ category, skipped: true, outputPath });
    continue;
  }

  if (dryRun) {
    results.push({ category, dryRun: true, candidateCount: selected.length, outputPath });
    continue;
  }

  const startedAt = nowIso();
  manifest.jobs ??= {};
  manifest.jobs[name] = {
    state: "running",
    model: clusterModel,
    reasoningEffort: clusterReasoningEffort,
    promptVersion: clusterPromptVersion,
    category,
    candidateCount: selected.length,
    extractionCount: extractions.length,
    attempts: Number(manifest.jobs?.[name]?.attempts ?? 0) + 1,
    startedAt,
    updatedAt: startedAt,
  };
  await writeJobManifest(manifestPath, manifest);

  const response = await createOpenAIResponse({
    model: clusterModel,
    reasoningEffort: clusterReasoningEffort,
    instructions: buildInstructions(category),
    input: JSON.stringify({
      category,
      source: "episode extraction JSON only",
      candidates: selected,
    }),
  });

  if (!response.ok) {
    manifest.jobs[name] = {
      ...manifest.jobs[name],
      state: "failed",
      failureReason: response.reason ?? response.status ?? "OpenAI request failed",
      completedAt: nowIso(),
    };
    await writeJobManifest(manifestPath, manifest);
    results.push({ category, ok: false, response });
    continue;
  }

  try {
    const parsed = parseJsonOutput(response.outputText);
    const clusterFile = normaliseClusterFile(parsed, category);
    await writeJsonFile(outputPath, clusterFile);
    manifest.jobs[name] = {
      ...manifest.jobs[name],
      state: "completed",
      outputPath,
      completedAt: nowIso(),
    };
    await writeJobManifest(manifestPath, manifest);
    results.push({
      category,
      ok: true,
      outputPath,
      lessonCount: clusterFile.lessons.length,
      candidateCount: selected.length,
    });
  } catch (error) {
    manifest.jobs[name] = {
      ...manifest.jobs[name],
      state: "failed",
      failureReason: error.message,
      completedAt: nowIso(),
    };
    await writeJobManifest(manifestPath, manifest);
    results.push({ category, ok: false, error: error.message });
  }
}

writeJson({
  ok: results.every((result) => result.ok || result.skipped || result.dryRun),
  dryRun,
  model: clusterModel,
  reasoningEffort: clusterReasoningEffort,
  extractionCount: extractions.length,
  candidateCount: candidates.length,
  completed: results.filter((result) => result.ok).length,
  skipped: results.filter((result) => result.skipped).length,
  failed: results.filter((result) => result.ok === false).length,
  results,
  manifest: manifestPath,
});
