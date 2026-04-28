import { Menu, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CategoryRail } from "./components/CategoryRail";
import { LessonDetail } from "./components/LessonDetail";
import { LessonList } from "./components/LessonList";
import { categories } from "./data/categories";
import { getEpisodeById, knowledgeBase, searchLessons } from "./domain/knowledgeBase";
import type { LessonCategoryId } from "./domain/types";

type SelectedCategory = LessonCategoryId | "all";

export default function App() {
  const [selectedCategory, setSelectedCategory] = useState<SelectedCategory>("all");
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);
  const [isArticleOpen, setIsArticleOpen] = useState(false);
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

  useEffect(() => {
    if (!isCategoryMenuOpen) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCategoryMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCategoryMenuOpen]);

  const selectCategory = (category: SelectedCategory) => {
    setSelectedCategory(category);
    setSelectedLessonId(undefined);
    setIsArticleOpen(false);
    setIsCategoryMenuOpen(false);
  };

  return (
    <main className="shell">
      <aside className="sidebar desktop-sidebar" aria-label="Knowledge categories">
        <div className="brand">
          <span>{knowledgeBase.podcast.title}</span>
          <strong>Knowledge Base</strong>
        </div>
        <CategoryRail
          counts={categoryCounts}
          selectedCategory={selectedCategory}
          onSelectCategory={selectCategory}
        />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            aria-label="Open categories"
            aria-expanded={isCategoryMenuOpen}
            aria-controls="mobile-category-menu"
            onClick={() => setIsCategoryMenuOpen(true)}
          >
            <Menu aria-hidden="true" size={20} />
          </button>
          <label className="search">
            <Search aria-hidden="true" size={18} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedLessonId(undefined);
                setIsArticleOpen(false);
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

        <div className={isArticleOpen ? "content-grid detail-open" : "content-grid"}>
          <LessonList
            lessons={filteredLessons}
            selectedLessonId={selectedLesson?.id}
            onSelectLesson={(lessonId) => {
              setSelectedLessonId(lessonId);
              setIsArticleOpen(true);
            }}
          />

          {selectedLesson ? (
            <LessonDetail
              lesson={selectedLesson}
              sources={selectedSources}
              onBack={() => setIsArticleOpen(false)}
            />
          ) : (
            <section className="empty-state" aria-live="polite">
              No lessons found.
            </section>
          )}
        </div>
      </section>

      <div
        className={isCategoryMenuOpen ? "drawer-backdrop open" : "drawer-backdrop"}
        aria-hidden="true"
        onClick={() => setIsCategoryMenuOpen(false)}
      />
      <aside
        id="mobile-category-menu"
        className={isCategoryMenuOpen ? "mobile-drawer open" : "mobile-drawer"}
        aria-label="Knowledge categories"
        aria-hidden={!isCategoryMenuOpen}
      >
        <div className="drawer-header">
          <div className="brand">
            <span>{knowledgeBase.podcast.title}</span>
            <strong>Knowledge Base</strong>
          </div>
          <button
            className="menu-button"
          type="button"
          aria-label="Close categories"
          onClick={() => setIsCategoryMenuOpen(false)}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <CategoryRail
          counts={categoryCounts}
          selectedCategory={selectedCategory}
          onSelectCategory={selectCategory}
        />
        <a className="drawer-source-link" href={knowledgeBase.podcast.episodeIndexUrl} target="_blank" rel="noreferrer">
          Official episodes
        </a>
      </aside>
    </main>
  );
}
