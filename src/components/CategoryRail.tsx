import { categories } from "../data/categories";
import type { LessonCategoryId } from "../domain/types";

type SelectedCategory = LessonCategoryId | "all";

interface CategoryRailProps {
  counts: Map<SelectedCategory, number>;
  selectedCategory: SelectedCategory;
  onSelectCategory: (category: SelectedCategory) => void;
}

export function CategoryRail({ counts, selectedCategory, onSelectCategory }: CategoryRailProps) {
  return (
    <nav className="category-rail">
      <button
        className={selectedCategory === "all" ? "category-button active" : "category-button"}
        type="button"
        onClick={() => onSelectCategory("all")}
      >
        <span>All</span>
        <span>{counts.get("all") ?? 0}</span>
      </button>

      {categories.map((category, index) => (
        <button
          className={selectedCategory === category.id ? "category-button active" : "category-button"}
          key={category.id}
          type="button"
          onClick={() => onSelectCategory(category.id)}
        >
          <span>{index + 1}. {category.label}</span>
          <span>{counts.get(category.id) ?? 0}</span>
        </button>
      ))}
    </nav>
  );
}
