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

test("caption-lifecycle: Stay clean keeps Calm and the reading layer up to date, and keeps the person's switch (G5)", async ({ distill }) => {
  const tab = await distill.openTab("caption-lifecycle");
  await tab.page.goto(`${tab.url}&late=2500`);
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const { frame, status } = await open(distill, tab);
  const first = count(status);
  const line = frame.getByTestId("cap-status");

  // The late advert goes; the ticker that came with it stops, and Calm counts it.
  await expect(line).toHaveText(new RegExp(`^Removed ${first + 1} distractions`), { timeout: 10_000 });
  await expect(tab.page.locator(".reklama")).toBeHidden();
  await expect(tab.page.locator(".ticker marquee")).toHaveAttribute("data-distill-stopped", "", { timeout: 3_000 });
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-calm")).toContainText("Paused 1 video and 2 moving parts");
  await frame.getByTestId("cap-more-btn").click();
  // More closes with a 220 ms slide: until the strip has settled it still covers the bottom of the window, and a click
  // there lands in the strip, not on the page (Playwright's hit check does not see through the strip's closed shadow
  // root and extension frame). This was the cause of G5's flake: the click on "Další zpráva" went to the strip about
  // 1 run in 6, so the next story never came.
  await settled(tab.page);

  // A single-page app shows the next story in small grey print: its advert goes, the reading layer covers its text,
  // its ticker stops.
  await tab.page.locator("#dalsi").click();
  await expect(tab.page.locator("article.partner h1")).toHaveText("Zimní údržba chodníků začíná v pondělí");
  await expect(tab.page.locator("article.partner .reklama")).toBeHidden({ timeout: 5_000 });
  const size = () => tab.page.locator("article.partner p:not(.meta)").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await expect.poll(size, { timeout: 5_000 }).toBeGreaterThanOrEqual(16);
  await expect(tab.page.locator("article.partner marquee")).toHaveAttribute("data-distill-stopped", "");
  await frame.getByTestId("cap-more-btn").click();
  const sw = frame.getByTestId("cap-comfort");
  await expect(sw).toBeChecked();
  await settled(tab.page);
  await snap(tab.page, "next-view-comfort");

  // The person turns the reading layer off; the next story keeps it off, and on again it covers that story too.
  await sw.click();
  await expect(sw).not.toBeChecked();
  await expect.poll(size).toBe(11);
  await frame.getByTestId("cap-more-btn").click();
  await settled(tab.page);
  await tab.page.locator("#dalsi").click();
  await expect(tab.page.locator("article.partner h1")).toHaveText("Knihovna prodlouží otevírací dobu");
  await expect(tab.page.locator("article.partner .reklama")).toBeHidden({ timeout: 5_000 });
  await tab.page.waitForTimeout(600);
  expect(await size()).toBe(11);
  await frame.getByTestId("cap-more-btn").click();
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();
  await expect.poll(size).toBeGreaterThanOrEqual(16);

  // Close: nothing of it is left.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await tab.page.evaluate(() => document.querySelectorAll("[data-distill-hide], [data-distill-stopped], [data-distill-comfort], [data-distill-comfort-text], style[data-distill]").length)).toBe(0);
});

/** Where the headline, the text and the column of caption-reflow.html are, and what Distill marked. */
function headline(page: Page) {
  return page.evaluate(() => {
    const h1 = document.querySelector("h1") as HTMLElement;
    const p = document.querySelector("article p:not(.meta)") as HTMLElement;
    const a = document.querySelector("article") as HTMLElement;
    return {
      h1Left: Math.round(h1.getBoundingClientRect().left), h1Right: Math.round(h1.getBoundingClientRect().right),
      textLeft: Math.round(p.getBoundingClientRect().left), columnRight: Math.round(a.getBoundingClientRect().right),
      h1Font: getComputedStyle(h1).font, h1Color: getComputedStyle(h1).color,
      widened: document.querySelectorAll("[data-distill-widen]").length,
      headMarked: !!h1.closest("[data-distill-widen]"),
    };
  });
}

test("caption-lifecycle: the headline above the columns follows the centred column, and Original puts it back (G8)", async ({ distill }) => {
  const tab = await distill.openTab("caption-reflow");
  await tab.page.goto(`${tab.url}&head`);
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const before = await headline(tab.page);
  expect(before.h1Left).toBe(before.textLeft);

  const { frame } = await open(distill, tab);
  const after = await headline(tab.page);
  expect(after.widened).toBeGreaterThanOrEqual(2); // the column and the headline block
  expect(after.textLeft).toBeGreaterThan(before.textLeft + 100);
  expect(Math.abs(after.h1Left - after.textLeft)).toBeLessThanOrEqual(2);
  expect(after.h1Right).toBeLessThanOrEqual(after.columnRight + 2);
  // Only its place changes: never its font, size or colour.
  expect(after.h1Font).toBe(before.h1Font);
  expect(after.h1Color).toBe(before.h1Color);
  await settled(tab.page);
  await snap(tab.page, "headline-follows");

  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  expect(await headline(tab.page)).toMatchObject({ h1Left: before.h1Left, textLeft: before.textLeft });
  await snap(tab.page, "headline-original");
  await frame.getByTestId("cap-back").click();

  // The sidebar back: the column and the headline take their own place again.
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByRole("button", { name: "Show Sidebar again" }).click();
  await expect.poll(async () => (await headline(tab.page)).h1Left).toBe(before.h1Left);
  expect((await headline(tab.page)).textLeft).toBe(before.textLeft);
});

test("caption-lifecycle: a sidebar advert that loads after Clean leaves no hole: the column and its headline follow (G5, G8)", async ({ distill }) => {
  const tab = await distill.openTab("caption-reflow");
  await tab.page.goto(`${tab.url}&head&lateside=2500`);
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const before = await headline(tab.page);
  const { frame, status } = await open(distill, tab);
  const first = count(status);
  // Nothing beside the column yet: nothing to widen.
  expect((await headline(tab.page)).widened).toBe(0);

  await expect(frame.getByTestId("cap-status")).toHaveText(new RegExp(`^Removed ${first + 1} distractions`), { timeout: 10_000 });
  await expect(tab.page.locator("aside.sidebar")).toBeHidden();
  await expect.poll(async () => (await headline(tab.page)).widened, { timeout: 3_000 }).toBeGreaterThanOrEqual(2);
  const after = await headline(tab.page);
  expect(after.textLeft).toBeGreaterThan(before.textLeft + 100);
  expect(Math.abs(after.h1Left - after.textLeft)).toBeLessThanOrEqual(2);
  await settled(tab.page);
  await snap(tab.page, "late-sidebar-widened");
});
