import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { knowledgeBase } from "./domain/knowledgeBase";

describe("App", () => {
  it("renders the knowledge base by categories rather than episodes", () => {
    render(<App />);

    expect(screen.getByRole("navigation")).toHaveTextContent("Buyer Fit");
    expect(screen.getByRole("navigation")).toHaveTextContent("Financing & Terms");
    expect(screen.queryByText("Episode Transcript")).not.toBeInTheDocument();
  });

  it("filters lessons by search", async () => {
    const user = userEvent.setup();
    const targetLesson = knowledgeBase.lessons[0];
    render(<App />);

    await user.type(screen.getByLabelText("Search lessons"), targetLesson.title);

    expect(screen.getByRole("heading", { name: targetLesson.title })).toBeInTheDocument();
  });

  it("shows article source evidence without transcript copy", () => {
    const firstLesson = knowledgeBase.lessons[0];
    const firstEpisode = knowledgeBase.episodes.find((episode) => episode.id === firstLesson.evidence[0].episodeId);
    render(<App />);

    expect(firstEpisode).toBeDefined();
    expect(screen.getByLabelText("Source")).toHaveTextContent(firstEpisode?.guest ?? "");
    expect(screen.getByLabelText("Source")).toHaveTextContent(firstEpisode?.title ?? "");
    expect(screen.getByLabelText("Source")).toHaveTextContent("Discussed");
    expect(screen.queryByText(/Will Smith:/)).not.toBeInTheDocument();
  });
});
