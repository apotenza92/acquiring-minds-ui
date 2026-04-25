import { describe, expect, it } from "vitest";
import { matchRssItemsToEpisodes, parseTransistorRss } from "./transistor-rss.mjs";

describe("Transistor RSS adapter", () => {
  it("extracts audio enclosures and transcript tags", () => {
    const items = parseTransistorRss(`
      <rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
        <channel>
          <item>
            <title>Buying a Business</title>
            <guid>abc</guid>
            <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
            <itunes:duration>01:02:03</itunes:duration>
            <enclosure url="https://media.example.test/audio.mp3" length="123" type="audio/mpeg" />
            <podcast:transcript url="https://example.test/transcript.srt" type="application/srt" language="en" />
          </item>
        </channel>
      </rss>
    `);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Buying a Business",
      guid: "abc",
      audioUrl: "https://media.example.test/audio.mp3",
      transcripts: [
        {
          url: "https://example.test/transcript.srt",
          type: "application/srt",
          language: "en",
        },
      ],
    });
  });

  it("matches RSS items to discovered episodes by normalised title", () => {
    const matches = matchRssItemsToEpisodes(
      [{ id: "episode", title: "Buying a $40m Business" }],
      [{ normalisedTitle: "buying a 40m business", audioUrl: "audio.mp3" }],
    );

    expect(matches[0].matched).toBe(true);
    expect(matches[0].item.audioUrl).toBe("audio.mp3");
  });

  it("prefers official article links when titles changed", () => {
    const matches = matchRssItemsToEpisodes(
      [{
        id: "episode",
        title: "Old Website Title",
        officialUrl: "https://acquiringminds.co/articles/example",
      }],
      [{
        normalisedTitle: "new rss title",
        link: "http://acquiringminds.co/articles/example",
        audioUrl: "audio.mp3",
      }],
    );

    expect(matches[0].matched).toBe(true);
    expect(matches[0].item.audioUrl).toBe("audio.mp3");
  });
});
