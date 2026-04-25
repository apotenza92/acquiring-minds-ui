import type { LessonCategory } from "../domain/types";

export const categories: LessonCategory[] = [
  { id: "buyer-fit", label: "Buyer Fit" },
  { id: "sourcing", label: "Sourcing" },
  { id: "deal-evaluation", label: "Deal Evaluation" },
  { id: "financing-terms", label: "Financing & Terms" },
  { id: "due-diligence", label: "Due Diligence" },
  { id: "closing-transition", label: "Closing & Transition" },
  { id: "operating", label: "Operating" },
  { id: "growth", label: "Growth" },
  { id: "risk-failure", label: "Risk & Failure" },
  { id: "exit-long-term-hold", label: "Exit & Long-Term Hold" },
];

export const categoryLabels = Object.fromEntries(
  categories.map((category) => [category.id, category.label]),
) as Record<LessonCategory["id"], string>;
