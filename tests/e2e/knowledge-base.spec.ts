import { expect, test } from "@playwright/test";

test.describe("knowledge base UI", () => {
  test("keeps layout panels independently scrollable on desktop", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /buyer fit can become deal leverage/i })).toBeVisible();
    await expect(page.getByLabel("Source evidence")).toBeVisible();

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
    await page.goto("/");

    const source = page.getByLabel("Source evidence").getByRole("link").first();
    await expect(source).toContainText("Joe Wynn");
    await expect(source).toContainText("Transcript time 00:03:00");

    const href = await source.getAttribute("href");
    expect(href).toBe("https://acquiringminds.co/articles/joe-wynn-surgical-specialties");
    await expect(page.getByText(/Will Smith:/)).toHaveCount(0);
  });

  test("filters lessons while keeping source evidence in the article", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Search lessons").fill("liquidity");

    await expect(page.getByRole("heading", { name: /post-close liquidity/i })).toBeVisible();
    await expect(page.getByLabel("Source evidence")).toBeVisible();
  });
});
