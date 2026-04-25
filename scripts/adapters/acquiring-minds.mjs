import { parseHTML } from "linkedom";
import { slugify } from "../lib/io.mjs";

const transcriptHeadingPattern = /episode transcript|transcript/i;
const datePattern =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/;

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function absoluteUrl(href, base = "https://acquiringminds.co") {
  if (!href) {
    return undefined;
  }
  return new URL(href, base).toString();
}

export function discoverEpisodesFromIndex(html, currentUrl = "https://acquiringminds.co/episodes") {
  const { document } = parseHTML(html);
  const links = [...document.querySelectorAll("a")]
    .map((link) => ({
      title: cleanText(link.textContent),
      href: absoluteUrl(link.getAttribute("href"), currentUrl),
    }))
    .filter((link) => link.title && link.href?.includes("/articles/"));

  const seen = new Set();
  return links
    .filter((link) => {
      if (seen.has(link.href)) {
        return false;
      }
      seen.add(link.href);
      return true;
    })
    .map((link) => ({
      id: slugify(link.href.split("/").pop() ?? link.title),
      podcastId: "acquiring-minds",
      title: link.title,
      guest: "",
      date: "",
      officialUrl: link.href,
      transcriptAvailability: "unknown",
    }));
}

export function getNextEpisodeIndexUrl(html, currentUrl = "https://acquiringminds.co/episodes") {
  const { document } = parseHTML(html);
  const nextLink = [...document.querySelectorAll("a")]
    .find((link) => /next page/i.test(link.getAttribute("aria-label") ?? link.textContent ?? ""));
  return absoluteUrl(nextLink?.getAttribute("href"), currentUrl) ?? undefined;
}

export function extractArticleMetadata(html, url = "") {
  const { document } = parseHTML(html);
  const title = cleanText(document.querySelector("h1")?.textContent ?? "");
  const aboutHeading = [...document.querySelectorAll("h2, h3")]
    .find((heading) => cleanText(heading.textContent).toLowerCase() === "about");
  const guestHeading = aboutHeading?.nextElementSibling;
  const guest = guestHeading ? cleanText(guestHeading.textContent) : "";
  const transcriptHeading = [...document.querySelectorAll("h2, h3")]
    .find((heading) => transcriptHeadingPattern.test(cleanText(heading.textContent)));
  const bodyText = cleanText(document.body?.textContent ?? "");
  const date = cleanText(document.querySelector("time")?.textContent ?? "") || bodyText.match(datePattern)?.[0] || "";
  const youtubeUrl = resolveYouTubeUrlFromArticle(html);

  return {
    id: slugify(url.split("/").pop() || title),
    podcastId: "acquiring-minds",
    title,
    guest,
    date,
    officialUrl: url,
    youtubeUrl,
    transcriptAvailability: transcriptHeading ? "official" : "summary-only",
  };
}

export function extractTranscriptSegments(html) {
  const { document } = parseHTML(html);
  const headings = [...document.querySelectorAll("h6, h5, h4, h3")];
  const timestampHeadings = headings.filter((heading) =>
    /^\[\d{2}:\d{2}:\d{2}\s*-\s*\d{2}:\d{2}:\d{2}\]$/.test(cleanText(heading.textContent)),
  );

  return timestampHeadings.map((heading, index) => {
    const timestampRange = cleanText(heading.textContent).replace(/^\[|\]$/g, "");
    const [start, end] = timestampRange.split(/\s*-\s*/);
    const textParts = [];
    let node = heading.nextElementSibling;

    while (node && !/^H[1-6]$/.test(node.tagName)) {
      const text = cleanText(node.textContent ?? "");
      if (text) {
        textParts.push(text);
      }
      node = node.nextElementSibling;
    }

    const text = textParts.join(" ");
    const speakerMatch = text.match(/^([^:]{2,80}):\s+/);

    return {
      id: `official-${index + 1}`,
      timestampRange,
      start,
      end,
      text,
      speaker: speakerMatch?.[1],
      source: "official",
    };
  });
}

export function extractShowNotes(html) {
  const { document } = parseHTML(html);
  const showNotesHeading = [...document.querySelectorAll("h2, h3")]
    .find((heading) => /show notes/i.test(cleanText(heading.textContent)));
  if (!showNotesHeading) {
    return [];
  }

  const notes = [];
  let node = showNotesHeading.nextElementSibling;
  while (node && !/^H[1-3]$/.test(node.tagName)) {
    const text = cleanText(node.textContent ?? "");
    if (text) {
      notes.push(text);
    }
    node = node.nextElementSibling;
  }
  return notes;
}

export function extractHighlights(html) {
  const { document } = parseHTML(html);
  const keyTakeawaysHeading = [...document.querySelectorAll("h2, h3")]
    .find((heading) => /key takeaways/i.test(cleanText(heading.textContent)));
  if (!keyTakeawaysHeading) {
    return [];
  }

  const highlights = [];
  let node = keyTakeawaysHeading.nextElementSibling;
  while (node && !/^H[1-3]$/.test(node.tagName)) {
    const text = cleanText(node.textContent ?? "");
    if (text) {
      highlights.push(text);
    }
    node = node.nextElementSibling;
  }
  return highlights;
}

export function resolveYouTubeUrlFromArticle(html) {
  const { document } = parseHTML(html);
  const links = [...document.querySelectorAll("a")]
    .map((link) => absoluteUrl(link.getAttribute("href")))
    .filter(Boolean)
    .filter((href) => /(?:youtube\.com\/watch|youtu\.be\/)/i.test(href));

  return links[0];
}
