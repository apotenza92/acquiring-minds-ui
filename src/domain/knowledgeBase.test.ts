import { describe, expect, it } from "vitest";
import { knowledgeBase, searchLessons, validateKnowledgeBase } from "./knowledgeBase";

describe("knowledge base data", () => {
  it("validates the fixture dataset", () => {
    expect(knowledgeBase.lessons.length).toBeGreaterThan(0);
    expect(knowledgeBase.lessons.every((lesson) => lesson.evidence.length > 0)).toBe(true);
  });

  it("rejects transcript-like lessons without source evidence", () => {
    const invalid = {
      ...knowledgeBase,
      lessons: [{ ...knowledgeBase.lessons[0], evidence: [] }],
    };

    expect(() => validateKnowledgeBase(invalid)).toThrow("evidence");
  });
});

describe("searchLessons", () => {
  it("filters by category", () => {
    const results = searchLessons(knowledgeBase.lessons, "", "financing-terms");
    const expectedCount = knowledgeBase.lessons.filter((lesson) => lesson.category === "financing-terms").length;

    expect(results).toHaveLength(expectedCount);
    expect(results.every((lesson) => lesson.category === "financing-terms")).toBe(true);
  });

  it("orders all lessons by ETA lifecycle category before title", () => {
    const results = searchLessons(knowledgeBase.lessons, "", "all");
    const firstSourcingIndex = results.findIndex((lesson) => lesson.category === "sourcing");
    const lastBuyerFitIndex = results.findLastIndex((lesson) => lesson.category === "buyer-fit");

    expect(firstSourcingIndex).toBeGreaterThan(0);
    expect(lastBuyerFitIndex).toBeGreaterThanOrEqual(0);
    expect(lastBuyerFitIndex).toBeLessThan(firstSourcingIndex);
  });

  it("matches lesson, tag, and source episode text", () => {
    const firstLesson = knowledgeBase.lessons[0];
    const firstEpisode = knowledgeBase.episodes.find((episode) => episode.id === firstLesson.evidence[0].episodeId);

    expect(searchLessons(knowledgeBase.lessons, firstLesson.tags[0], "all").length).toBeGreaterThan(0);
    expect(searchLessons(knowledgeBase.lessons, firstEpisode?.guest ?? "", "all").length).toBeGreaterThan(0);
  });
});
