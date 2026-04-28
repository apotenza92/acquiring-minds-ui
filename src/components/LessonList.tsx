import { numberedCategoryLabels } from "../data/categories";
import type { Lesson } from "../domain/types";

interface LessonListProps {
  lessons: Lesson[];
  selectedLessonId?: string;
  onSelectLesson: (lessonId: string) => void;
}

export function LessonList({ lessons, selectedLessonId, onSelectLesson }: LessonListProps) {
  return (
    <section className="lesson-list" aria-label="Lessons">
      {lessons.map((lesson) => (
        <button
          className={selectedLessonId === lesson.id ? "lesson-row active" : "lesson-row"}
          key={lesson.id}
          type="button"
          onClick={() => onSelectLesson(lesson.id)}
        >
          <span>{numberedCategoryLabels[lesson.category]}</span>
          <strong>{lesson.title}</strong>
        </button>
      ))}
    </section>
  );
}
