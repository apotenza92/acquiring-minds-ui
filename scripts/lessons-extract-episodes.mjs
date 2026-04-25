#!/usr/bin/env node
import { existsSync } from "node:fs";
import { ensureCorpusDirs } from "./lib/corpus.mjs";
import { getTranscriptDocument, openCorpusDb } from "./lib/corpus-db.mjs";
import { createOpenAIResponse, isFatalOpenAIAuthError } from "./lib/openai-client.mjs";
import { getArg, getNumberArg, hasFlag, nowIso, writeJson, writeJsonFile } from "./lib/io.mjs";
import {
  buildTranscriptChunks,
  compactEpisodeMetadata,
  episodeExtractionManifestPath,
  episodeExtractionPath,
  extractionPromptVersion,
  getPrimaryTranscriptSource,
  parseJsonOutput,
  readJobManifest,
  shouldSkipJob,
  validateEpisodeExtraction,
  writeJobManifest,
} from "./lib/lesson-extraction.mjs";

await ensureCorpusDirs();

const episodeModel = getArg("--episode-model") ?? process.env.AMKB_EPISODE_MODEL ?? "gpt-5.5";
const episodeReasoningEffort =
  getArg("--episode-reasoning-effort") ?? process.env.AMKB_EPISODE_REASONING_EFFORT ?? "low";
const episodeId = getArg("--episode-id");
const all = hasFlag("--all");
const force = hasFlag("--force");
const retryFailed = hasFlag("--retry-failed");
const dryRun = hasFlag("--dry-run");
const sample = getNumberArg("--sample", undefined);
const limit = getNumberArg("--limit", undefined);
const maxChunkChars = getNumberArg("--max-chunk-chars", 90_000);
const effectiveLimit = episodeId ? 1 : sample ?? limit ?? (all ? Number.POSITIVE_INFINITY : 20);

const db = await openCorpusDb();
const manifestPath = episodeExtractionManifestPath();
const manifest = await readJobManifest(manifestPath);
manifest.promptVersion = extractionPromptVersion;

function selectEpisodes() {
  if (episodeId) {
    const episode = db.prepare("SELECT * FROM episodes WHERE id = ?").get(episodeId);
    if (!episode) {
      throw new Error(`Unknown episode id: ${episodeId}`);
    }
    return [episode];
  }

  const rows = db.prepare(`
    SELECT e.*, COUNT(s.id) AS segment_count
    FROM episodes e
    JOIN transcript_segments s ON s.episode_id = e.id
    GROUP BY e.id
    ORDER BY COALESCE(e.rss_published_at, e.date, '' ) DESC, e.id ASC
  `).all();

  return Number.isFinite(effectiveLimit) ? rows.slice(0, effectiveLimit) : rows;
}

function buildInstructions() {
  return [
    "You extract structured ETA knowledge from Acquiring Minds podcast transcripts.",
    "Return JSON only. Do not include transcript excerpts, quotes, or long copied phrases.",
    `Use schemaVersion \"1\" and promptVersion \"${extractionPromptVersion}\".`,
    "The output object must include: schemaVersion, promptVersion, episode, businessProfile, acquisitionProfile, operatingProfile, risks, notableClaims, lessonCandidates.",
    "businessProfile, acquisitionProfile, and operatingProfile should be compact objects with useful fields and arrays when appropriate.",
    "notableClaims must be an array of {id, claim, confidence, evidence}.",
    "lessonCandidates must be an array of {id, title, category, summary, playbook, tags, confidence, evidence}.",
    "category must be one of: buyer-fit, sourcing, deal-evaluation, financing-terms, due-diligence, closing-transition, operating, growth, risk-failure, exit-long-term-hold.",
    "confidence must be low, medium, or high.",
    "Every evidence item must include episodeId, timestamp, optional end, sourceProvider, officialUrl, optional youtubeUrl, optional audioUrl.",
    "Prefer lessons that generalise across ETA rather than episode recap.",
  ].join(" ");
}

async function extractEpisode(row) {
  const outputPath = episodeExtractionPath(row.id);
  if (shouldSkipJob({ manifest, id: row.id, outputPath, force, retryFailed })) {
    return { episodeId: row.id, skipped: true, outputPath };
  }

  const document = getTranscriptDocument(db, row.id);
  if (!document?.segments?.length) {
    throw new Error(`Episode has no transcript segments: ${row.id}`);
  }

  const chunks = buildTranscriptChunks(document, { maxChars: maxChunkChars });
  const transcriptSource = getPrimaryTranscriptSource(document);
  const transcriptChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);

  if (dryRun) {
    return {
      episodeId: row.id,
      dryRun: true,
      chunkCount: chunks.length,
      maxChunkChars,
      transcriptChars,
      outputPath,
    };
  }

  const startedAt = nowIso();
  manifest.jobs ??= {};
  manifest.jobs[row.id] = {
    state: "running",
    model: episodeModel,
    reasoningEffort: episodeReasoningEffort,
    promptVersion: extractionPromptVersion,
    transcriptSource,
    chunkCount: chunks.length,
    maxChunkChars,
    transcriptChars,
    attempts: Number(manifest.jobs?.[row.id]?.attempts ?? 0) + 1,
    startedAt,
    updatedAt: startedAt,
  };
  await writeJobManifest(manifestPath, manifest);

  const response = await createOpenAIResponse({
    model: episodeModel,
    reasoningEffort: episodeReasoningEffort,
    instructions: buildInstructions(),
    input: JSON.stringify({
      episode: compactEpisodeMetadata(document),
      chunking: {
        chunkCount: chunks.length,
        maxChunkChars,
        note: "Chunks are ordered and together form the complete transcript for this episode.",
      },
      chunks,
    }),
  });

  if (!response.ok) {
    const fatal = isFatalOpenAIAuthError(response);
    manifest.jobs[row.id] = {
      ...manifest.jobs[row.id],
      state: "failed",
      failureReason: response.reason ?? response.status ?? "OpenAI request failed",
      fatal,
      completedAt: nowIso(),
    };
    await writeJobManifest(manifestPath, manifest);
    return { episodeId: row.id, ok: false, fatal, response };
  }

  const parsed = parseJsonOutput(response.outputText);
  const extraction = validateEpisodeExtraction(parsed.episodeExtraction ?? parsed);
  await writeJsonFile(outputPath, extraction);

  manifest.jobs[row.id] = {
    ...manifest.jobs[row.id],
    state: "completed",
    outputPath,
    completedAt: nowIso(),
  };
  await writeJobManifest(manifestPath, manifest);

  return {
    episodeId: row.id,
    ok: true,
    outputPath,
    chunkCount: chunks.length,
    maxChunkChars,
    transcriptChars,
    lessonCandidates: extraction.lessonCandidates.length,
    notableClaims: extraction.notableClaims.length,
  };
}

const selectedEpisodes = selectEpisodes();
const results = [];

for (const episode of selectedEpisodes) {
  try {
    results.push(await extractEpisode(episode));
  } catch (error) {
    manifest.jobs ??= {};
    manifest.jobs[episode.id] = {
      ...(manifest.jobs[episode.id] ?? {}),
      state: "failed",
      failureReason: error.message,
      completedAt: nowIso(),
    };
    await writeJobManifest(manifestPath, manifest);
    results.push({ episodeId: episode.id, ok: false, error: error.message });
  }

  if (results.at(-1)?.fatal) {
    break;
  }
}

db.close();

writeJson({
  ok: results.every((result) => result.ok || result.skipped || result.dryRun),
  dryRun,
  model: episodeModel,
  reasoningEffort: episodeReasoningEffort,
  selected: selectedEpisodes.length,
  completed: results.filter((result) => result.ok).length,
  skipped: results.filter((result) => result.skipped).length,
  failed: results.filter((result) => result.ok === false).length,
  results,
  manifest: existsSync(manifestPath) ? manifestPath : undefined,
});
