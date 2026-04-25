import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readOpenVideoDownloaderDefaults } from "./open-video-downloader.mjs";

describe("Open Video Downloader adapter", () => {
  it("reads yt-dlp, cookie, and subtitle defaults without exposing secrets", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "amkb-ovd-test-"));
    await mkdir(join(baseDir, "bin"), { recursive: true });
    await writeFile(join(baseDir, "bin", "yt-dlp"), "");
    await writeFile(
      join(baseDir, "config.store.json"),
      JSON.stringify({
        config: {
          auth: {
            cookieBrowser: "brave",
            cookieFile: "/tmp/cookies.txt",
          },
          subtitles: {
            enabled: true,
            formatPreference: ["srt", "vtt", "json"],
            languages: ["en"],
          },
        },
      }),
    );

    await expect(readOpenVideoDownloaderDefaults({ baseDir })).resolves.toEqual({
      binary: join(baseDir, "bin", "yt-dlp"),
      cookiesFromBrowser: "brave",
      cookieFile: "/tmp/cookies.txt",
      subFormats: "srt/vtt/json3",
      subLanguages: "en.*",
    });
  });
});
