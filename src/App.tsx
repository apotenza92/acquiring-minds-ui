import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CategoryRail } from "./components/CategoryRail";
import { LessonDetail } from "./components/LessonDetail";
import { LessonList } from "./components/LessonList";
import { categories } from "./data/categories";
import { getEpisodeById, knowledgeBase, searchLessons } from "./domain/knowledgeBase";
import type { LessonCategoryId } from "./domain/types";

type SelectedCategory = LessonCategoryId | "all";

export default function App() {
  const [selectedCategory, setSelectedCategory] = useState<SelectedCategory>("all");
  const [query, setQuery] = useState("");
  const filteredLessons = useMemo(
    () => searchLessons(knowledgeBase.lessons, query, selectedCategory),
    [query, selectedCategory],
  );
  const [selectedLessonId, setSelectedLessonId] = useState<string | undefined>(
    knowledgeBase.lessons[0]?.id,
  );

  const selectedLesson =
    filteredLessons.find((lesson) => lesson.id === selectedLessonId) ?? filteredLessons[0];

  const selectedSources =
    selectedLesson?.evidence.flatMap((source) => {
      const episode = getEpisodeById(source.episodeId);
      return episode ? [{ episode, source }] : [];
    }) ?? [];

  const categoryCounts = useMemo(() => {
    const counts = new Map<SelectedCategory, number>([["all", knowledgeBase.lessons.length]]);
    categories.forEach((category) => {
      counts.set(
        category.id,
        knowledgeBase.lessons.filter((lesson) => lesson.category === category.id).length,
      );
    });
    return counts;
  }, []);

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Knowledge categories">
        <div className="brand">
          <span>{knowledgeBase.podcast.title}</span>
          <strong>Knowledge Base</strong>
        </div>
        <CategoryRail
          counts={categoryCounts}
          selectedCategory={selectedCategory}
          onSelectCategory={(category) => {
            setSelectedCategory(category);
            setSelectedLessonId(undefined);
          }}
        />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search">
            <Search aria-hidden="true" size={18} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedLessonId(undefined);
              }}
              placeholder="Search lessons"
              aria-label="Search lessons"
            />
          </label>
          <div className="source-set" aria-label="Podcast sources">
            <a href={knowledgeBase.podcast.episodeIndexUrl} target="_blank" rel="noreferrer">
              Official episodes
            </a>
          </div>
        </header>

        <div className="content-grid">
          <LessonList
            lessons={filteredLessons}
            selectedLessonId={selectedLesson?.id}
            onSelectLesson={setSelectedLessonId}
          />

          {selectedLesson ? (
            <LessonDetail lesson={selectedLesson} sources={selectedSources} />
          ) : (
            <section className="empty-state" aria-live="polite">
              No lessons found.
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
