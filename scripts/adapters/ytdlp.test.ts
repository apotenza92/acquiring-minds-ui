import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildYtDlpCaptionArgs,
  buildYtDlpFlatPlaylistArgs,
  fetchYtDlpFlatPlaylist,
  fetchYtDlpCaptionSegments,
  normaliseYtDlpJson3Caption,
  normaliseTextSubtitleCaption,
  selectBestYtDlpIndexResult,
  selectBestYtDlpSearchResult,
} from "./ytdlp.mjs";

describe("yt-dlp adapter", () => {
  it("normalises json3 captions into transcript segments", () => {
    const segments = normaliseYtDlpJson3Caption({
      events: [
        {
          tStartMs: 1200,
          dDurationMs: 2800,
          segs: [{ utf8: "Hello" }, { utf8: " world" }],
        },
      ],
    });

    expect(segments).toEqual([
      {
        id: "youtube-auto-1",
        start: "00:00:01",
        end: "00:00:04",
        text: "Hello world",
        source: "youtube-auto",
      },
    ]);
  });

  it("builds a caption-only yt-dlp command", () => {
    const args = buildYtDlpCaptionArgs("https://www.youtube.com/watch?v=abc", {
      outputDir: "/tmp/captions",
      sleepSubtitlesMs: 70000,
      cookiesFromBrowser: "brave",
      cookieFile: "/tmp/cookies.txt",
    });

    expect(args).toContain("--skip-download");
    expect(args).toContain("--write-auto-sub");
    expect(args).toContain("--write-sub");
    expect(args).toContain("--sleep-subtitles");
    expect(args).toContain("70");
    expect(args).toContain("json3/vtt/srt/ttml");
    expect(args).toContain("--cookies-from-browser");
    expect(args).toContain("brave");
    expect(args).toContain("--cookies");
    expect(args).toContain("/tmp/cookies.txt");
    expect(args.at(-1)).toBe("https://www.youtube.com/watch?v=abc");
  });

  it("builds a flat playlist command", () => {
    const args = buildYtDlpFlatPlaylistArgs("https://www.youtube.com/@AcquiringMinds/videos", {
      playlistEnd: 250,
      cookiesFromBrowser: "chrome",
    });

    expect(args).toContain("--flat-playlist");
    expect(args).toContain("--dump-single-json");
    expect(args).toContain("--playlist-end");
    expect(args).toContain("250");
    expect(args).toContain("--cookies-from-browser");
    expect(args).toContain("chrome");
    expect(args.at(-1)).toBe("https://www.youtube.com/@AcquiringMinds/videos");
  });

  it("normalises text subtitle captions into transcript segments", () => {
    const segments = normaliseTextSubtitleCaption(`WEBVTT

00:00:01.200 --> 00:00:04.000
Hello
world

00:00:04.000 --> 00:00:05.000
Next line`);

    expect(segments).toEqual([
      {
        id: "youtube-auto-1",
        start: "00:00:01",
        end: "00:00:04",
        text: "Hello world",
        source: "youtube-auto",
      },
      {
        id: "youtube-auto-2",
        start: "00:00:04",
        end: "00:00:05",
        text: "Next line",
        source: "youtube-auto",
      },
    ]);
  });

  it("reads cached json3 files without shelling out", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "amkb-ytdlp-test-"));
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      join(outputDir, "abc.en-orig.json3"),
      JSON.stringify({
        events: [
          {
            tStartMs: 0,
            dDurationMs: 1000,
            segs: [{ utf8: "Cached line" }],
          },
        ],
      }),
    );

    const result = await fetchYtDlpCaptionSegments("https://www.youtube.com/watch?v=abc", {
      outputDir,
      runCommand: async () => {
        throw new Error("should not execute");
      },
    });

    expect(result.ok).toBe(true);
    expect(result.source.provider).toBe("yt-dlp");
    expect(result.segments[0].text).toBe("Cached line");
  });

  it("reads cached vtt files without shelling out", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "amkb-ytdlp-test-"));
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      join(outputDir, "abc.en.vtt"),
      `WEBVTT

00:00:00.000 --> 00:00:01.000
Cached vtt line`,
    );

    const result = await fetchYtDlpCaptionSegments("https://www.youtube.com/watch?v=abc", {
      outputDir,
      runCommand: async () => {
        throw new Error("should not execute");
      },
    });

    expect(result.ok).toBe(true);
    expect(result.source.provider).toBe("yt-dlp");
    expect(result.segments[0].text).toBe("Cached vtt line");
  });

  it("classifies YouTube 429 failures", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "amkb-ytdlp-test-"));
    const result = await fetchYtDlpCaptionSegments("https://www.youtube.com/watch?v=abc", {
      outputDir,
      force: true,
      runCommand: async () => {
        const error = new Error("failed");
        error.stderr = "ERROR: Unable to download subtitles: HTTP Error 429: Too Many Requests";
        throw error;
      },
    });

    expect(result).toMatchObject({
      ok: false,
      provider: "yt-dlp",
      reason: "YouTube blocked caption download with HTTP 429",
      segments: [],
    });
  });

  it("selects confident Acquiring Minds search results", () => {
    const result = selectBestYtDlpSearchResult(
      { title: "Founder Mode for ETA: $6m to $25m in 3 Years" },
      [
        {
          id: "noise",
          title: "Unrelated video",
          channel: "Someone Else",
          webpage_url: "https://www.youtube.com/watch?v=noise",
        },
        {
          id: "midaBBMxqqg",
          title: "Founder Mode for ETA: $6m to $25m in 3 Years | Aizik Zimerman Interview",
          channel: "Acquiring Minds",
          webpage_url: "https://www.youtube.com/watch?v=midaBBMxqqg",
        },
      ],
    );

    expect(result).toMatchObject({
      ok: true,
      youtubeUrl: "https://www.youtube.com/watch?v=midaBBMxqqg",
    });
  });

  it("rejects same-channel results with a different guest and loose title overlap", () => {
    const result = selectBestYtDlpSearchResult(
      {
        title: "6 Months to Buy a Business with $1m+ in EBITDA",
        guest: "Shane Ehrsam",
      },
      [
        {
          id: "xOkeEHMwAlg",
          title: "Buy and 3x a Project Based Business in Just 2 Years | Johannes Hock Interview",
          channel: "Acquiring Minds",
          webpage_url: "https://www.youtube.com/watch?v=xOkeEHMwAlg",
        },
      ],
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("No confident Acquiring Minds YouTube match");
  });

  it("accepts retitled Acquiring Minds results when the guest matches", () => {
    const result = selectBestYtDlpSearchResult(
      {
        title: "A Different Page Title",
        guest: "Aizik Zimerman",
      },
      [
        {
          id: "midaBBMxqqg",
          title: "Founder Mode for ETA: $6m to $25m in 3 Years | Aizik Zimerman Interview",
          channel: "Acquiring Minds",
          webpage_url: "https://www.youtube.com/watch?v=midaBBMxqqg",
        },
      ],
    );

    expect(result).toMatchObject({
      ok: true,
      youtubeUrl: "https://www.youtube.com/watch?v=midaBBMxqqg",
    });
  });

  it("uses cached channel index entries as Acquiring Minds candidates", () => {
    const result = selectBestYtDlpIndexResult(
      {
        title: "Buying a Plumbing Business in Dallas-Fort Worth",
        guest: "Josh Key",
      },
      [
        {
          id: "abc",
          title: "Buying a Plumbing Business in Dallas-Fort Worth | Josh Key Interview",
          url: "https://www.youtube.com/watch?v=abc",
        },
      ],
    );

    expect(result).toMatchObject({
      ok: true,
      youtubeUrl: "https://www.youtube.com/watch?v=abc",
    });
  });

  it("normalises flat playlist entries from yt-dlp", async () => {
    const result = await fetchYtDlpFlatPlaylist("https://www.youtube.com/@AcquiringMinds/videos", {
      runCommand: async () => ({
        stdout: JSON.stringify({
          channel: "Acquiring Minds",
          channel_id: "channel-1",
          entries: [
            {
              id: "abc",
              title: "Episode title",
              url: "https://www.youtube.com/watch?v=abc",
              duration: 123,
            },
          ],
        }),
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      channel: "Acquiring Minds",
      channelId: "channel-1",
      entries: [
        {
          id: "abc",
          title: "Episode title",
          channel: "Acquiring Minds",
          webpage_url: "https://www.youtube.com/watch?v=abc",
        },
      ],
    });
  });
});
