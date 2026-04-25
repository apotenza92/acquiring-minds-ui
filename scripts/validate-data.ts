import { knowledgeBase } from "../src/domain/knowledgeBase";

console.log(
  JSON.stringify(
    {
      ok: true,
      podcast: knowledgeBase.podcast.id,
      episodes: knowledgeBase.episodes.length,
      lessons: knowledgeBase.lessons.length,
    },
    null,
    2,
  ),
);
