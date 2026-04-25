#!/usr/bin/env node
import { readJsonInput } from "./lib/io.mjs";

const input = await readJsonInput();
const documents = Array.isArray(input) ? input : input.documents;

if (!Array.isArray(documents)) {
  throw new Error("Expected an array of normalised documents or an object with documents");
}

const categories = [
  "Buyer Fit",
  "Sourcing",
  "Deal Evaluation",
  "Financing & Terms",
  "Due Diligence",
  "Closing & Transition",
  "Operating",
  "Growth",
  "Risk & Failure",
  "Exit & Long-Term Hold",
];

const sourceBundle = documents
  .map((document) => {
    const transcript = (document.segments ?? [])
      .map((segment) => `[${segment.timestampRange}] ${segment.text}`)
      .join("\n");

    return [
      `Episode: ${document.title}`,
      `Guest: ${document.guest}`,
      `URL: ${document.officialUrl}`,
      transcript || "No official transcript text available in this source bundle.",
    ].join("\n");
  })
  .join("\n\n---\n\n");

process.stdout.write(`Create synthesised knowledge-base lessons from these podcast transcripts.

Rules:
- Return JSON only.
- Do not include transcript excerpts.
- Use only these categories: ${categories.join(", ")}.
- Each lesson must include: id, title, category, summary, playbook, tags, evidence.
- Evidence must include episodeId, timestamp, officialUrl, and optional youtubeUrl.
- Prefer broader reusable lessons over episode recaps.

Source bundle:

${sourceBundle}
`);
