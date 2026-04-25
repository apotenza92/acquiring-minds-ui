import { categoryLabels } from "../data/categories";
import type { EpisodeSource, EvidenceSource, Lesson } from "../domain/types";
import { SourceChip } from "./SourceChip";

interface LessonDetailProps {
  lesson: Lesson;
  sources: Array<{
    episode: EpisodeSource;
    source: EvidenceSource;
  }>;
}

export function LessonDetail({ lesson, sources }: LessonDetailProps) {
  return (
    <article className="lesson-detail" aria-labelledby="lesson-title">
      <div className="lesson-kicker">{categoryLabels[lesson.category]}</div>
      <h1 id="lesson-title">{lesson.title}</h1>
      <p>{lesson.summary}</p>

      <ol>
        {lesson.playbook.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <div className="tags" aria-label="Tags">
        {lesson.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>

      {sources.length > 0 ? (
        <section className="evidence-panel" aria-label="Source">
          <h2>Source</h2>
          <div className="source-list">
            {sources.map(({ episode, source }) => (
              <SourceChip
                key={`${source.episodeId}-${source.timestamp}`}
                episode={episode}
                source={source}
              />
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
