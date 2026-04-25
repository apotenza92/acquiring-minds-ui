import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  fetchYouTubeCaptionSegments,
  normaliseYouTubeCaptionXml,
  parseCaptionTracksFromWatchHtml,
  searchYouTubeForEpisode,
} from "./youtube.mjs";

describe("YouTube adapter", () => {
  it("normalises caption XML into transcript segments", () => {
    const segments = normaliseYouTubeCaptionXml(
      '<transcript><text start="1.2" dur="2.8">Hello &amp; welcome</text></transcript>',
    );

    expect(segments).toEqual([
      {
        id: "youtube-auto-1",
        start: "00:00:01",
        end: "00:00:04",
        text: "Hello & welcome",
        source: "youtube-auto",
      },
    ]);
  });

  it("extracts caption tracks and fetches selected captions", async () => {
    const html = await readFile("scripts/__fixtures__/youtube-watch.html", "utf8");
    expect(parseCaptionTracksFromWatchHtml(html)).toHaveLength(1);

    const result = await fetchYouTubeCaptionSegments("https://youtube.test/watch?v=abc", async (url: string) => {
      if (url.includes("captions.xml")) {
        return new Response('<transcript><text start="0" dur="1">Line one</text></transcript>');
      }
      return new Response(html);
    });

    expect(result.ok).toBe(true);
    expect(result.segments).toHaveLength(1);
    expect(result.source.kind).toBe("youtube-auto");
  });

  it("records ambiguous YouTube search results instead of guessing", async () => {
    const result = await searchYouTubeForEpisode(
      { title: "Episode", guest: "Guest" },
      async () =>
        new Response(
          '{"videoId":"first"}{"videoId":"second"}',
          { status: 200 },
        ),
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "Ambiguous YouTube search results",
      candidates: ["https://www.youtube.com/watch?v=first", "https://www.youtube.com/watch?v=second"],
    });
  });
});
