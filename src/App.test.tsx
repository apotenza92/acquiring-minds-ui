import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the knowledge base by categories rather than episodes", () => {
    render(<App />);

    expect(screen.getByRole("navigation")).toHaveTextContent("Buyer Fit");
    expect(screen.getByRole("navigation")).toHaveTextContent("Financing & Terms");
    expect(screen.queryByText("Episode Transcript")).not.toBeInTheDocument();
  });

  it("filters lessons by search", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Search lessons"), "liquidity");

    expect(screen.getByRole("heading", { name: /post-close liquidity/i })).toBeInTheDocument();
  });

  it("shows source chips without transcript copy", () => {
    render(<App />);

    expect(screen.getByLabelText("Visible source evidence")).toHaveTextContent("Joe Wynn");
    expect(screen.getByLabelText("Visible source evidence")).toHaveTextContent("00:03:00");
    expect(screen.queryByText(/Will Smith:/)).not.toBeInTheDocument();
  });
});
