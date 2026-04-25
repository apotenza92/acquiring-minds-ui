#!/usr/bin/env node
import {
  extractArticleMetadata,
  extractHighlights,
  extractShowNotes,
  extractTranscriptSegments,
} from "./adapters/acquiring-minds.mjs";
import { nowIso, readJsonInput, writeJson } from "./lib/io.mjs";

const input = await readJsonInput();
const pages = Array.isArray(input) ? input : input.pages;

if (!Array.isArray(pages)) {
  throw new Error("Expected an array of fetched pages or an object with pages");
}

const documents = pages.map((page) => {
  if (!page.ok || !page.html) {
    return {
      episode: {
        id: page.episodeId,
        podcastId: "acquiring-minds",
        title: "",
        guest: "",
        date: "",
        officialUrl: page.officialUrl,
        transcriptAvailability: "unknown",
      },
      sources: [{ kind: "missing", url: page.officialUrl, status: page.status }],
      showNotes: [],
      highlights: [],
      segments: [],
      generatedAt: nowIso(),
    };
  }

  const metadata = extractArticleMetadata(page.html, page.officialUrl);
  const segments = extractTranscriptSegments(page.html);
  const transcriptAvailability = segments.length > 0 ? "official" : metadata.transcriptAvailability;

  return {
    episode: {
      ...metadata,
      id: page.episodeId ?? metadata.id,
      transcriptAvailability,
    },
    sources: [
      {
        kind: segments.length > 0 ? "official" : "summary-only",
        url: page.officialUrl,
        fetchedAt: nowIso(),
        status: 200,
      },
    ],
    showNotes: extractShowNotes(page.html),
    highlights: extractHighlights(page.html),
    segments,
    generatedAt: nowIso(),
  };
});

writeJson({ documents });
