#!/usr/bin/env node
import { fetchYtDlpFlatPlaylist } from "./adapters/ytdlp.mjs";
import { readOpenVideoDownloaderDefaults } from "./adapters/open-video-downloader.mjs";
import { corpusPaths } from "./lib/corpus.mjs";
import { getArg, getNumberArg, hasFlag, nowIso, writeJson, writeJsonFile } from "./lib/io.mjs";

const defaultChannelUrl = "https://www.youtube.com/@AcquiringMinds/videos";
const channelUrl = getArg("--channel-url") ?? defaultChannelUrl;
const outputPath = getArg("--output") ?? corpusPaths.youtubeIndex;
const playlistEnd = getNumberArg("--playlist-end", 0);
const timeoutMs = getNumberArg("--timeout-ms", 240000);
const dryRun = hasFlag("--dry-run");
const useOpenVideoDownloader = hasFlag("--use-open-video-downloader");
const openVideoDownloaderDefaults = useOpenVideoDownloader ? await readOpenVideoDownloaderDefaults() : {};
const ytdlpBinary = getArg("--ytdlp-bin") ?? openVideoDownloaderDefaults.binary;
const cookiesFromBrowser = getArg("--cookies-from-browser") ?? openVideoDownloaderDefaults.cookiesFromBrowser;
const cookieFile = getArg("--cookies") ?? openVideoDownloaderDefaults.cookieFile;

const result = await fetchYtDlpFlatPlaylist(channelUrl, {
  binary: ytdlpBinary,
  cookiesFromBrowser,
  cookieFile,
  playlistEnd: playlistEnd > 0 ? playlistEnd : undefined,
  timeoutMs,
});

if (!result.ok) {
  writeJson({
    ok: false,
    sourceUrl: channelUrl,
    reason: result.reason,
  });
  process.exitCode = 1;
} else {
  const index = {
    generatedAt: nowIso(),
    sourceUrl: channelUrl,
    channel: result.channel,
    channelId: result.channelId,
    entries: result.entries,
  };

  if (!dryRun) {
    await writeJsonFile(outputPath, index);
  }

  writeJson({
    ok: true,
    dryRun,
    outputPath,
    sourceUrl: channelUrl,
    channel: result.channel,
    entries: result.entries.length,
  });
}
