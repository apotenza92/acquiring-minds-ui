import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const knowledgeBase = JSON.parse(readFileSync("src/data/acquiring-minds.lessons.json", "utf8"));

test.describe("knowledge base UI", () => {
  test("keeps layout panels independently scrollable on desktop", async ({ page }) => {
    const firstLesson = knowledgeBase.lessons[0];
    await page.goto("/");

    await expect(page.getByRole("heading", { name: firstLesson.title })).toBeVisible();
    await expect(page.getByRole("region", { name: "Source", exact: true })).toBeVisible();

    const layout = await page.evaluate(() => {
      const styleOf = (selector: string) => {
        const element = selector === "body" ? document.body : document.querySelector(selector);
        if (!element) {
          throw new Error(`Missing element: ${selector}`);
        }
        const styles = getComputedStyle(element);
        return {
          overflow: styles.overflow,
          overflowX: styles.overflowX,
          overflowY: styles.overflowY,
          height: styles.height,
        };
      };

      return {
        body: styleOf("body"),
        shell: styleOf(".shell"),
        categoryRail: styleOf(".category-rail"),
        lessonList: styleOf(".lesson-list"),
        lessonDetail: styleOf(".lesson-detail"),
        bodyScrollHeight: document.body.scrollHeight,
        viewportHeight: window.innerHeight,
      };
    });

    expect(layout.body.overflow).toBe("hidden");
    expect(layout.shell.overflow).toBe("hidden");
    expect(layout.categoryRail.overflowY).toBe("auto");
    expect(layout.lessonList.overflowY).toBe("auto");
    expect(layout.lessonDetail.overflowY).toBe("auto");
    expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.viewportHeight + 2);
  });

  test("shows source chips without transcript text and links to live source pages", async ({ page }) => {
    const firstLesson = knowledgeBase.lessons[0];
    const firstSource = firstLesson.evidence[0];
    const firstEpisode = knowledgeBase.episodes.find((episode: { id: string }) => episode.id === firstSource.episodeId);
    await page.goto("/");

    const source = page.getByRole("region", { name: "Source", exact: true }).getByRole("link").first();
    await expect(source).toContainText(firstEpisode.guest);
    await expect(source).toContainText(firstEpisode.title);
    await expect(source).toContainText("Discussed");

    const href = await source.getAttribute("href");
    expect(href).toBe(firstSource.youtubeUrl ?? firstSource.officialUrl ?? firstSource.audioUrl);
    await expect(page.getByText(/Will Smith:/)).toHaveCount(0);
  });

  test("filters lessons while keeping source evidence in the article", async ({ page }) => {
    const targetLesson = knowledgeBase.lessons[Math.min(10, knowledgeBase.lessons.length - 1)];
    await page.goto("/");

    await page.getByLabel("Search lessons").fill(targetLesson.title);

    await expect(page.getByRole("heading", { name: targetLesson.title })).toBeVisible();
    await expect(page.getByRole("region", { name: "Source", exact: true })).toBeVisible();
  });

  test("uses a hamburger category drawer on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Open categories" })).toBeVisible();
    await expect(page.getByRole("navigation")).toBeHidden();

    await page.getByRole("button", { name: "Open categories" }).click();
    const drawerNavigation = page.locator("#mobile-category-menu").getByRole("navigation");
    await expect(drawerNavigation).toBeVisible();

    await drawerNavigation.getByRole("button", { name: /Financing & Terms/ }).click();
    await expect(drawerNavigation).toBeHidden();
    await expect(page.getByRole("region", { name: "Lessons" })).toContainText("Financing & Terms");
  });

  test("opens mobile articles from a scrollable list screen", async ({ page }) => {
    const firstLesson = knowledgeBase.lessons[0];
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.getByRole("region", { name: "Lessons" })).toBeVisible();
    await expect(page.getByRole("heading", { name: firstLesson.title })).toBeHidden();

    await page.getByRole("button", { name: new RegExp(firstLesson.title) }).click();
    await expect(page.getByRole("region", { name: "Lessons" })).toBeHidden();
    await expect(page.getByRole("heading", { name: firstLesson.title })).toBeVisible();

    await page.getByRole("button", { name: "Articles" }).click();
    await expect(page.getByRole("region", { name: "Lessons" })).toBeVisible();
  });
});
