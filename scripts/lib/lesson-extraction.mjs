import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { corpusPaths } from "./corpus.mjs";
import { readJsonFile, slugify, writeJsonFile } from "./io.mjs";

export const extractionPromptVersion = "episode-extraction-v1";
export const clusterPromptVersion = "lesson-cluster-v1";

export const categoryIds = [
  "buyer-fit",
  "sourcing",
  "deal-evaluation",
  "financing-terms",
  "due-diligence",
  "closing-transition",
  "operating",
  "growth",
  "risk-failure",
  "exit-long-term-hold",
];

const categorySet = new Set(categoryIds);
const confidenceSet = new Set(["low", "medium", "high"]);

export function episodeExtractionPath(episodeId) {
  return join(corpusPaths.episodeExtractionsDir, `${episodeId}.json`);
}

export function clusterExtractionPath(name) {
  return join(corpusPaths.clusterExtractionsDir, `${name}.json`);
}

export function episodeExtractionManifestPath() {
  return join(corpusPaths.extractionManifestsDir, "episode-extraction-jobs.json");
}

export function clusterManifestPath() {
  return join(corpusPaths.extractionManifestsDir, "cluster-jobs.json");
}

export function getPrimaryTranscriptSource(document) {
  const sourceKind = document.segments?.[0]?.source;
  const matchingSource = [...(document.sources ?? [])].reverse().find((source) => source.kind === sourceKind);
  return {
    kind: sourceKind ?? matchingSource?.kind ?? "unknown",
    provider: matchingSource?.provider ?? sourceKind ?? "unknown",
    url: matchingSource?.url ?? document.episode.youtubeUrl ?? document.episode.officialUrl,
    model: matchingSource?.model,
  };
}

export function compactEpisodeMetadata(document) {
  const source = getPrimaryTranscriptSource(document);
  return {
    id: document.episode.id,
    podcastId: document.episode.podcastId,
    title: document.episode.title,
    guest: document.episode.guest,
    date: document.episode.date,
    officialUrl: document.episode.officialUrl,
    youtubeUrl: document.episode.youtubeUrl,
    audioUrl: document.episode.audioUrl,
    transcriptSource: source,
  };
}

export function buildTranscriptChunks(document, options = {}) {
  const maxChars = options.maxChars ?? 90_000;
  const chunks = [];
  let current = [];
  let currentChars = 0;
  let startSegmentIndex = 0;

  for (const [index, segment] of (document.segments ?? []).entries()) {
    const line = `[${segment.start}${segment.end ? `-${segment.end}` : ""}] ${segment.speaker ? `${segment.speaker}: ` : ""}${segment.text}`;
    const nextChars = currentChars + line.length + 1;

    if (current.length > 0 && nextChars > maxChars) {
      chunks.push({
        chunkIndex: chunks.length,
        startSegmentIndex,
        endSegmentIndex: index - 1,
        start: document.segments[startSegmentIndex]?.start,
        end: document.segments[index - 1]?.end ?? document.segments[index - 1]?.start,
        text: current.join("\n"),
      });
      current = [];
      currentChars = 0;
      startSegmentIndex = index;
    }

    current.push(line);
    currentChars += line.length + 1;
  }

  if (current.length > 0) {
    const endIndex = (document.segments?.length ?? 1) - 1;
    chunks.push({
      chunkIndex: chunks.length,
      startSegmentIndex,
      endSegmentIndex: endIndex,
      start: document.segments[startSegmentIndex]?.start,
      end: document.segments[endIndex]?.end ?? document.segments[endIndex]?.start,
      text: current.join("\n"),
    });
  }

  return chunks;
}

export function parseJsonOutput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("Model returned empty output");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1].trim());
    }

    const first = trimmed.search(/[\[{]/);
    const lastObject = trimmed.lastIndexOf("}");
    const lastArray = trimmed.lastIndexOf("]");
    const last = Math.max(lastObject, lastArray);
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }

    throw new Error("Model output was not valid JSON");
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value, path) {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertOptionalString(value, path) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error(`${path} must be a string when present`);
  }
}

function assertStringArray(value, path) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be an array of strings`);
  }
}

function assertConfidence(value, path) {
  if (!confidenceSet.has(value)) {
    throw new Error(`${path} must be low, medium, or high`);
  }
}

function assertCategory(value, path) {
  if (!categorySet.has(value)) {
    throw new Error(`${path} must be a known lesson category`);
  }
}

function assertNoTranscriptFields(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoTranscriptFields(item, `${path}[${index}]`));
    return;
  }

  if (!isRecord(value)) {
    if (typeof value === "string") {
      assertNoLongQuotedText(value, path);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (["transcript", "transcriptText", "excerpt", "quote", "quotes"].includes(key)) {
      throw new Error(`${path}.${key} must not contain transcript text`);
    }
    assertNoTranscriptFields(child, `${path}.${key}`);
  }
}

export function assertNoLongQuotedText(value, path = "value") {
  const matches = String(value).matchAll(/["“]([^"”]{120,})["”]/g);
  for (const match of matches) {
    const words = match[1].trim().split(/\s+/).filter(Boolean);
    if (words.length > 25) {
      throw new Error(`${path} contains a long quotation`);
    }
  }
}

function validateEvidence(evidence, path, expectedEpisodeId) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error(`${path} must include at least one evidence reference`);
  }

  evidence.forEach((source, index) => {
    const sourcePath = `${path}[${index}]`;
    assertRecord(source, sourcePath);
    assertString(source.episodeId, `${sourcePath}.episodeId`);
    if (expectedEpisodeId && source.episodeId !== expectedEpisodeId) {
      throw new Error(`${sourcePath}.episodeId must match the extraction episode`);
    }
    assertString(source.timestamp ?? source.start, `${sourcePath}.timestamp`);
    assertOptionalString(source.end, `${sourcePath}.end`);
    assertOptionalString(source.sourceProvider, `${sourcePath}.sourceProvider`);
    assertString(source.officialUrl, `${sourcePath}.officialUrl`);
    assertOptionalString(source.youtubeUrl, `${sourcePath}.youtubeUrl`);
    assertOptionalString(source.audioUrl, `${sourcePath}.audioUrl`);
  });
}

function validateLessonCandidate(candidate, path, expectedEpisodeId) {
  assertRecord(candidate, path);
  assertString(candidate.id, `${path}.id`);
  assertString(candidate.title, `${path}.title`);
  assertCategory(candidate.category, `${path}.category`);
  assertString(candidate.summary, `${path}.summary`);
  assertStringArray(candidate.playbook, `${path}.playbook`);
  assertStringArray(candidate.tags, `${path}.tags`);
  assertConfidence(candidate.confidence, `${path}.confidence`);
  validateEvidence(candidate.evidence, `${path}.evidence`, expectedEpisodeId);
}

export function validateEpisodeExtraction(value) {
  assertRecord(value, "episodeExtraction");
  assertString(value.schemaVersion, "schemaVersion");
  assertString(value.promptVersion, "promptVersion");
  assertRecord(value.episode, "episode");
  assertString(value.episode.id, "episode.id");
  assertString(value.episode.title, "episode.title");
  assertString(value.episode.officialUrl, "episode.officialUrl");
  assertRecord(value.businessProfile, "businessProfile");
  assertRecord(value.acquisitionProfile, "acquisitionProfile");
  assertRecord(value.operatingProfile, "operatingProfile");
  assertStringArray(value.risks, "risks");

  if (!Array.isArray(value.notableClaims)) {
    throw new Error("notableClaims must be an array");
  }

  value.notableClaims.forEach((claim, index) => {
    const path = `notableClaims[${index}]`;
    assertRecord(claim, path);
    assertString(claim.id, `${path}.id`);
    assertString(claim.claim, `${path}.claim`);
    assertConfidence(claim.confidence, `${path}.confidence`);
    validateEvidence(claim.evidence, `${path}.evidence`, value.episode.id);
  });

  if (!Array.isArray(value.lessonCandidates)) {
    throw new Error("lessonCandidates must be an array");
  }

  value.lessonCandidates.forEach((candidate, index) =>
    validateLessonCandidate(candidate, `lessonCandidates[${index}]`, value.episode.id),
  );
  assertNoTranscriptFields(value, "episodeExtraction");
  return value;
}

export function validateLessonCluster(value) {
  assertRecord(value, "lessonCluster");
  assertString(value.id, "id");
  assertString(value.title, "title");
  assertCategory(value.category, "category");
  assertString(value.summary, "summary");
  assertStringArray(value.playbook, "playbook");
  assertStringArray(value.tags, "tags");
  assertConfidence(value.confidence, "confidence");
  validateEvidence(value.evidence, "evidence");
  assertNoTranscriptFields(value, "lessonCluster");
  return value;
}

export function validateLessonClusterFile(value) {
  assertRecord(value, "clusterFile");
  assertString(value.schemaVersion, "schemaVersion");
  assertString(value.promptVersion, "promptVersion");
  if (value.category !== undefined) {
    assertCategory(value.category, "category");
  }
  if (!Array.isArray(value.lessons)) {
    throw new Error("lessons must be an array");
  }
  value.lessons.forEach((lesson, index) => validateLessonCluster(lesson, `lessons[${index}]`));
  return value;
}

function normaliseTranscriptAvailability(value) {
  if (["official", "youtube-auto", "local-whisper", "summary-only", "unknown"].includes(value)) {
    return value;
  }
  return "unknown";
}

function dateFromPublishedAt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function toUiEpisodeSource(episode) {
  assertRecord(episode, "episode");
  assertString(episode.id, "episode.id");
  assertString(episode.podcastId, "episode.podcastId");
  assertString(episode.title, "episode.title");
  assertString(episode.guest, "episode.guest");
  assertString(episode.officialUrl, "episode.officialUrl");

  const date = optionalString(episode.date) ?? dateFromPublishedAt(episode.rssPublishedAt) ?? "Unknown date";
  return {
    id: episode.id,
    podcastId: episode.podcastId,
    title: episode.title,
    guest: episode.guest,
    date,
    officialUrl: episode.officialUrl,
    ...(optionalString(episode.youtubeUrl) ? { youtubeUrl: optionalString(episode.youtubeUrl) } : {}),
    ...(optionalString(episode.audioUrl) ? { audioUrl: optionalString(episode.audioUrl) } : {}),
    transcriptAvailability: normaliseTranscriptAvailability(episode.transcriptAvailability),
  };
}

export function mergeEpisodeSources(existingEpisodes, corpusEpisodes = []) {
  const byId = new Map();
  for (const episode of corpusEpisodes) {
    byId.set(episode.id, toUiEpisodeSource(episode));
  }
  for (const episode of existingEpisodes) {
    byId.set(episode.id, toUiEpisodeSource(episode));
  }
  return Array.from(byId.values()).sort((a, b) => {
    const dateComparison = b.date.localeCompare(a.date);
    if (dateComparison !== 0) {
      return dateComparison;
    }
    return a.title.localeCompare(b.title);
  });
}

export function toUiKnowledgeBase(existingKnowledgeBase, reviewedClusterFile, options = {}) {
  const clusterFile = validateLessonClusterFile(reviewedClusterFile);
  const episodes = mergeEpisodeSources(existingKnowledgeBase.episodes, options.episodes);
  const episodeIds = new Set(episodes.map((episode) => episode.id));
  const lessons = clusterFile.lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    category: lesson.category,
    summary: lesson.summary,
    playbook: lesson.playbook,
    tags: lesson.tags,
    evidence: lesson.evidence.map((source) => {
      if (!episodeIds.has(source.episodeId)) {
        throw new Error(`Unknown episodeId in reviewed lesson evidence: ${source.episodeId}`);
      }
      return {
        episodeId: source.episodeId,
        timestamp: source.timestamp ?? source.start,
        officialUrl: source.officialUrl,
        ...(source.youtubeUrl ? { youtubeUrl: source.youtubeUrl } : {}),
        ...(source.audioUrl ? { audioUrl: source.audioUrl } : {}),
      };
    }),
  }));

  return {
    ...existingKnowledgeBase,
    episodes,
    lessons,
  };
}

export async function readEpisodeExtractionFiles(options = {}) {
  const files = (await readdir(corpusPaths.episodeExtractionsDir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const selected = Number.isFinite(options.limit) ? files.slice(0, options.limit) : files;
  const extractions = [];
  for (const file of selected) {
    const extraction = validateEpisodeExtraction(await readJsonFile(join(corpusPaths.episodeExtractionsDir, file)));
    extractions.push(extraction);
  }
  return extractions;
}

export function flattenLessonCandidates(extractions) {
  return extractions.flatMap((extraction) =>
    extraction.lessonCandidates.map((candidate) => ({
      ...candidate,
      episode: {
        id: extraction.episode.id,
        title: extraction.episode.title,
        guest: extraction.episode.guest,
        date: extraction.episode.date,
      },
    })),
  );
}

export function groupCandidatesByCategory(candidates) {
  const groups = new Map(categoryIds.map((category) => [category, []]));
  for (const candidate of candidates) {
    groups.get(candidate.category)?.push(candidate);
  }
  return [...groups.entries()].filter(([, items]) => items.length > 0);
}

export async function readJobManifest(path) {
  return readJsonFile(path, { jobs: {} });
}

export async function writeJobManifest(path, manifest) {
  await writeJsonFile(path, {
    ...manifest,
    updatedAt: new Date().toISOString(),
  });
}

export function shouldSkipJob({ manifest, id, outputPath, force = false, retryFailed = false }) {
  if (force) {
    return false;
  }

  const job = manifest.jobs?.[id];
  if (job?.state === "failed") {
    return !retryFailed;
  }

  return job?.state === "completed" && existsSync(outputPath);
}

export function makeLessonId(category, title) {
  return `${category}-${slugify(title)}`.slice(0, 96).replace(/-+$/, "");
}

export function clusterFileName({ category, sampleSize }) {
  const suffix = sampleSize ? `sample-${String(sampleSize).padStart(3, "0")}` : "all";
  return `${category}-${suffix}`;
}

export function reviewedInputLabel(inputPath) {
  return basename(inputPath).replace(/\.json$/, "");
}
