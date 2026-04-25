import { DOMParser } from "linkedom";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normaliseRssTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[$€£]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getFirstText(parent, tagName) {
  return cleanText(parent.getElementsByTagName(tagName)?.[0]?.textContent ?? "");
}

export function parseTransistorRss(xml) {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  const items = [...document.getElementsByTagName("item")];

  return items.map((item) => {
    const enclosure = item.getElementsByTagName("enclosure")?.[0];
    const transcripts = [...item.getElementsByTagName("podcast:transcript")].map((node) => ({
      url: node.getAttribute("url"),
      type: node.getAttribute("type"),
      language: node.getAttribute("language"),
    })).filter((transcript) => transcript.url);

    return {
      title: getFirstText(item, "title"),
      normalisedTitle: normaliseRssTitle(getFirstText(item, "title")),
      guid: getFirstText(item, "guid"),
      link: getFirstText(item, "link"),
      pubDate: getFirstText(item, "pubDate"),
      duration: getFirstText(item, "itunes:duration"),
      audioUrl: enclosure?.getAttribute("url") ?? "",
      audioType: enclosure?.getAttribute("type") ?? "",
      audioLength: enclosure?.getAttribute("length") ?? "",
      transcripts,
    };
  });
}

export function matchRssItemsToEpisodes(episodes, rssItems) {
  const byTitle = new Map(rssItems.map((item) => [item.normalisedTitle, item]));
  const byLink = new Map(
    rssItems
      .filter((item) => item.link)
      .map((item) => [item.link.replace(/^http:\/\//, "https://").replace(/\/$/, ""), item]),
  );

  return episodes.map((episode) => {
    const officialUrl = episode.officialUrl?.replace(/^http:\/\//, "https://").replace(/\/$/, "");
    const item = byLink.get(officialUrl) ?? byTitle.get(normaliseRssTitle(episode.title));
    return {
      episode,
      item,
      matched: Boolean(item),
    };
  });
}
