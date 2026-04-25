import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { nowIso } from "../lib/io.mjs";

const execFileAsync = promisify(execFile);

function normaliseTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[$€£]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP_WORDS = new Set(["a", "an", "and", "as", "from", "how", "in", "of", "on", "the", "to", "with", "for", "buy"]);

function meaningfulTokens(value) {
  return normaliseTitle(value)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function overlapScore(needle, haystack) {
  const episodeTokens = meaningfulTokens(needle);
  const videoTokens = new Set(meaningfulTokens(haystack));
  if (episodeTokens.length === 0) {
    return 0;
  }
  return episodeTokens.filter((token) => videoTokens.has(token)).length / episodeTokens.length;
}

function titleScore(episodeTitle, videoTitle) {
  return overlapScore(episodeTitle, videoTitle);
}

function guestScore(guest, videoTitle) {
  return overlapScore(guest, videoTitle);
}

function isTitleMatch(episodeTitle, videoTitle, score) {
  const episodeNormalised = normaliseTitle(episodeTitle);
  const videoNormalised = normaliseTitle(videoTitle);
  return (
    score >= 0.85 ||
    videoNormalised === episodeNormalised ||
    videoNormalised.startsWith(`${episodeNormalised} `) ||
    videoNormalised.includes(` ${episodeNormalised} `)
  );
}

function secondsToTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function cleanCaptionText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.?!:;])/g, "$1")
    .trim();
}

function normaliseSubtitleLanguages(value) {
  const raw = String(value ?? "en-orig,en")
    .split(",")
    .map((language) => language.trim())
    .filter(Boolean);
  const seen = new Set();
  const languages = [];

  for (const language of raw.length > 0 ? raw : ["en-orig", "en"]) {
    const key = language.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    languages.push(language);
  }

  return languages.join(",");
}

function normaliseSubtitleFormats(value) {
  const raw = String(value ?? "json3/vtt/srt/ttml")
    .split(/[,/]/)
    .map((format) => format.trim().toLowerCase())
    .filter(Boolean);
  const defaults = ["json3", "vtt", "srt", "ttml"];
  const seen = new Set();
  const formats = [];

  for (const format of [...raw, ...defaults]) {
    if (seen.has(format)) {
      continue;
    }
    seen.add(format);
    formats.push(format);
  }

  return formats.join("/");
}

export function normaliseYtDlpJson3Caption(caption) {
  const events = Array.isArray(caption?.events) ? caption.events : [];

  return events
    .map((event, index) => {
      const text = cleanCaptionText(
        (event.segs ?? [])
          .map((segment) => segment.utf8 ?? "")
          .join(""),
      );
      const startSeconds = Number(event.tStartMs ?? 0) / 1000;
      const durationSeconds = Number(event.dDurationMs ?? 0) / 1000;

      return {
        id: `youtube-auto-${index + 1}`,
        start: secondsToTimestamp(startSeconds),
        end: durationSeconds ? secondsToTimestamp(startSeconds + durationSeconds) : undefined,
        text,
        source: "youtube-auto",
      };
    })
    .filter((segment) => segment.text);
}

function timestampToSeconds(value) {
  const parts = String(value ?? "").replace(",", ".").split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) {
    return 0;
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] ?? 0;
}

export function normaliseTextSubtitleCaption(content) {
  const blocks = String(content ?? "")
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const segments = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^WEBVTT\b/i.test(line) && !/^NOTE\b/i.test(line));
    const timingIndex = lines.findIndex((line) => /-->/u.test(line));
    if (timingIndex === -1) {
      continue;
    }

    const [startRaw, endRaw] = lines[timingIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const text = cleanCaptionText(lines.slice(timingIndex + 1).join(" "));
    if (!text) {
      continue;
    }

    segments.push({
      id: `youtube-auto-${segments.length + 1}`,
      start: secondsToTimestamp(timestampToSeconds(startRaw)),
      end: endRaw ? secondsToTimestamp(timestampToSeconds(endRaw)) : undefined,
      text,
      source: "youtube-auto",
    });
  }

  return segments;
}

export function buildYtDlpCaptionArgs(youtubeUrl, options = {}) {
  const args = [
    "--skip-download",
    "--write-sub",
    "--write-auto-sub",
    "--sub-langs",
    normaliseSubtitleLanguages(options.subLanguages),
    "--sub-format",
    normaliseSubtitleFormats(options.subFormats),
    "--no-warnings",
    "--no-progress",
    "-o",
    join(options.outputDir, "%(id)s.%(ext)s"),
  ];

  if (options.sleepSubtitlesMs > 0) {
    args.push("--sleep-subtitles", String(options.sleepSubtitlesMs / 1000));
  }

  if (options.cookiesFromBrowser) {
    args.push("--cookies-from-browser", options.cookiesFromBrowser);
  }
  if (options.cookieFile) {
    args.push("--cookies", options.cookieFile);
  }

  args.push(youtubeUrl);
  return args;
}

export function selectBestYtDlpSearchResult(episode, entries) {
  const candidates = entries
    .filter(Boolean)
    .map((entry) => {
      const channel = entry.channel ?? entry.uploader ?? "";
      const score = titleScore(episode.title, entry.title);
      const speakerScore = guestScore(episode.guest, entry.title);
      const combinedScore = Math.max(score, speakerScore);
      return {
        id: entry.id,
        title: entry.title,
        channel,
        url: entry.webpage_url ?? (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : undefined),
        duration: entry.duration,
        score,
        guestScore: speakerScore,
        combinedScore,
        isAcquiringMinds: /^Acquiring Minds$/i.test(channel),
      };
    })
    .filter((candidate) => candidate.url);

  const ranked = candidates
    .sort((a, b) =>
      Number(b.isAcquiringMinds) - Number(a.isAcquiringMinds) ||
      b.combinedScore - a.combinedScore ||
      b.score - a.score,
    );
  const best = ranked[0];

  if (!best) {
    return {
      ok: false,
      reason: "No YouTube search results",
      candidates: [],
    };
  }

  const bestMatchesTitle = isTitleMatch(episode.title, best.title, best.score);
  const bestMatchesGuest = best.guestScore >= 0.75;

  if (!best.isAcquiringMinds || (!bestMatchesTitle && !bestMatchesGuest)) {
    return {
      ok: false,
      reason: "No confident Acquiring Minds YouTube match",
      candidates: ranked.slice(0, 5),
    };
  }

  const second = ranked[1];
  if (second?.isAcquiringMinds && Math.abs(best.combinedScore - second.combinedScore) < 0.05) {
    return {
      ok: false,
      reason: "Ambiguous Acquiring Minds YouTube matches",
      candidates: ranked.slice(0, 5),
    };
  }

  return {
    ok: true,
    youtubeUrl: best.url,
    candidate: best,
    candidates: ranked.slice(0, 5),
  };
}

export function selectBestYtDlpIndexResult(episode, entries) {
  return selectBestYtDlpSearchResult(
    episode,
    entries.map((entry) => ({
      ...entry,
      channel: entry.channel ?? entry.uploader ?? "Acquiring Minds",
      uploader: entry.uploader ?? entry.channel ?? "Acquiring Minds",
      webpage_url: entry.webpage_url ?? entry.url ?? (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : undefined),
    })),
  );
}

export function buildYtDlpFlatPlaylistArgs(playlistUrl, options = {}) {
  const args = [
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
  ];

  if (options.playlistEnd) {
    args.push("--playlist-end", String(options.playlistEnd));
  }
  if (options.cookiesFromBrowser) {
    args.push("--cookies-from-browser", options.cookiesFromBrowser);
  }
  if (options.cookieFile) {
    args.push("--cookies", options.cookieFile);
  }

  args.push(playlistUrl);
  return args;
}

export async function fetchYtDlpFlatPlaylist(playlistUrl, options = {}) {
  const binary = options.binary ?? process.env.AMKB_YTDLP_BIN ?? "yt-dlp";
  const runCommand =
    options.runCommand ??
    ((command, args, execOptions) =>
      execFileAsync(command, args, {
        ...execOptions,
        maxBuffer: 1024 * 1024 * 32,
      }));
  const args = buildYtDlpFlatPlaylistArgs(playlistUrl, options);

  try {
    const output = await runCommand(binary, args, {
      timeout: options.timeoutMs ?? 180000,
    });
    const payload = JSON.parse(output.stdout);
    return {
      ok: true,
      sourceUrl: playlistUrl,
      channel: payload.channel ?? payload.uploader,
      channelId: payload.channel_id,
      entries: (payload.entries ?? [])
        .filter((entry) => entry?.id || entry?.url)
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          description: entry.description,
          duration: entry.duration,
          channel: entry.channel ?? payload.channel ?? payload.uploader,
          uploader: entry.uploader ?? payload.uploader ?? payload.channel,
          webpage_url: entry.webpage_url ?? entry.url ?? (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : undefined),
          releaseTimestamp: entry.release_timestamp,
          timestamp: entry.timestamp,
        })),
    };
  } catch (error) {
    return {
      ok: false,
      reason: summariseYtDlpFailure(error),
      entries: [],
    };
  }
}

export async function searchYouTubeWithYtDlp(episode, options = {}) {
  const binary = options.binary ?? process.env.AMKB_YTDLP_BIN ?? "yt-dlp";
  const runCommand =
    options.runCommand ??
    ((command, args, execOptions) =>
      execFileAsync(command, args, {
        ...execOptions,
        maxBuffer: 1024 * 1024 * 8,
      }));
  const query = options.query ?? `Acquiring Minds ${episode.title}`;
  const args = [
    "--skip-download",
    "--dump-single-json",
    "--no-warnings",
  ];

  if (options.cookiesFromBrowser) {
    args.push("--cookies-from-browser", options.cookiesFromBrowser);
  }
  if (options.cookieFile) {
    args.push("--cookies", options.cookieFile);
  }

  args.push(`ytsearch${options.limit ?? 5}:${query}`);

  let output;
  try {
    output = await runCommand(binary, args, {
      timeout: options.timeoutMs ?? 45000,
    });
  } catch (error) {
    return {
      ok: false,
      reason: summariseYtDlpFailure(error),
      candidates: [],
    };
  }

  try {
    const payload = JSON.parse(output.stdout);
    return selectBestYtDlpSearchResult(episode, payload.entries ?? []);
  } catch (error) {
    return {
      ok: false,
      reason: `yt-dlp search returned invalid JSON: ${error.message}`,
      candidates: [],
    };
  }
}

function summariseYtDlpFailure(error) {
  const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`.trim();
  const message = output || error?.message || "yt-dlp failed";

  if (/HTTP Error 429|Too Many Requests/i.test(message)) {
    return "YouTube blocked caption download with HTTP 429";
  }
  if (/This video is unavailable|Private video|Sign in to confirm/i.test(message)) {
    return "YouTube video requires sign-in or is unavailable";
  }
  if (/Requested format is not available/i.test(message)) {
    return "yt-dlp could not access a downloadable caption format";
  }
  if (/not found|ENOENT/i.test(message)) {
    return "yt-dlp is not installed or not on PATH";
  }
  if (/timed out|timeout/i.test(message)) {
    return "yt-dlp caption fetch timed out";
  }

  return message.split("\n").find(Boolean)?.slice(0, 240) ?? "yt-dlp failed";
}

async function findCaptionFile(outputDir) {
  const files = await readdir(outputDir);
  return files.find((file) => file.endsWith(".json3")) ??
    files.find((file) => /\.(vtt|srt|ttml)$/i.test(file));
}

async function normaliseCaptionFile(filePath) {
  if (filePath.endsWith(".json3")) {
    const caption = JSON.parse(await readFile(filePath, "utf8"));
    return normaliseYtDlpJson3Caption(caption);
  }
  return normaliseTextSubtitleCaption(await readFile(filePath, "utf8"));
}

export async function fetchYtDlpCaptionSegments(youtubeUrl, options = {}) {
  const outputDir = options.outputDir;
  if (!outputDir) {
    throw new Error("fetchYtDlpCaptionSegments requires outputDir");
  }

  const binary = options.binary ?? process.env.AMKB_YTDLP_BIN ?? "yt-dlp";
  const runCommand =
    options.runCommand ??
    ((command, args, execOptions) =>
      execFileAsync(command, args, {
        ...execOptions,
        maxBuffer: 1024 * 1024 * 8,
      }));

  await mkdir(outputDir, { recursive: true });
  if (options.force) {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(outputDir, { recursive: true });
  }

  const existingFile = await findCaptionFile(outputDir);
  if (existingFile && !options.force) {
    const segments = await normaliseCaptionFile(join(outputDir, existingFile));
    return {
      ok: segments.length > 0,
      source: {
        kind: "youtube-auto",
        provider: "yt-dlp",
        url: youtubeUrl,
        fetchedAt: nowIso(),
        cachePath: join(outputDir, existingFile),
      },
      segments,
      reason: segments.length > 0 ? undefined : "Cached yt-dlp caption file had no usable text",
    };
  }

  const args = buildYtDlpCaptionArgs(youtubeUrl, {
    outputDir,
    subLanguages: options.subLanguages,
    subFormats: options.subFormats,
    sleepSubtitlesMs: options.sleepSubtitlesMs,
    cookiesFromBrowser: options.cookiesFromBrowser,
    cookieFile: options.cookieFile,
  });

  try {
    await runCommand(binary, args, {
      timeout: options.timeoutMs ?? 180000,
    });
  } catch (error) {
    return {
      ok: false,
      provider: "yt-dlp",
      reason: summariseYtDlpFailure(error),
      segments: [],
    };
  }

  const captionFile = await findCaptionFile(outputDir);
  if (!captionFile) {
    return {
      ok: false,
      provider: "yt-dlp",
      reason: "yt-dlp completed without writing a supported caption file",
      segments: [],
    };
  }

  const segments = await normaliseCaptionFile(join(outputDir, captionFile));
  return {
    ok: segments.length > 0,
    source: {
      kind: "youtube-auto",
      provider: "yt-dlp",
      url: youtubeUrl,
      fetchedAt: nowIso(),
      cachePath: join(outputDir, captionFile),
    },
    segments,
    reason: segments.length > 0 ? undefined : "yt-dlp caption file had no usable text",
  };
}
