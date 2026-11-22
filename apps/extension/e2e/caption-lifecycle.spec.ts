// The page side's life cycle after Clean (round-1 gaps G1, G2, G4, G5, G8, G12): what Clean protects (only the main
// video; a small form of the article), what follows when the page changes after Clean (Stay clean re-runs the column,
// the reading layer and Calm), what follows when the person brings something back, and the counts after Play again.
// Hermetic, on caption-lifecycle.html and caption-reflow.html; on real sites: live/probes/motion.live.ts and layout.live.ts.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

/** A picture of the moment for the review (e2e/out, git-ignored). */
const snap = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `caption-lifecycle-${name}.png`) });
};

const count = (status: string): number => Number(/^Removed (\d+)/.exec(status)?.[1] ?? 0);

/** The video's time, read twice 600 ms apart: playing when it moved. */
const playing = (page: Page, sel: string): Promise<boolean> => page.evaluate(async (s) => {
  const v = document.querySelector(s) as HTMLVideoElement;
  const t = v.currentTime;
  await new Promise((r) => setTimeout(r, 600));
  return !v.paused && v.currentTime > t;
}, sel);

/** Opens the caption on the page and waits for first sight; returns the frame and the status line. */
async function open(distill: { worker: Parameters<typeof startCaption>[0] }, tab: { page: Page; id: number }): Promise<{ frame: Frame; status: string }> {
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  return { frame, status: await firstSight(frame) };
}

test("caption-lifecycle: Calm pauses a second video that started by itself; only the main video is the page's (G1)", async ({ distill }) => {
  const tab = await distill.openTab("caption-lifecycle");
  // Tall enough for both videos to be on screen: Chrome pauses a muted video that plays by itself off screen.
  await tab.page.setViewportSize({ width: 1440, height: 1800 });
  expect(await playing(tab.page, "#hlavni-video")).toBe(true);
  expect(await playing(tab.page, "#druhe-video")).toBe(true);

  const { frame, status } = await open(distill, tab);
  expect(status).toMatch(/^Removed \d+ distractions · Paused 1 video · Page in Czech$/);
  expect(await playing(tab.page, "#hlavni-video")).toBe(true);
  expect(await playing(tab.page, "#druhe-video")).toBe(false);
  await expect(tab.page.locator("#druhe-video")).toHaveAttribute("data-distill-paused", "");
  await expect(tab.page.locator("#hlavni-video")).not.toHaveAttribute("data-distill-paused", /.*/);
  // Both stay on the page: the second video sits in the article's text, so Clean keeps it as content.
  await expect(tab.page.locator("#druhe-video")).toBeVisible();
  await settled(tab.page);
  await snap(tab.page, "second-video-paused");
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-calm")).toContainText("Paused 1 video");
});

test("caption-lifecycle: a small form of the article stays, a sign-up and a search box still go (G4)", async ({ distill }) => {
  const tab = await distill.openTab("caption-lifecycle");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const { frame } = await open(distill, tab);
  // The two-field note to the editors in the article, and the one-field correction form right after it.
  await expect(tab.page.locator("#comment")).toBeVisible();
  await expect(tab.page.locator("form.oprava")).toBeVisible();
  // The newsletter sign-up in the article and the header with its search box are still taken out.
  await expect(tab.page.locator("form.newsletter")).toBeHidden();
  await expect(tab.page.locator("header.site")).toBeHidden();
  await frame.getByTestId("cap-more-btn").click();
  const labels = await frame.getByTestId("cap-removed-item").locator("span:first-child").allTextContents();
  expect(labels).toContain("Newsletter sign-up");
  expect(labels).not.toContain("Comments");
  await tab.page.locator("#comment").scrollIntoViewIfNeeded();
  await settled(tab.page);
  await snap(tab.page, "small-forms");
});

test("caption-lifecycle: a tall sticky header brought back from More scrolls with the page, and close puts it back (G2)", async ({ distill }) => {
  const tab = await distill.openTab("caption-lifecycle");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const header = tab.page.locator("header.site");
  const { frame } = await open(distill, tab);
  await expect(header).toBeHidden();

  await frame.getByTestId("cap-more-btn").click();
  await frame.getByRole("button", { name: "Show Site header again" }).click();
  await expect(header).toBeVisible();
  await expect(header).toHaveAttribute("data-distill-unstick", "sticky");
  // Scrolled down, it has gone up with the page instead of covering the text.
  await tab.page.evaluate(() => scrollTo({ top: 700, behavior: "instant" }));
  expect(await header.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  await snap(tab.page, "header-back-scrolls");
  // Original shows it as the site made it: following the page.
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  expect(await header.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0);
  await frame.getByTestId("cap-back").click();
  await frame.getByTestId("cap-original").waitFor();

  // Show everything again: the same.
  await tab.page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByRole("button", { name: "Show everything again" }).click();
  await expect(header).toHaveAttribute("data-distill-unstick", "sticky");

  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(header).not.toHaveAttribute("data-distill-unstick", /.*/);
  expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
});

test("caption-lifecycle: after Play again, the next report reads no paused video at once (G12)", async ({ distill }) => {
  // The round-1 motion page: its floating video is paused by Calm with or without G1.
  const tab = await distill.openTab("caption-motion");
  await tab.page.goto(`${tab.url}&late=0&ad=0`);
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const { frame, status } = await open(distill, tab);
  expect(status).toContain("Paused 1 video");
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-play").click();
  await expect(frame.getByTestId("cap-calm")).toHaveCount(0);
  // Right away (Stay clean has not looked again yet): bring an item back; its report must not say "Paused".
  await frame.getByTestId("cap-removed-item").getByRole("button").first().click();
  const line = frame.getByTestId("cap-status");
  await expect(line).toContainText("1 back");
  expect(await line.textContent()).not.toContain("Paused");
});

