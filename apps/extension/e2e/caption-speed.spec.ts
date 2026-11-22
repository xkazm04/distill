// Clean on a very large page (round-1 gaps G15 and G11). Hermetic, on the demo page caption-speed.html: a video page
// with a hidden mega-menu of thousands of links, icons everywhere, 300 recommendations and 200 comments, and inside the
// description (which has a bare line of text of its own, so the page reader reads the box itself) a share bar, an
// advert and a sign-up. The same on real sites is measured by live/probes/speed.live.ts.
import type { Page } from "playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BAR, captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const snap = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `caption-speed-${name}.png`) });
};

/** The boxes Clean takes from this page, in page order, by a selector each. */
const GONE = [".masthead", ".share-bar", ".ad-slot", ".newsletter-box", "#comments", "#related", "footer", ".cookie-bar"];

test("caption-speed: Clean on a page of 20,000 elements takes exactly the clutter, inside the read description too", async ({ distill }) => {
  const tab = await distill.openTab("caption-speed");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const elements = await tab.page.evaluate(() => document.querySelectorAll("*").length);
  expect(elements).toBeGreaterThan(20_000);

  const t0 = Date.now();
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  const status = await firstSight(frame);
  const firstMs = Date.now() - t0;
  test.info().annotations.push({ type: "first sight", description: `${firstMs} ms on ${elements} elements` });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "caption-speed.json"), JSON.stringify({ elements, firstMs, status }, null, 2));
  expect(firstMs).toBeLessThan(BAR.firstSightMs);

  // Exactly these, in page order, each under its own id (c0, c1, ...).
  expect(status).toMatch(/^Removed 8 distractions/);
  const hidden = await tab.page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-hide]")).map((el) => el.getAttribute("data-distill-hide")));
  expect(hidden).toEqual(GONE.map((_s, i) => `c${i}`));
  for (const [i, sel] of GONE.entries()) {
    await expect(tab.page.locator(sel)).toHaveAttribute("data-distill-hide", `c${i}`);
    await expect(tab.page.locator(sel)).toBeHidden();
  }
  // G11: the description the page reader read stays whole, its own line too; only the three boxes in it went.
  await expect(tab.page.locator("article.description")).toBeVisible();
  await expect(tab.page.locator("article.description h1")).toBeVisible();
  await expect(tab.page.locator("article.description")).toContainText("Zveřejněno 3. března 2026");
  await expect(tab.page.locator("article.description p")).toHaveCount(4 + 2); // four of the recipe, two inside the ad and the sign-up
  for (const p of await tab.page.locator("article.description > p").all()) await expect(p).toBeVisible();
  await expect(tab.page.locator("#main-video")).toBeVisible();
  await frame.getByTestId("cap-more-btn").click();
  const labels = await frame.getByTestId("cap-removed-item").locator("span:first-child").allTextContents();
  expect(labels).toEqual(["Site header", "Share buttons", "Advert", "Newsletter sign-up", "Comments", "Related links", "Footer", "Cookie notice"]);
  await frame.getByTestId("cap-more-btn").click();
  await tab.page.locator("article.description").scrollIntoViewIfNeeded();
  await snap(tab.page, "distill");

  // Original brings each of them back.
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  for (const sel of [".share-bar", ".ad-slot", ".newsletter-box"]) await expect(tab.page.locator(sel)).toBeVisible();
  await snap(tab.page, "original");
  await frame.getByTestId("cap-back").click();
});
