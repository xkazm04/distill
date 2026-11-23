// Spark round 3: who wrote this and when (r3-05) and what this page asks of you (r3-09), on the demo page
// caption-actions.html (a village's notice about the waste fee: JSON-LD byline with a meta tag that must lose to it, a
// payment with its account and deadline, things to bring, a deadline, office hours, a phone and an e-mail, and a form
// field the person typed a phone number into). No model: both cards are patterns only. Real sites:
// live/probes/byline-actions.live.ts.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};

/** The action highlights on the page: ranges in the document's CSS highlight registry. */
const highlights = (page: Page) => page.evaluate(() => {
  const reg = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
  const h = reg?.get("distill-action");
  return { ranges: h ? h.size : 0, texts: h ? Array.from(h).map((r) => r.toString()) : [], show: reg?.has("distill-action-show") ?? false };
});
const article = (page: Page) => page.locator("article").evaluate((el) => el.innerHTML.replace(/\s(data-distill-[a-z-]+)(="[^"]*")?/g, "").replace(/ style=""/g, ""));

const TYPED = "602 999 888";

test("byline and actions: the strip says when and how much there is to do; More lists both; highlights, Show me, Copy, Original, close", async ({ distill }) => {
  const tab = await distill.openTab("caption-actions");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator("#tel").fill(TYPED);
  const before = await article(page);

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  const status = frame.getByTestId("cap-status");
  // r3-05: the published and updated dates differ by years: the strip says so. r3-09: seven things to do.
  await expect(status).toHaveText(/ · Published (?:a year|\d+ years) ago, updated yesterday · 7 things to do$/, { timeout: 10_000 });
  // Clean used no AI, and neither card does: the chip still says so.
  await expect(frame.getByTestId("cap-chip")).toHaveText("No AI used");

  // The light highlights: ranges over the page's own words, no element added.
  await expect.poll(async () => (await highlights(page)).ranges).toBe(7);
  const h = await highlights(page);
  expect(h.texts).toContain("Poplatek ve výši 800 Kč za osobu uhraďte převodem na účet 123456789/0100, variabilní symbol je číslo popisné, nejpozději do 31. 3. 2027.");
  expect(h.texts).toContain("377 912 345");
  expect(h.texts).toContain("poplatky@lipova-lhota.example");
  expect(h.texts.join(" ")).not.toContain(TYPED);
  expect(await article(page)).toBe(before);
  await expect(page.locator("#tel")).toHaveValue(TYPED);
  await expect(page.locator("[data-distill-action]")).toHaveCount(4); // the blocks #pay, #cash, #relief, #office

  // More: the byline from the structured data (the meta tag's 2001 date and author lose to it).
  await frame.getByTestId("cap-more-btn").click();
  const byline = frame.getByTestId("cap-byline");
  await expect(byline).toHaveAttribute("data-from", "data");
  await expect(frame.getByTestId("cap-byline-published")).toContainText(/10 January 2023, 09:00 \((?:a year|\d+ years) ago\)/);
  await expect(frame.getByTestId("cap-byline-updated")).toContainText("(yesterday)");
  await expect(frame.getByTestId("cap-byline-author")).toContainText("Marie Svobodová");
  await expect(frame.getByTestId("cap-byline-publisher")).toContainText("Obecní úřad Lipová Lhota");
  await expect(byline).not.toContainText("2001");
  await expect(byline).not.toContainText("Meta-Autorová");

  // The list, in reading order, each in the page's words with a few English ones.
  const items = frame.getByTestId("cap-action");
  await expect(items).toHaveCount(7);
  expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")))).toEqual(["payment", "bring", "deadline", "bring", "hours", "contact", "contact"]);
  const texts = await frame.getByTestId("cap-action-text").allTextContents();
  expect(texts).toEqual([
    "Pay 800 Kč to 123456789/0100 by 31. 3. 2027",
    "Bring: občanský průkaz a doklad o zaplacení za loňský rok",
    "By 28. 2. 2027",
    "Provide: potvrzení o studiu nebo o pobytu mimo obec",
    "Hours: Po, St 8:00 - 17:00",
    "Call 377 912 345",
    "Write to poplatky@lipova-lhota.example",
  ]);
  for (const t of texts) expect(t).not.toContain(TYPED);
  await expect(items.nth(5).getByTestId("cap-action-call")).toHaveAttribute("href", "tel:+420377912345");
  await expect(items.nth(6).getByTestId("cap-action-write")).toHaveAttribute("href", "mailto:poplatky@lipova-lhota.example");
  await expect(items.nth(2).getByTestId("cap-action-quote")).toHaveText("Kdo žádá o osvobození od poplatku, musí žádost podat do 28. 2. 2027.");

  // Show me: scrolls to the words and flashes them.
  await page.evaluate(() => scrollTo(0, 0));
  await items.nth(3).getByTestId("cap-action-show").click();
  await expect.poll(async () => (await highlights(page)).show).toBe(true);
  await shot(page, "r3-09-demo");
  // Copy: the account number, not the sentence.
  await items.nth(0).getByTestId("cap-action-copy").click();
  await expect(items.nth(0).getByTestId("cap-action-copy")).toHaveText("Copied");

  // Original: no highlight; Back to Distill: all again.
  await frame.getByTestId("cap-original").click();
  await expect.poll(async () => (await highlights(page)).ranges).toBe(0);
  await frame.getByTestId("cap-back").click();
  await expect.poll(async () => (await highlights(page)).ranges).toBe(7);

  // Close: nothing of the highlights is left.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect.poll(async () => (await highlights(page)).ranges).toBe(0);
  await expect(page.locator("[data-distill-action], #distill-actions-style")).toHaveCount(0);
  expect(await article(page)).toBe(before);
});

test("byline and actions: a news article without a date says so in More only, and asks nothing of the reader", async ({ distill }) => {
  const tab = await distill.openTab("caption-claims");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await tab.page.waitForTimeout(800);
  await expect(frame.getByTestId("cap-status")).not.toHaveText(/things? to do|Published/);
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-byline-nodate")).toHaveText("No date on this page.");
  await expect(frame.getByTestId("cap-actions")).toHaveCount(0);
  expect((await highlights(tab.page)).ranges).toBe(0);
});
