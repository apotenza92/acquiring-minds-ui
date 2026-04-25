import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./io.mjs";

export const corpusRoot = ".corpus";
export const podcastId = "acquiring-minds";
export const podcastCorpusDir = join(corpusRoot, podcastId);

export const corpusPaths = {
  episodes: join(podcastCorpusDir, "episodes.json"),
  database: join(podcastCorpusDir, "corpus.sqlite"),
  rawDir: join(podcastCorpusDir, "raw"),
  rssFeed: join(podcastCorpusDir, "rss.xml"),
  transcriptsDir: join(podcastCorpusDir, "transcripts"),
  youtubeIndex: join(podcastCorpusDir, "youtube-index.json"),
  youtubeCaptionsDir: join(podcastCorpusDir, "youtube-captions"),
  localTranscriptsDir: join(podcastCorpusDir, "local-transcripts"),
  reportsDir: join(podcastCorpusDir, "reports"),
  coverage: join(podcastCorpusDir, "reports", "coverage.json"),
  generatedLessonsDir: join(podcastCorpusDir, "generated-lessons"),
  extractionsDir: join(podcastCorpusDir, "extractions"),
  episodeExtractionsDir: join(podcastCorpusDir, "extractions", "episodes"),
  clusterExtractionsDir: join(podcastCorpusDir, "extractions", "clusters"),
  extractionManifestsDir: join(podcastCorpusDir, "extractions", "manifests"),
  reviewedLessons: join(podcastCorpusDir, "extractions", "reviewed-lessons.json"),
};

export async function ensureCorpusDirs() {
  await Promise.all([
    mkdir(corpusPaths.rawDir, { recursive: true }),
    mkdir(corpusPaths.transcriptsDir, { recursive: true }),
    mkdir(corpusPaths.youtubeCaptionsDir, { recursive: true }),
    mkdir(corpusPaths.localTranscriptsDir, { recursive: true }),
    mkdir(corpusPaths.reportsDir, { recursive: true }),
    mkdir(corpusPaths.generatedLessonsDir, { recursive: true }),
    mkdir(corpusPaths.episodeExtractionsDir, { recursive: true }),
    mkdir(corpusPaths.clusterExtractionsDir, { recursive: true }),
    mkdir(corpusPaths.extractionManifestsDir, { recursive: true }),
  ]);
}

export function rawHtmlPath(episodeId) {
  return join(corpusPaths.rawDir, `${episodeId}.html`);
}

export function transcriptPath(episodeId) {
  return join(corpusPaths.transcriptsDir, `${episodeId}.json`);
}

export async function readEpisodes() {
  return readJsonFile(corpusPaths.episodes, []);
}

export async function writeEpisodes(episodes) {
  await writeJsonFile(corpusPaths.episodes, episodes);
}

export async function readTranscript(episodeId) {
  return readJsonFile(transcriptPath(episodeId));
}

export async function writeTranscript(episodeId, transcript) {
  await writeJsonFile(transcriptPath(episodeId), transcript);
}

export async function listTranscriptIds() {
  try {
    const files = await readdir(corpusPaths.transcriptsDir);
    return files.filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
