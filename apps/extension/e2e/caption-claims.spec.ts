// Spark round 2: claims to check (r2-01) and the gist first (r2-10) on demo articles, in real Chromium, with the e2e
// build's stand-in model (it keeps the first six candidates the engine offers, and makes the gist from the first
// sentence of the first three blocks). What is checked is the mechanism: the marks (CSS highlights over the page's own
// text, nothing added to the DOM), the count in the status, Show me, Original, close, the translation swap, and that
// nothing is shown as a claim when no model can run.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

/** Screenshots for the spark board, outside the repo on purpose. */
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r2";

async function fakeModel(worker: Worker, opts: { fail?: string; source?: "on_device" | "in_cloud"; delayMs?: number } = {}) {
  await worker.evaluate(async (o) => { await chrome.storage.session.set({ "distill:e2e:fakeAi": o }); }, opts);
}

const exactly = (page: Page) => page.locator("article").evaluate((el) => el.innerHTML.replace(/ style=""/g, ""));
const article = async (page: Page) => (await exactly(page)).replace(/\s(data-distill-[a-z-]+)(="[^"]*")?/g, "");

/** The claim marks on the page: ranges in the CSS highlight registry (the document's own, shared by every world). */
const marks = (page: Page) => page.evaluate(() => {
  const reg = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
  const h = reg?.get("distill-claim");
  return { ranges: h ? h.size : 0, texts: h ? Array.from(h).map((r) => r.toString()) : [], show: reg?.has("distill-show") ?? false };
});

const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `caption-claims-${name}.png`) });
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 82 });
  } catch { /* the evidence folder is a convenience of the owner's machine */ }
};

async function openMore(frame: Frame) {
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
}

test("claims and gist: an English article gets its claims underlined, counted, listed with Show me, and its gist first", async ({ distill }) => {
  const tab = await distill.openTab("caption-claims");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 760 });
  const before = await article(page);
  const exact = await exactly(page);
  await fakeModel(distill.worker);

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  const status = frame.getByTestId("cap-status");
  await expect(status).toHaveText(/^Removed \d+ distractions · 6 claims to check$/, { timeout: 15_000 });
  expect(await firstSight(frame)).toMatch(/· 6 claims to check$/);

  // Where it ran: the chip, from the run's own answer.
  const chip = frame.getByTestId("cap-chip");
  await expect(chip).toHaveText("On this device");
  await expect(chip).toHaveAttribute("data-src", "on_device");
  await expect(chip).toHaveAttribute("title", /claims to check ran on this device/);
  await expect(chip).toHaveAttribute("data-claims", /^6\/\d+$/);
  await expect(chip).toHaveAttribute("data-claims-marked", "6");

  // The marks: six ranges over the page's own sentences; the DOM keeps every element, link and word.
  const m = await marks(page);
  expect(m.ranges).toBe(6);
  expect(m.texts).toContain("Councillors approved the plan by 31 votes to 12 after a debate that lasted almost five hours.");
  expect(m.texts.some((t) => t.startsWith("According to a study by the Harbour City Transport Institute"))).toBe(true);
  expect(m.texts.some((t) => t.startsWith("\"This is the most important decision"))).toBe(true);
  expect(await page.locator("[data-distill-claim]").count()).toBeGreaterThanOrEqual(4);
  expect(await article(page)).toBe(before);
  await expect(page.locator("#budget-link")).toHaveAttribute("href", "https://example.org/tram-budget");
  await expect(page.locator("#budget-link")).toHaveText("The full budget");
  // A question and a plain sentence are not claims.
  expect(m.texts.some((t) => t.startsWith("Will the trams"))).toBe(false);
  await page.evaluate(() => document.querySelector("article p:nth-of-type(3)")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  await shot(page, "r2-01-demo");
  await page.evaluate(() => scrollTo(0, 0));

  // More opens with the gist: three points, each from a sentence of the article, and where it was written.
  await openMore(frame);
  const gist = frame.getByTestId("cap-gist");
  await expect(gist).toHaveAttribute("data-phase", "ready");
  await expect(frame.getByTestId("cap-gist-point")).toHaveCount(3);
  // r3-01: the gist starts from the article's first paragraph; the headline is the page's title, not a paragraph.
  await expect(frame.getByTestId("cap-gist-point").first()).toContainText("[GIST] The city council voted on Tuesday to build a tram line");
  await expect(gist).not.toContainText("Riverside tram line approved");
  await expect(frame.getByTestId("cap-gist-where")).toContainText("Written on this device");
  // The gist is the first thing in More.
  expect(await frame.locator("#cap-more > *").first().getAttribute("data-testid")).toBe("cap-gist");

  // Show me on the gist's third point: the page scrolls to it and highlights the sentence a moment.
  await frame.getByTestId("cap-gist-show").nth(2).click();
  await expect.poll(async () => (await marks(page)).show).toBe(true);
  await page.waitForTimeout(600);
  await shot(page, "r2-10-demo");

  // The claims in More: six, each with its reason and Show me.
  const claims = frame.getByTestId("cap-claims");
  await expect(claims).toHaveAttribute("data-phase", "ready");
  await expect(frame.getByTestId("cap-claim")).toHaveCount(6);
  await expect(frame.getByTestId("cap-claims-where")).toContainText("Found on this device");
  await expect(frame.getByTestId("cap-claim").nth(5)).toHaveAttribute("data-why", "quote");
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(2600); // the gist's highlight goes
  expect((await marks(page)).show).toBe(false);
  await frame.getByTestId("cap-claim-show").nth(5).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  await expect.poll(async () => (await marks(page)).show).toBe(true);
  const shown = await page.evaluate(() => {
    const r = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("distill-show");
    const range = r ? Array.from(r)[0] : null;
    if (!range) return null;
    const box = range.getBoundingClientRect();
    return { text: range.toString(), top: box.top, bottom: box.bottom, h: innerHeight };
  });
  expect(shown?.text).toMatch(/^"This is the most important decision/);
  expect(shown && shown.top >= 0 && shown.bottom <= shown.h * 0.55).toBe(true); // above the strip with More open
  await shot(page, "r2-01-demo-more");

  // Original: no marks; Back to Distill: the marks again.
  await frame.getByTestId("cap-original").click();
  await expect(frame.getByTestId("cap-back")).toBeVisible();
  await expect.poll(async () => (await marks(page)).ranges).toBe(0);
  expect(await article(page)).toBe(before);
  await frame.getByTestId("cap-back").click();
  await expect.poll(async () => (await marks(page)).ranges).toBe(6);

  // Close: nothing left behind, to the byte.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(page.locator("distill-caption")).toHaveCount(0);
  expect(await exactly(page)).toBe(exact);
  expect((await marks(page)).ranges).toBe(0);
  await expect(page.locator("[data-distill-claim], #distill-claims-style")).toHaveCount(0);
});

test("claims: the marks follow a translation in and out (Keep Czech, Show English)", async ({ distill }) => {
  const tab = await distill.openTab("caption-translate");
  const page = tab.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await fakeModel(distill.worker);
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(page);
  const status = frame.getByTestId("cap-status");
  // Claims wait for the translation, and are found in the words the person sees.
  // The page asks for comments by 15 January (r3-09): one thing to do.
  await expect(status).toHaveText(/^Removed \d+ distractions · Translated from Czech · \d+ claims? to check · 1 thing to do$/, { timeout: 15_000 });
  const n = Number(/(\d+) claims? to check/.exec((await status.textContent()) ?? "")?.[1]);
  expect(n).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await marks(page)).ranges).toBe(n);
  // r3-07 writes the page's dates your way just after the translation lands: splitting a text node moves a mark's
  // range for a moment, and the marks are found again 120 ms later (caption/textSplit.ts). Read them once they hold.
  let translated = (await marks(page)).texts;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(400);
    const now = (await marks(page)).texts;
    if (now.join("|") === translated.join("|")) break;
    translated = now;
  }
  // The chip still says where the translation ran, and names the claims in its title.
  await expect(frame.getByTestId("cap-chip")).toHaveAttribute("title", /translation from Czech ran on this device.*claims to check ran on this device/);

  // Keep Czech: Translate swaps the words back; a sentence that is the same in both (the stand-in only prefixes the
  // first sentence of a block with "[EN] ") keeps its mark, the rest are not on the page and are not marked.
  await frame.getByTestId("cap-keep-source").click();
  await expect(frame.getByTestId("cap-keep-source")).toHaveText("Show English");
  // (A range over a swapped text node collapses at once; the marks are found again a moment later.)
  const same = translated.filter((t) => !t.startsWith("[EN]"));
  await expect.poll(async () => (await marks(page)).texts.join("|")).toBe(same.join("|"));
  expect(same.length).toBeLessThan(n);
  // Show English: every mark again.
  await frame.getByTestId("cap-keep-source").click();
  await expect.poll(async () => (await marks(page)).ranges).toBe(n);
  expect((await marks(page)).texts).toEqual(translated);
  // The translation itself is untouched by the marks: links and their words survive.
  await expect(page.locator("#timetable-link")).toHaveAttribute("href", "https://example.org/jizdni-rady");
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect((await marks(page)).ranges).toBe(0);
  await expect(page.locator("[data-distill-translated], [data-distill-claim]")).toHaveCount(0);
});

test("claims: with no model nothing is shown as a claim, and More says why; no gist", async ({ distill }) => {
  // No stand-in model: the e2e build's AI is off. The engine still finds candidates, but they are not claims.
  const tab = await distill.openTab("caption-claims");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  expect(await firstSight(frame)).toMatch(/^Removed \d+ distractions$/);
  await expect(frame.getByTestId("cap-chip")).toHaveAttribute("data-claims-phase", "none", { timeout: 10_000 });
  await expect(frame.getByTestId("cap-status")).toHaveText(/^Removed \d+ distractions$/);
  await expect(frame.getByTestId("cap-chip")).toHaveText("No AI used");
  expect((await marks(tab.page)).ranges).toBe(0);
  await expect(tab.page.locator("[data-distill-claim]")).toHaveCount(0);
  await openMore(frame);
  await expect(frame.getByTestId("cap-claims")).toContainText("needs an AI model, and none can run here");
  await expect(frame.getByTestId("cap-claim")).toHaveCount(0);
  await expect(frame.getByTestId("cap-gist")).toHaveCount(0);
});

test("claims: the phone status keeps to two lines with the count", async ({ distill }) => {
  const tab = await distill.openTab("caption-claims");
  await tab.page.setViewportSize({ width: 390, height: 844 });
  await fakeModel(distill.worker);
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  const status = frame.getByTestId("cap-status");
  await expect(status).toHaveText(/6 claims to check$/, { timeout: 15_000 });
  const lines = await status.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBeLessThanOrEqual(2);
  await shot(tab.page, "r2-01-demo-390");
});
