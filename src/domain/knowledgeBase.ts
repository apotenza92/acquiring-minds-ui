import rawKnowledgeBase from "../data/acquiring-minds.lessons.json";
import { categories, categoryOrder } from "../data/categories";
import type { KnowledgeBase, Lesson, LessonCategoryId } from "./types";

const categoryIds = new Set(categories.map((category) => category.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be an array of strings`);
  }
}

export function validateKnowledgeBase(value: unknown): KnowledgeBase {
  if (!isRecord(value)) {
    throw new Error("knowledge base must be an object");
  }

  if (!isRecord(value.podcast)) {
    throw new Error("podcast must be an object");
  }

  assertString(value.podcast.id, "podcast.id");
  assertString(value.podcast.title, "podcast.title");
  assertString(value.podcast.host, "podcast.host");
  assertString(value.podcast.officialUrl, "podcast.officialUrl");
  assertString(value.podcast.episodeIndexUrl, "podcast.episodeIndexUrl");
  assertStringArray(value.podcast.adapters, "podcast.adapters");

  if (!Array.isArray(value.episodes)) {
    throw new Error("episodes must be an array");
  }

  const episodeIds = new Set<string>();
  value.episodes.forEach((episode, index) => {
    if (!isRecord(episode)) {
      throw new Error(`episodes[${index}] must be an object`);
    }

    assertString(episode.id, `episodes[${index}].id`);
    assertString(episode.podcastId, `episodes[${index}].podcastId`);
    assertString(episode.title, `episodes[${index}].title`);
    assertString(episode.guest, `episodes[${index}].guest`);
    assertString(episode.date, `episodes[${index}].date`);
    assertString(episode.officialUrl, `episodes[${index}].officialUrl`);
    assertString(episode.transcriptAvailability, `episodes[${index}].transcriptAvailability`);
    episodeIds.add(episode.id);
  });

  if (!Array.isArray(value.lessons)) {
    throw new Error("lessons must be an array");
  }

  value.lessons.forEach((lesson, index) => {
    if (!isRecord(lesson)) {
      throw new Error(`lessons[${index}] must be an object`);
    }

    assertString(lesson.id, `lessons[${index}].id`);
    assertString(lesson.title, `lessons[${index}].title`);
    assertString(lesson.category, `lessons[${index}].category`);
    assertString(lesson.summary, `lessons[${index}].summary`);
    assertStringArray(lesson.playbook, `lessons[${index}].playbook`);
    assertStringArray(lesson.tags, `lessons[${index}].tags`);

    if (!categoryIds.has(lesson.category as LessonCategoryId)) {
      throw new Error(`lessons[${index}].category is not a known category`);
    }

    if (!Array.isArray(lesson.evidence) || lesson.evidence.length === 0) {
      throw new Error(`lessons[${index}].evidence must include at least one source`);
    }

    lesson.evidence.forEach((source, sourceIndex) => {
      if (!isRecord(source)) {
        throw new Error(`lessons[${index}].evidence[${sourceIndex}] must be an object`);
      }

      assertString(source.episodeId, `lessons[${index}].evidence[${sourceIndex}].episodeId`);
      assertString(source.timestamp, `lessons[${index}].evidence[${sourceIndex}].timestamp`);
      assertString(source.officialUrl, `lessons[${index}].evidence[${sourceIndex}].officialUrl`);

      if (!episodeIds.has(source.episodeId)) {
        throw new Error(`lessons[${index}].evidence[${sourceIndex}].episodeId is unknown`);
      }
    });
  });

  return value as unknown as KnowledgeBase;
}

export const knowledgeBase = validateKnowledgeBase(rawKnowledgeBase);

export function getEpisodeById(id: string) {
  return knowledgeBase.episodes.find((episode) => episode.id === id);
}

export function searchLessons(lessons: Lesson[], query: string, category: LessonCategoryId | "all") {
  const needle = query.trim().toLowerCase();

  return lessons
    .filter((lesson) => category === "all" || lesson.category === category)
    .filter((lesson) => {
      if (!needle) {
        return true;
      }

      const haystack = [
        lesson.title,
        lesson.summary,
        ...lesson.playbook,
        ...lesson.tags,
        ...lesson.evidence.flatMap((source) => {
          const episode = getEpisodeById(source.episodeId);
          return episode ? [episode.title, episode.guest] : [];
        }),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(needle);
    })
    .sort((a, b) => {
      if (category === "all") {
        const categoryComparison = categoryOrder[a.category] - categoryOrder[b.category];
        if (categoryComparison !== 0) {
          return categoryComparison;
        }
      }

      return a.title.localeCompare(b.title);
    });
}
