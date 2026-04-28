import { ArrowLeft } from "lucide-react";
import { numberedCategoryLabels } from "../data/categories";
import type { EpisodeSource, EvidenceSource, Lesson } from "../domain/types";
import { SourceChip } from "./SourceChip";

interface LessonDetailProps {
  lesson: Lesson;
  sources: Array<{
    episode: EpisodeSource;
    source: EvidenceSource;
  }>;
  onBack?: () => void;
}

export function LessonDetail({ lesson, sources, onBack }: LessonDetailProps) {
  return (
    <article className="lesson-detail" aria-labelledby="lesson-title">
      {onBack ? (
        <button className="detail-back" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={18} />
          Articles
        </button>
      ) : null}
      <div className="lesson-kicker">{numberedCategoryLabels[lesson.category]}</div>
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
