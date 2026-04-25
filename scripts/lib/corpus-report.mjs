import { readFile } from "node:fs/promises";
import { corpusPaths, readEpisodes, transcriptPath } from "./corpus.mjs";
import { hasCorpusDb, openCorpusDb } from "./corpus-db.mjs";
import { nowIso, writeJsonFile } from "./io.mjs";

export async function buildCoverageReport() {
  if (hasCorpusDb()) {
    const db = await openCorpusDb();
    const episodeCount = Number(db.prepare("SELECT COUNT(*) AS count FROM episodes").get().count);
    if (episodeCount > 0) {
      const report = buildDbCoverageReport(db);
      db.close();
      return report;
    }
    db.close();
  }

  const episodes = await readEpisodes();
  const report = {
    generatedAt: nowIso(),
    totalEpisodes: episodes.length,
    officialTranscripts: 0,
    rssTranscripts: 0,
    youtubeAutoCaptions: 0,
    localWhisperTranscripts: 0,
    summaryOnly: 0,
    missing: 0,
    parseFailures: 0,
    unresolvedYouTube: 0,
    episodes: [],
  };

  for (const episode of episodes) {
    try {
      const document = JSON.parse(await readFile(transcriptPath(episode.id), "utf8"));
      const sourceKinds = new Set(document.sources?.map((source) => source.kind) ?? []);
      const segmentCount = document.segments?.length ?? 0;
      let status = "missing";
      let reason;

      if (sourceKinds.has("official") && segmentCount > 0) {
        status = "official";
        report.officialTranscripts += 1;
      } else if (sourceKinds.has("rss-transcript") && segmentCount > 0) {
        status = "rss-transcript";
        report.rssTranscripts += 1;
      } else if (sourceKinds.has("youtube-auto") && segmentCount > 0) {
        status = "youtube-auto";
        report.youtubeAutoCaptions += 1;
      } else if (sourceKinds.has("local-whisper") && segmentCount > 0) {
        status = "local-whisper";
        report.localWhisperTranscripts += 1;
      } else if (sourceKinds.has("missing")) {
        reason = document.sources?.find((source) => source.reason)?.reason;
        report.missing += 1;
      } else if (sourceKinds.has("summary-only")) {
        status = "summary-only";
        report.summaryOnly += 1;
      } else {
        reason = document.sources?.find((source) => source.reason)?.reason;
        report.missing += 1;
      }

      if (document.sources?.some((source) => /Ambiguous YouTube/i.test(source.reason ?? ""))) {
        report.unresolvedYouTube += 1;
      }

      report.episodes.push({
        episodeId: episode.id,
        title: episode.title,
        status,
        segmentCount,
        officialUrl: episode.officialUrl,
        youtubeUrl: document.episode?.youtubeUrl,
        audioUrl: document.episode?.audioUrl,
        reason,
      });
    } catch (error) {
      report.parseFailures += 1;
      report.episodes.push({
        episodeId: episode.id,
        title: episode.title,
        status: "parse-failed",
        segmentCount: 0,
        officialUrl: episode.officialUrl,
        reason: error.message,
      });
    }
  }

  return report;
}

function buildDbCoverageReport(db) {
  const report = {
    generatedAt: nowIso(),
    source: "sqlite",
    totalEpisodes: Number(db.prepare("SELECT COUNT(*) AS count FROM episodes").get().count),
    officialTranscripts: 0,
    rssTranscripts: 0,
    youtubeAutoCaptions: 0,
    localWhisperTranscripts: 0,
    summaryOnly: 0,
    missing: 0,
    failed: 0,
    remaining: 0,
    parseFailures: 0,
    unresolvedYouTube: 0,
    episodes: [],
  };

  const rows = db.prepare(`
    SELECT
      e.id,
      e.title,
      e.official_url,
      e.youtube_url,
      e.audio_url,
      j.state AS job_state,
      j.last_error,
      COUNT(s.id) AS segment_count,
      MIN(s.source_kind) AS source_kind
    FROM episodes e
    LEFT JOIN transcript_jobs j ON j.episode_id = e.id
    LEFT JOIN transcript_segments s ON s.episode_id = e.id
    GROUP BY e.id
    ORDER BY COALESCE(e.rss_published_at, '' ) DESC, e.id ASC
  `).all();

  for (const row of rows) {
    let status = "missing";
    const segmentCount = Number(row.segment_count);

    if (segmentCount > 0) {
      status = row.source_kind;
      if (status === "official") {
        report.officialTranscripts += 1;
      } else if (status === "rss-transcript") {
        report.rssTranscripts += 1;
      } else if (status === "youtube-auto") {
        report.youtubeAutoCaptions += 1;
      } else if (status === "local-whisper") {
        report.localWhisperTranscripts += 1;
      }
    } else {
      report.missing += 1;
      if (row.job_state === "failed") {
        report.failed += 1;
      } else {
        report.remaining += 1;
      }
    }

    const unresolved = db.prepare(`
      SELECT COUNT(*) AS count
      FROM transcript_sources
      WHERE episode_id = ? AND failure_reason LIKE '%Ambiguous YouTube%'
    `).get(row.id);
    if (Number(unresolved.count) > 0) {
      report.unresolvedYouTube += 1;
    }

    report.episodes.push({
      episodeId: row.id,
      title: row.title,
      status,
      segmentCount,
      officialUrl: row.official_url,
      youtubeUrl: row.youtube_url ?? undefined,
      audioUrl: row.audio_url ?? undefined,
      reason: row.last_error ?? undefined,
    });
  }

  return report;
}

export async function writeCoverageReport() {
  const report = await buildCoverageReport();
  await writeJsonFile(corpusPaths.coverage, report);
  return report;
}
