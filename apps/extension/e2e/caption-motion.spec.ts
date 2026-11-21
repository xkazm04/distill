// The caption and a page that moves (spark universal-core, round 1): #3 Stay clean while the page keeps changing, #4
// Things that float over the page, #8 Calm the page. Hermetic, on the demo pages caption-motion.html and
// caption-sticky.html; the same features on real sites are measured by live/probes/motion.live.ts.
import type { Page } from "playwright/test";
import { BAR, baseline, captionFrame, firstSight, measure, settled, startCaption } from "./caption";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, OUT, test } from "./harness";

/** A screenshot of the moment, for the evidence page: e2e/out/caption-motion-<name>.png. */
const snap = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `caption-motion-${name}.png`) });
};

const count = (status: string): number => Number(/^Removed (\d+)/.exec(status)?.[1] ?? 0);

/** The video's time, read twice 600 ms apart: playing when it moved. */
const playing = (page: Page, sel: string): Promise<boolean> => page.evaluate(async (s) => {
  const v = document.querySelector(s) as HTMLVideoElement;
  const t = v.currentTime;
  await new Promise((r) => setTimeout(r, 600));
  return !v.paused && v.currentTime > t;
}, sel);

/** The carousel's slide now and 2.6 s later (it moves every 1.2 s unless paused). */
const carouselMoves = (page: Page): Promise<boolean> => page.evaluate(async () => {
  const at = () => document.querySelector(".splide")?.getAttribute("data-slide") ?? "0";
  const seen = new Set([at()]);
  for (let i = 0; i < 13; i++) { await new Promise((r) => setTimeout(r, 200)); seen.add(at()); }
  return seen.size > 1;
});

/** Where the element's top is in the page (not the window). */
const pageTop = (page: Page, sel: string): Promise<number> =>
  page.evaluate((s) => (document.querySelector(s) as Element).getBoundingClientRect().top + scrollY, sel);

test("caption-motion: floating widgets go with Clean, Calm pauses what started by itself, the main video plays on", async ({ distill }) => {
  const tab = await distill.openTab("caption-motion");
  await tab.page.goto(`${tab.url}&late=0&ad=0`);
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  expect(await playing(tab.page, "#side-video")).toBe(true);
  expect(await carouselMoves(tab.page)).toBe(true);
  const base = await baseline(tab.page);

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  const status = await firstSight(frame);
  expect(status).toMatch(/^Removed \d+ distractions · Paused 1 video$/);

  // #4: each floating widget is gone, under its own name.
  for (const sel of [".smartbanner", ".sticky-player-wrap", ".back-to-top", "#w-4f2a", ".tab-fb"]) await expect(tab.page.locator(sel)).toBeHidden();
  await frame.getByTestId("cap-more-btn").click();
  const labels = await frame.getByTestId("cap-removed-item").locator("span:first-child").allTextContents();
  for (const l of ["App banner", "Floating video", "Back to top button", "Chat button", "Feedback tab"]) expect(labels).toContain(l);

  // #8: the floating video is paused, the article's video plays on, the carousel, the marquee and the live dot stand still.
  expect(await playing(tab.page, "#side-video")).toBe(false);
  expect(await playing(tab.page, "#main-video")).toBe(true);
  expect(await carouselMoves(tab.page)).toBe(false);
  await expect(tab.page.locator("html")).toHaveAttribute("data-distill-calm", "");
  expect(await tab.page.locator(".live-dot").evaluate((el) => getComputedStyle(el).animationPlayState)).toBe("paused");
  // A finished entrance animation (the headline's) is not touched.
  expect(await tab.page.locator("h1").evaluate((el) => el.hasAttribute("data-distill-still"))).toBe(false);
  await expect(frame.getByTestId("cap-calm")).toContainText("Paused 1 video and 3 moving parts");
  await settled(tab.page);
  await snap(tab.page, "calm-and-widgets");

  // The page's own content is all there, and the strip meets the bar.
  const m = await measure(tab.page, base);
  expect(m.contentKept).toBe(1);
  expect(m.h1Kept).toBe(true);
  expect(m.mediaKept).toBe(true);
  expect(m.overlaysLeft).toEqual([]);

  // Play again: the paused video plays (still muted), the carousel moves, the animation style goes.
  await frame.getByTestId("cap-play").click();
  await expect(frame.getByTestId("cap-calm")).toHaveCount(0);
  expect(await playing(tab.page, "#side-video")).toBe(true);
  expect(await tab.page.locator("#side-video").evaluate((v) => (v as HTMLVideoElement).muted)).toBe(true);
  expect(await carouselMoves(tab.page)).toBe(true);
  await expect(tab.page.locator("html")).not.toHaveAttribute("data-distill-calm", "");
  await expect(frame.getByTestId("cap-status")).toHaveText(/^Removed \d+ distractions$/);

  // Close: no Distill mark, style or attribute is left on the page.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await tab.page.evaluate(() => document.querySelectorAll("[data-distill-hide], [data-distill-still], [data-distill-paused], [data-distill-stopped], style[data-distill]").length)).toBe(0);
  await expect(tab.page.locator(".sticky-player-wrap")).toBeVisible();
});

test("caption-motion: Calm then close leaves a paused video paused and lets the rest move again", async ({ distill }) => {
  const tab = await distill.openTab("caption-motion");
  await tab.page.goto(`${tab.url}&late=0&ad=0`);
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  await startCaption(distill.worker, tab.id);
  await firstSight(await captionFrame(tab.page));
  expect(await playing(tab.page, "#side-video")).toBe(false);
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await playing(tab.page, "#side-video")).toBe(false);
  expect(await carouselMoves(tab.page)).toBe(true);
  expect(await tab.page.locator(".live-dot").evaluate((el) => getComputedStyle(el).animationPlayState)).toBe("running");
});

test("caption-motion: stays clean while the page keeps changing, rests during Original, and follows a single-page app", async ({ distill }) => {
  const tab = await distill.openTab("caption-motion");
  await tab.page.goto(`${tab.url}&late=2500&ad=3500`);
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  const first = count(await firstSight(frame));
  expect(first).toBeGreaterThan(0);

  // The late newsletter pop-up (and its backdrop) and the late advert go by themselves; the status line follows.
  const status = frame.getByTestId("cap-status");
  await expect(status).toHaveText(new RegExp(`^Removed ${first + 3} distractions`), { timeout: 10_000 });
  await tab.page.waitForTimeout(300);
  await snap(tab.page, "stay-clean");
  await expect(tab.page.locator(".newsletter-popup")).toBeHidden();
  await expect(tab.page.locator(".popup-backdrop")).toBeHidden();
  await expect(tab.page.locator(".ad-slot")).toBeHidden();
  await expect(tab.page.locator("#story p").first()).toBeVisible();
  // The pop-up locked the page's scroll; Stay clean lets it scroll again.
  expect(await tab.page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe("hidden");
  // What was removed lists each once, with ids that never collide.
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-removed-item")).toHaveCount(first + 3);
  expect(await frame.getByTestId("cap-removed-item").filter({ hasText: "Newsletter sign-up" }).count()).toBe(1);
  const ids = await tab.page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-hide]")).map((e) => e.getAttribute("data-distill-hide")));
  expect(new Set(ids).size).toBe(ids.length);
  await frame.getByTestId("cap-more-btn").click();

  // While the original is shown, Stay clean rests; back in Distill's view it looks once.
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  await tab.page.evaluate(() => {
    const d = document.createElement("div");
    d.className = "promo-overlay"; d.id = "late-2";
    d.setAttribute("style", "position:fixed;left:30%;top:30%;width:40%;height:40%;background:#fff;z-index:60;padding:20px");
    d.innerHTML = "<p>Win a weekend for two! Enter today.</p>";
    document.body.append(d);
  });
  await tab.page.waitForTimeout(1800);
  await expect(tab.page.locator("#late-2")).not.toHaveAttribute("data-distill-hide", /.*/);
  await frame.getByTestId("cap-back").click();
  await expect(tab.page.locator("#late-2")).toBeHidden({ timeout: 5_000 });
  await expect(status).toHaveText(new RegExp(`^Removed ${first + 4} distractions`));

  // A box the person is typing in is never hidden from under them.
  await tab.page.evaluate(() => {
    const d = document.createElement("div");
    d.className = "poll-box"; d.id = "poll";
    d.setAttribute("style", "position:fixed;left:35%;top:35%;width:30%;height:22%;background:#fff;z-index:60;padding:20px");
    d.innerHTML = "<p>Which playground do you like best?</p><input id='poll-answer' type='text'>";
    document.body.append(d);
    (document.getElementById("poll-answer") as HTMLInputElement).focus();
  });
  await tab.page.keyboard.type("The rope bridge");
  await tab.page.waitForTimeout(2500);
  await expect(tab.page.locator("#poll")).toBeVisible();
  await expect(status).toHaveText(new RegExp(`^Removed ${first + 4} distractions`));
  await tab.page.evaluate(() => document.getElementById("poll")?.remove());

  // A single-page app shows the next story: the new advert goes, the new text stays.
  await tab.page.locator("#next-story").click();
  await expect(tab.page.locator("#next-ad")).toBeHidden({ timeout: 5_000 });
  await expect(tab.page.locator("#story p").first()).toBeVisible();
  await expect(tab.page.locator("#story h1")).toHaveText("The farmers market moves to Saturdays");
  await expect(status).toHaveText(new RegExp(`^Removed ${first + 5} distractions`));
  await settled(tab.page);
  const m = await measure(tab.page, await baseline(tab.page));
  expect(m.strip.share).toBeLessThanOrEqual(BAR.shareDesktop);
  expect(m.strip.onTop).toBe(true);
});

for (const variant of ["fixed", "sticky"] as const) {
  test(`caption-motion: a tall ${variant} header scrolls with the page, nothing jumps, Original and close put it back`, async ({ distill }) => {
    const tab = await distill.openTab("caption-sticky");
    if (variant === "sticky") await tab.page.goto(`${tab.url}&sticky`);
    await tab.page.setViewportSize({ width: 1440, height: 900 });
    const paraTop = await pageTop(tab.page, "main p");
    expect(await tab.page.locator("header.top").evaluate((el) => getComputedStyle(el).position)).toBe(variant);

    expect(await startCaption(distill.worker, tab.id)).toBe(true);
    await firstSight(await captionFrame(tab.page));
    const header = tab.page.locator("header.top");
    await expect(header).toHaveAttribute("data-distill-unstick", variant);
    if (variant === "fixed") {
      // Before and after: scrolled a little, the header that covered a sixth of the window has gone up with the page.
      await tab.page.evaluate(() => scrollTo({ top: 400, behavior: "instant" }));
      await snap(tab.page, "unstick-distill");
      const f = await captionFrame(tab.page);
      await f.getByTestId("cap-original").click();
      await f.getByTestId("cap-back").waitFor();
      await snap(tab.page, "unstick-original");
      await f.getByTestId("cap-back").click();
      await f.getByTestId("cap-original").waitFor();
      await tab.page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    }
    await expect(tab.page.locator("h1")).toBeVisible();
    expect(Math.abs((await pageTop(tab.page, "main p")) - paraTop)).toBeLessThanOrEqual(2);
    expect(await pageTop(tab.page, "h1")).toBeLessThan(150);

    // Scrolled down, the header has gone up with the page: the text has the whole window.
    await tab.page.evaluate(() => scrollTo({ top: 600, behavior: "instant" }));
    expect(await header.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
    // Back at the top, its menu is where it was.
    await tab.page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    expect(await header.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);

    // Original shows the header as the site made it: following the page.
    const frame = await captionFrame(tab.page);
    await tab.page.evaluate(() => scrollTo({ top: 600, behavior: "instant" }));
    await frame.getByTestId("cap-original").click();
    await frame.getByTestId("cap-back").waitFor();
    expect(await header.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0);
    await frame.getByTestId("cap-back").click();

    // Close: the header is the site's again.
    expect(await startCaption(distill.worker, tab.id)).toBe(false);
    await expect(header).not.toHaveAttribute("data-distill-unstick", /.*/);
    expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe(variant);
    expect(await tab.page.evaluate(() => document.querySelectorAll("style[data-distill]").length)).toBe(0);
  });
}
