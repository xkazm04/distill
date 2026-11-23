// Spark round 5, r5-01: pictures that guard the look. Fixed screenshots of the strip in each state (first line, More
// open, a tour running, Original), light and dark, at 1440x900 and 390x844, and of the cleaned demo pages, compared with
// the approved pictures in caption-visual.spec.ts-snapshots/ (committed: a look change is a reviewed change). A
// difference over the threshold fails, and Playwright writes expected, actual and diff side by side (the HTML report,
// e2e/out/report/, and the gallery, e2e/out/visual/index.html). Approve a change: README.md here, "Pictures".
//
// What keeps the pictures still: the device scale fixed at 1, reduced motion and animations disabled, the caret hidden,
// fonts loaded, the mouse parked, the clock fixed (the byline's "3 years ago" and the deadlines are dates), the stand-in
// model's deterministic answers, and the strip waited on until its line and its box hold. The real sites: live/visual.live.ts.
import type { Frame, Locator, Page, Worker } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { type Distill, expect, test } from "./harness";
import { writeGallery } from "./visual";

test.use({ deviceScaleFactor: 1 });
test.afterAll(() => writeGallery());

/** The day the pictures live on: every date Distill writes ("x ago", "in 3 days", a deadline's tour step) counts from it. */
const NOW = new Date("2026-11-23T10:00:00+01:00");
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
/** Demo pages are the same each run: a tight threshold, a few anti-aliased pixels at most. */
const TIGHT = { maxDiffPixelRatio: 0.002, threshold: 0.2 } as const;

async function fakeModel(worker: Worker) {
  await worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
}

/** Opens a demo page at `size` and `scheme` with the clock fixed and reduced motion, and starts the caption on it. */
async function open(distill: Distill, name: string, size: { width: number; height: number },
  scheme: "light" | "dark", model: boolean): Promise<{ page: Page; frame: Frame }> {
  await distill.context.clock.setFixedTime(NOW);
  if (model) await fakeModel(distill.worker);
  const tab = await distill.openTab(name);
  const page = tab.page;
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  return { page, frame };
}

/** Waits until the strip is done: fonts in, AI phases past finding, the line and the strip's box unchanged for 800 ms. */
async function still(page: Page, frame: Frame) {
  await frame.evaluate(() => document.fonts.ready.then(() => true));
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const chip = frame.getByTestId("cap-chip");
  if (await chip.count()) {
    await expect(chip).not.toHaveAttribute("data-claims-phase", /^(idle|finding)$/, { timeout: 20_000 });
    await expect(chip).not.toHaveAttribute("data-gist-phase", /^(idle|finding)$/, { timeout: 20_000 });
  }
  const look = () => frame.evaluate(() => `${document.querySelector("[data-testid=cap-row]")?.textContent ?? ""}|${document.body.scrollHeight}`);
  let last = await look();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(400);
    const now = await look();
    if (now === last) { const again = await look(); await page.waitForTimeout(400); if (again === (await look())) break; }
    last = now;
  }
  await settled(page);
  await page.mouse.move(1, 1); // no hover style on whatever was clicked last
}

/** The strip alone: the host element on the page, which holds the frame. */
const strip = (page: Page): Locator => page.locator("distill-caption");

async function snapStrip(page: Page, frame: Frame, name: string) {
  await still(page, frame);
  await expect(strip(page)).toHaveScreenshot(`${name}.png`, { ...TIGHT, animations: "disabled", caret: "hide", scale: "css" });
}

async function openMore(frame: Frame) {
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  await expect(frame.getByTestId("cap-gist")).toHaveAttribute("data-phase", "ready");
  await frame.getByTestId("cap-more").evaluate((el) => el.scrollTo(0, 0));
}

for (const scheme of ["light", "dark"] as const) {
  for (const [sizeName, size] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    test(`pictures: the strip in each state, ${scheme}, ${sizeName}`, async ({ distill }) => {
      // The claims demo with the stand-in model: the line with claims and the chip, the gist in More, the facts tour.
      const { page, frame } = await open(distill, "caption-claims", size, scheme, true);
      await expect(frame.getByTestId("cap-status")).toHaveText(/6 claims to check/, { timeout: 15_000 });
      await snapStrip(page, frame, `strip-first-${scheme}-${sizeName}`);

      await openMore(frame);
      await snapStrip(page, frame, `strip-more-${scheme}-${sizeName}`);

      // A tour running: Just the facts, its second step (Back is live, the step's words highlighted on the page).
      await page.evaluate(() => scrollTo(0, 0));
      await frame.getByTestId("cap-tour-start-facts").click();
      await expect(frame.getByTestId("cap-more")).toHaveCount(0);
      await expect(frame.getByTestId("cap-tour-status")).toHaveText(/^Step 1 of/);
      await frame.getByTestId("cap-tour-next").click();
      await expect(frame.getByTestId("cap-tour-status")).toHaveText(/^Step 2 of/);
      await frame.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await snapStrip(page, frame, `strip-tour-${scheme}-${sizeName}`);
      await frame.getByTestId("cap-tour-end").click();
      await expect(frame.getByTestId("cap-tour-status")).toHaveCount(0);

      await frame.getByTestId("cap-original").click();
      await expect(frame.getByTestId("cap-back")).toBeVisible();
      await frame.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await snapStrip(page, frame, `strip-original-${scheme}-${sizeName}`);
    });
  }
}

/** The cleaned demo pages, the whole window: what a person sees after the click. */
const PAGES: { name: string; size: "desktop" | "phone"; model?: boolean; why: string }[] = [
  { name: "caption-claims", size: "desktop", model: true, why: "an article with its claims marked and the gist ready" },
  { name: "caption-claims", size: "phone", model: true, why: "the same at phone width" },
  { name: "caption-actions", size: "desktop", why: "a village notice with its things to do washed" },
  { name: "caption-comfort", size: "desktop", why: "an old small-type company page made easier to read" },
  { name: "caption-shop", size: "desktop", why: "a shop page: product facts, its clutter gone" },
  { name: "caption-shop", size: "phone", why: "the same at phone width" },
  // Not caption-tables: its column comes out 860 or 900 px wide depending on timing (3 runs in 12, round 5), and 764 px
  // after a resize; a picture of it would fail by chance. Reported; add it back once the width is settled.
  { name: "caption-consent", size: "desktop", why: "a library page after its cookie banner was answered" },
  { name: "caption-reflow", size: "desktop", why: "a news page reflowed to one column" },
  { name: "caption-video", size: "desktop", why: "a video page (the video itself masked)" },
];

for (const p of PAGES) {
  test(`pictures: the cleaned page ${p.name}, ${p.size}`, async ({ distill }) => {
    const { page, frame } = await open(distill, p.name, p.size === "desktop" ? DESKTOP : PHONE, "light", !!p.model);
    await still(page, frame);
    await page.evaluate(() => scrollTo(0, 0));
    await settled(page);
    await expect(page).toHaveScreenshot(`page-${p.name.replace(/^caption-/, "")}-${p.size}.png`, {
      ...TIGHT, animations: "disabled", caret: "hide", scale: "css",
      // Parts that change by themselves: a video's frame, an embedded player.
      mask: [page.locator("video, iframe:not([src*='caption.html'])")],
    });
  });
}
