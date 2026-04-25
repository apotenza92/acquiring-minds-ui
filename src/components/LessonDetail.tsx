import { categoryLabels } from "../data/categories";
import type { Lesson } from "../domain/types";

interface LessonDetailProps {
  lesson: Lesson;
}

export function LessonDetail({ lesson }: LessonDetailProps) {
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
    </article>
  );
}
