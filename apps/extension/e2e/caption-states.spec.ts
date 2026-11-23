// Spark round 5, r5-09: waiting, empty and failed said calmly, in real Chromium with the e2e build's stand-in model set
// slow (delayMs) or failing (fail). Every AI section waits with a quiet placeholder in the shape of what is coming (no
// spinner), then shows its answer; when the AI fails it says why in one line and Try again works once the AI answers
// again. Motion stops under reduced motion. Also r5-04's kit on screen: the count pills and the line icons.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { captionFrame, firstSight, showPart, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");

async function fakeModel(worker: Worker, opts: { fail?: string; delayMs?: number } = {}) {
  await worker.evaluate(async (o) => { await chrome.storage.session.set({ "distill:e2e:fakeAi": o }); }, opts);
}

async function openMore(frame: Frame, part?: string) {
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  // r5-02: More is in parts; the section asked for is in its part.
  if (part) await showPart(frame, part);
}

const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator("distill-caption").screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 85, animations: "disabled" });
};

/** No spinner anywhere in the strip: nothing turns, nothing has a spinner's name. */
const spinners = (frame: Frame) => frame.evaluate(() =>
  Array.from(document.querySelectorAll<HTMLElement>("*")).filter((e) => {
    const s = getComputedStyle(e);
    return /spin|rotate/i.test(s.animationName) || /spin/i.test(e.className.toString());
  }).length);

test("waiting: the gist and the claims wait in their own shape, then answer; Ask and the web check wait too", async ({ distill }) => {
  const tab = await distill.openTab("caption-claims");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await fakeModel(distill.worker, { delayMs: 3000 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await openMore(frame);

  const gist = frame.getByTestId("cap-gist");
  const claims = frame.getByTestId("cap-claims");
  await expect(gist).toHaveAttribute("data-phase", "finding");
  await expect(gist).toHaveAttribute("aria-busy", "true");
  await expect(frame.getByTestId("cap-gist-waiting")).toContainText("Reading the article for its main points...");
  await expect(frame.getByTestId("cap-gist-waiting").locator(".k-wait-bar")).toHaveCount(3);
  await expect(claims).toHaveAttribute("data-phase", "finding");
  await expect(frame.getByTestId("cap-claims-waiting")).toContainText("Looking for claims to check...");
  expect(await spinners(frame)).toBe(0);
  await shot(page, "r5-09-waiting");

  await expect(gist).toHaveAttribute("data-phase", "ready", { timeout: 15_000 });
  await expect(frame.getByTestId("cap-gist-waiting")).toHaveCount(0);
  await expect(frame.getByTestId("cap-gist-point")).toHaveCount(3);
  await expect(claims).toHaveAttribute("data-phase", "ready", { timeout: 15_000 });
  await expect(frame.getByTestId("cap-claim")).toHaveCount(6);
  // r5-04: the count in its pill, read as "(6)"; each claim with its line icon.
  await expect(claims.locator(".k-count")).toHaveText("(6)");
  await expect(frame.getByTestId("cap-claim").first().locator("svg[data-icon=claim]")).toHaveCount(1);

  // The web check waits beside its claim (after the one consent question).
  const first = frame.locator('[data-testid="cap-check"][data-claim]').nth(3);
  await first.getByTestId("cap-check-btn").click();
  await showPart(frame, "cap-check-agree"); // r5-02: its part of More
  await frame.getByTestId("cap-check-agree").first().click();
  await expect(frame.getByTestId("cap-check-waiting").first()).toBeVisible();
  await expect(frame.getByTestId("cap-check-waiting").first()).toContainText("Checking...");
  await expect(frame.getByTestId("cap-check-verdict").first()).toBeVisible({ timeout: 20_000 });
});

test("waiting: Ask this page waits in the shape of an answer, then answers", async ({ distill }) => {
  const tab = await distill.openTab("caption-ask");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeModel(distill.worker, { delayMs: 2500 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await openMore(frame, "cap-ask");
  await showPart(frame, "cap-ask-input"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-input").fill("When does the library open on Saturdays?");
  await showPart(frame, "cap-ask-go"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-go").click();
  await expect(frame.getByTestId("cap-ask")).toHaveAttribute("data-phase", "asking");
  await expect(frame.getByTestId("cap-ask-waiting")).toContainText("Reading the page on this device...");
  await expect(frame.getByTestId("cap-ask-waiting").locator(".k-wait-bar")).toHaveCount(2);
  await expect(frame.getByTestId("cap-ask-answer")).toBeVisible({ timeout: 15_000 });
  await expect(frame.getByTestId("cap-ask-waiting")).toHaveCount(0);
});

test("failed: the gist and the claims say why in one line, and Try again works once the AI answers", async ({ distill }) => {
  const tab = await distill.openTab("caption-claims");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await fakeModel(distill.worker, { fail: "busy" });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await openMore(frame);

  const gist = frame.getByTestId("cap-gist");
  const claims = frame.getByTestId("cap-claims");
  await expect(gist).toHaveAttribute("data-phase", "failed", { timeout: 10_000 });
  await expect(frame.getByTestId("cap-gist-failed")).toHaveText(/^No gist: the AI is busy right now\.Try again$/);
  await expect(claims).toHaveAttribute("data-phase", "failed");
  await expect(frame.getByTestId("cap-claims-failed")).toContainText("Not looked for: the AI is busy right now.");
  await expect(frame.getByTestId("cap-status")).toHaveText(/^Removed \d+ distractions$/);
  await shot(page, "r5-09-failed");

  // The AI answers again: Try again brings the gist, then the claims (underlined and counted).
  await fakeModel(distill.worker, {});
  await showPart(frame, "cap-gist-retry");
  await frame.getByTestId("cap-gist-retry").click();
  await expect(gist).toHaveAttribute("data-phase", "ready", { timeout: 10_000 });
  await expect(frame.getByTestId("cap-gist-point")).toHaveCount(3);
  await showPart(frame, "cap-claims-retry");
  await frame.getByTestId("cap-claims-retry").click();
  await expect(claims).toHaveAttribute("data-phase", "ready", { timeout: 10_000 });
  await expect(frame.getByTestId("cap-claim")).toHaveCount(6);
  await expect(frame.getByTestId("cap-status")).toHaveText(/· 6 claims to check$/);
  expect(await page.evaluate(() => (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("distill-claim")?.size ?? 0)).toBe(6);
});

test("failed: Ask says why and asks again with Try again; a missing model offers no Try again", async ({ distill }) => {
  const tab = await distill.openTab("caption-ask");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeModel(distill.worker, { fail: "busy" });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await openMore(frame, "cap-ask");
  await showPart(frame, "cap-ask-input"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-input").fill("When does the library open on Saturdays?");
  await showPart(frame, "cap-ask-go"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-go").click();
  await expect(frame.getByTestId("cap-ask-failed")).toContainText("No answer: the AI is busy right now.", { timeout: 10_000 });
  await fakeModel(distill.worker, {});
  await showPart(frame, "cap-ask-retry"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-retry").click();
  await expect(frame.getByTestId("cap-ask-answer")).toBeVisible({ timeout: 10_000 });

  // A model that is not there: trying again cannot help, so there is no Try again.
  await fakeModel(distill.worker, { fail: "device" });
  await showPart(frame, "cap-ask-go"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-go").click();
  await expect(frame.getByTestId("cap-ask-failed")).toBeVisible({ timeout: 10_000 });
  await expect(frame.getByTestId("cap-ask-retry")).toHaveCount(0);
});

test("failed: Translate says why in the status line, and Try again in the row translates", async ({ distill }) => {
  const tab = await distill.openTab("caption-translate");
  await tab.page.setViewportSize({ width: 1280, height: 800 });
  await fakeModel(distill.worker, { fail: "busy" });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  const status = frame.getByTestId("cap-status");
  await expect(status).toContainText("Not translated: the AI is busy right now", { timeout: 15_000 });
  const again = frame.getByTestId("cap-translate-retry");
  await expect(again).toBeVisible();
  await fakeModel(distill.worker, {});
  await again.click();
  await expect(status).toContainText("Translated from Czech", { timeout: 15_000 });
  await expect(again).toHaveCount(0);
});

test("reduced motion: the waiting placeholder holds still; with motion welcome it breathes", async ({ distill }) => {
  const tab = await distill.openTab("caption-claims");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fakeModel(distill.worker, { delayMs: 4000 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await openMore(frame, "cap-gist");
  const bar = frame.getByTestId("cap-gist-waiting").locator(".k-wait-bar").first();
  await expect(bar).toBeVisible();
  expect(await bar.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await bar.evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
  // More's own slide-in does not run either.
  expect(await frame.getByTestId("cap-more").evaluate((e) => getComputedStyle(e).animationName)).toBe("none");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => bar.evaluate((e) => getComputedStyle(e).animationName)).toBe("k-breathe");
});
