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

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("financing-terms");
  });

  it("matches lesson, tag, and source episode text", () => {
    expect(searchLessons(knowledgeBase.lessons, "supplier", "all").length).toBeGreaterThan(0);
    expect(searchLessons(knowledgeBase.lessons, "Joe Wynn", "all").length).toBeGreaterThan(0);
  });
});
