import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  discoverEpisodesFromIndex,
  extractArticleMetadata,
  extractTranscriptSegments,
  getNextEpisodeIndexUrl,
} from "./acquiring-minds.mjs";

describe("Acquiring Minds adapter", () => {
  it("discovers official article links from the episode index", async () => {
    const html = await readFile("scripts/__fixtures__/acquiring-minds-index.html", "utf8");
    const episodes = discoverEpisodesFromIndex(html);

    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({
      id: "joe-wynn-surgical-specialties",
      officialUrl: "https://acquiringminds.co/articles/joe-wynn-surgical-specialties",
    });
    expect(getNextEpisodeIndexUrl(html)).toBe("https://acquiringminds.co/episodes?c0006f0e_page=2");
  });

  it("extracts metadata and transcript segments from an official article", async () => {
    const html = await readFile("scripts/__fixtures__/acquiring-minds-article.html", "utf8");

    expect(extractArticleMetadata(html, "https://acquiringminds.co/articles/joe-wynn-surgical-specialties")).toMatchObject({
      guest: "Joe Wynn",
      transcriptAvailability: "official",
    });
    expect(extractTranscriptSegments(html)).toMatchObject([
      {
        id: "official-1",
        timestampRange: "00:28:21 - 00:28:32",
        start: "00:28:21",
        end: "00:28:32",
        text: "Will Smith: So when we get to your multiple...",
        speaker: "Will Smith",
        source: "official",
      },
      {
        id: "official-2",
        timestampRange: "00:28:32 - 00:28:33",
        start: "00:28:32",
        end: "00:28:33",
        text: "Joe Wynn: Yeah, that's correct.",
        speaker: "Joe Wynn",
        source: "official",
      },
    ]);
  });
});
