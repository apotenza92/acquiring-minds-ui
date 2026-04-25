#!/usr/bin/env node
import { join } from "node:path";
import { corpusPaths, ensureCorpusDirs, readEpisodes, readTranscript, writeTranscript } from "./lib/corpus.mjs";
import { getArg, getNumberArg, hasFlag, nowIso, writeJson } from "./lib/io.mjs";
import { transcribeAudioWithLocalWhisper } from "./adapters/local-whisper.mjs";
import { writeCoverageReport } from "./lib/corpus-report.mjs";

await ensureCorpusDirs();

const episodeId = getArg("--episode-id");
const maxEpisodes = getNumberArg("--max-episodes", Number.POSITIVE_INFINITY);
const clipSeconds = getNumberArg("--clip-seconds", 0);
const clipStartSeconds = getNumberArg("--clip-start-seconds", 0);
const localProvider = getArg("--local-provider") ?? getArg("--provider") ?? "whisper";
const model = getArg("--model") ?? (
  localProvider === "mlx" ? "mlx-community/whisper-large-v3-turbo" : "tiny"
);
const fallbackModel = getArg("--fallback-model") ?? "small.en";
const device = getArg("--device");
const force = hasFlag("--force");
const dryRun = hasFlag("--dry-run");
const sampleOnly = hasFlag("--sample-only");

if (clipSeconds > 0 && !sampleOnly) {
  throw new Error("Refusing to write a clipped transcript as complete. Use --sample-only for clipped transcription tests.");
}

const episodes = await readEpisodes();
const results = [];
let processed = 0;

for (const episode of episodes) {
  if (episodeId && episode.id !== episodeId) {
    continue;
  }
  if (processed >= maxEpisodes) {
    break;
  }

  const document = await readTranscript(episode.id).catch(() => undefined);
  if (!document) {
    continue;
  }
  if (!force && document.segments?.length > 0) {
    continue;
  }

  const audioUrl = document.episode?.audioUrl || episode.audioUrl;
  if (!audioUrl) {
    results.push({
      episodeId: episode.id,
      skipped: true,
      reason: "No RSS audio URL is available; run npm run corpus:rss-enrich first",
    });
    continue;
  }

  processed += 1;
  if (dryRun) {
    results.push({
      episodeId: episode.id,
      skipped: false,
      dryRun: true,
      audioUrl,
    });
    continue;
  }

  const result = await transcribeAudioWithLocalWhisper(audioUrl, {
    outputDir: join(corpusPaths.localTranscriptsDir, episode.id),
    clipSeconds,
    clipStartSeconds,
    provider: localProvider,
    model,
    fallbackModel,
    device,
    force,
  });

  if (!result.ok || result.segments.length === 0) {
    if (sampleOnly) {
      results.push({
        episodeId: episode.id,
        skipped: false,
        source: "missing",
        segmentCount: 0,
        reason: result.reason,
      });
      continue;
    }

    const failedDocument = {
      ...document,
      episode: {
        ...document.episode,
        audioUrl,
      },
      sources: [
        ...(document.sources ?? []),
        {
          kind: "missing",
          provider: "local-whisper",
          url: audioUrl,
          fetchedAt: nowIso(),
          reason: result.reason,
        },
      ],
    };
    await writeTranscript(episode.id, failedDocument);
    results.push({
      episodeId: episode.id,
      skipped: false,
      source: "missing",
      segmentCount: 0,
      reason: result.reason,
    });
    continue;
  }

  if (sampleOnly) {
    results.push({
      episodeId: episode.id,
      skipped: false,
      source: "local-whisper",
      segmentCount: result.segments.length,
      clipSeconds,
      cachePath: result.source.cachePath,
    });
    continue;
  }

  const nextDocument = {
    ...document,
    episode: {
      ...document.episode,
      audioUrl,
      transcriptAvailability: "local-whisper",
    },
    sources: [...(document.sources ?? []), result.source],
    segments: result.segments,
    generatedAt: nowIso(),
  };
  await writeTranscript(episode.id, nextDocument);
  results.push({
    episodeId: episode.id,
    skipped: false,
    source: "local-whisper",
    segmentCount: result.segments.length,
    clipSeconds,
  });
}

const coverage = dryRun || sampleOnly ? undefined : await writeCoverageReport();

writeJson({
  ok: true,
  dryRun,
  sampleOnly,
  episodeId,
  processed,
  localProvider,
  model,
  clipSeconds,
  results,
  coverage: coverage
    ? {
        officialTranscripts: coverage.officialTranscripts,
        rssTranscripts: coverage.rssTranscripts,
        youtubeAutoCaptions: coverage.youtubeAutoCaptions,
        localWhisperTranscripts: coverage.localWhisperTranscripts,
        missing: coverage.missing,
        parseFailures: coverage.parseFailures,
      }
    : undefined,
});
