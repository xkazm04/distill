// Translate in place (#10, docs/caption.md slice 2) on a Czech demo page, in real Chromium. The e2e build has no model:
// each test switches the dev fake model on for the session first (it answers every block as "[EN] " + the block), so
// what is checked is the mechanism: which text is replaced, what survives, and that the page's own words come back.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Worker } from "playwright/test";
import { BAR, baseline, captionFrame, firstSight, measure, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

/** caption/frame/Translate.tsx E2E_FAKE_AI_KEY: the fake model's switch, read by the e2e build only. */
async function fakeModel(worker: Worker, opts: { fail?: string; source?: "on_device" | "in_cloud"; delayMs?: number } = {}) {
  await worker.evaluate(async (o) => { await chrome.storage.session.set({ "distill:e2e:fakeAi": o }); }, opts);
}

/** The article's markup. Playwright's screenshot leaves an empty style attribute on text fields (it hides the caret);
 *  that is the test's, not Distill's, so it is left out. */
const exactly = (page: Page) => page.locator("article").evaluate((el) => el.innerHTML.replace(/ style=""/g, ""));
/** The same, without the marks Distill's other features and the tests put on elements. */
const article = async (page: Page) => (await exactly(page)).replace(/\s(data-distill-[a-z-]+|data-e2e-[a-z0-9-]+)(="[^"]*")?/g, "");

const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `caption-translate-${name}.png`) });
};

test("translate: a Czech page is translated in place on its own; Keep Czech, Original and close bring back every word", async ({ distill }) => {
  const tab = await distill.openTab("caption-translate");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const base = await baseline(tab.page);
  await tab.page.fill("#jmeno", "Zkouška Hodnoty");
  await tab.page.fill("#pripominka", "Moje připomínka 4711");
  const before = await article(tab.page);
  const exact = await exactly(tab.page);
  await fakeModel(distill.worker, { delayMs: 800 });

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  const status = frame.getByTestId("cap-status");
  await expect(status).toContainText("Translating from Czech...");
  await expect(frame.getByTestId("cap-chip")).toHaveText("No AI used");
  await expect(frame.getByTestId("cap-keep-source")).toHaveCount(0); // while translating, the status says it; no button
  await expect(status).toContainText("Translated from Czech", { timeout: 15_000 });
  expect(await firstSight(frame)).toMatch(/^Removed \d+ distractions · Translated from Czech$/);

  // Where it ran, from the run's own answer; one quiet button; at most 5 controls.
  const chip = frame.getByTestId("cap-chip");
  await expect(chip).toHaveText("On this device");
  await expect(chip).toHaveAttribute("data-src", "on_device");
  await expect(chip).toHaveAttribute("title", /translation from Czech ran on this device/);
  await expect(frame.getByTestId("cap-keep-source")).toHaveText("Keep Czech");
  await expect(frame.getByRole("button")).toHaveCount(3); // Keep Czech, More, Original

  // The text is replaced block by block; links, bold, list items and table cells survive with their words.
  const page = tab.page;
  await expect(page.locator("h1")).toHaveText("[EN] Nové autobusové linky od 1. března");
  await expect(page.locator("h1")).toHaveAttribute("lang", "en");
  await expect(page.locator("#timetable-link")).toHaveAttribute("href", "https://example.org/jizdni-rady");
  await expect(page.locator("#timetable-link")).toHaveText(/\S/);
  await expect(page.locator("article p b")).toHaveText(/\S/);
  await expect(page.locator("article li")).toHaveCount(3);
  for (const li of await page.locator("article li").all()) await expect(li).toHaveText(/^\[EN\] /);
  await expect(page.locator("article caption")).toHaveText("[EN] První ranní spoje");
  await expect(page.locator("article td").nth(2)).toHaveText("[EN] Nemocnice");
  await expect(page.locator("article td").first()).toHaveText("14"); // numbers only: not sent
  const translated = await page.locator("[data-distill-translated]").count();
  expect(translated).toBeGreaterThanOrEqual(12);

  // The form is never touched: its words, its fields and what the person typed stay as they are.
  await expect(page.locator("#comment p")).toHaveText("Napište nám připomínku");
  await expect(page.locator("label[for=jmeno]")).toHaveText("Jméno");
  await expect(page.locator("#jmeno")).toHaveValue("Zkouška Hodnoty");
  await expect(page.locator("#pripominka")).toHaveValue("Moje připomínka 4711");
  expect(await page.locator("article").innerHTML()).not.toContain("[EN] Zkouška");

  // The strip still meets the bar.
  const m = await measure(page, base);
  expect(m.strip.share).toBeLessThanOrEqual(BAR.shareDesktop);
  expect(m.strip.onTop).toBe(true);
  expect(m.h1Kept).toBe(true);
  expect(m.contentKept).toBe(1);
  await shot(page, "translated");

  // Keep Czech: the page's own words, exactly as they were; Show English brings the translation back.
  await frame.getByTestId("cap-keep-source").click();
  await expect(frame.getByTestId("cap-keep-source")).toHaveText("Show English");
  expect(await article(page)).toBe(before);
  await expect(page.locator("h1")).not.toHaveAttribute("lang", /./);
  await shot(page, "keep-czech");
  await frame.getByTestId("cap-keep-source").click();
  await expect(page.locator("h1")).toHaveText("[EN] Nové autobusové linky od 1. března");

  // Original: the untouched page, the Czech words included; Back to Distill shows the translation again.
  await frame.getByTestId("cap-original").click();
  await expect(frame.getByTestId("cap-back")).toBeVisible();
  expect(await article(page)).toBe(before);
  await frame.getByTestId("cap-back").click();
  await expect(page.locator("h1")).toHaveText("[EN] Nové autobusové linky od 1. března");
  await expect(frame.getByTestId("cap-keep-source")).toHaveText("Keep Czech");

  // Close: nothing left behind, to the byte.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(page.locator("distill-caption")).toHaveCount(0);
  expect(await exactly(page)).toBe(exact);
  expect(await page.locator("[data-distill-translated], [lang=en]").count()).toBe(0);
  await expect(page.locator("#pripominka")).toHaveValue("Moje připomínka 4711");
});

test("translate: the chip says In the cloud when the run says so", async ({ distill }) => {
  const tab = await distill.openTab("caption-translate");
  await fakeModel(distill.worker, { source: "in_cloud" });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await expect(frame.getByTestId("cap-status")).toContainText("Translated from Czech", { timeout: 15_000 });
  const chip = frame.getByTestId("cap-chip");
  await expect(chip).toHaveText("In the cloud");
  await expect(chip).toHaveAttribute("data-src", "in_cloud");
  await expect(chip).toHaveAttribute("title", /ran in the cloud \(the page's text was sent, nothing of yours\)/);
});

test("translate: with no model the status says why, and the page stays as it was", async ({ distill }) => {
  const tab = await distill.openTab("caption-translate");
  await tab.page.setViewportSize({ width: 390, height: 844 });
  const before = await article(tab.page);
  await fakeModel(distill.worker, { fail: "device" });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await expect(frame.getByTestId("cap-status")).toContainText("Not translated: the AI model on this device is not ready", { timeout: 15_000 });
  await expect(frame.getByTestId("cap-chip")).toHaveText("No AI used");
  await expect(frame.getByTestId("cap-keep-source")).toHaveCount(0);
  expect(await article(tab.page)).toBe(before);
  await expect(tab.page.locator("[data-distill-translated]")).toHaveCount(0);
  const m = await measure(tab.page, await baseline(tab.page));
  expect(m.strip.share).toBeLessThanOrEqual(BAR.sharePhone);
  await shot(tab.page, "failed-390");
});

test("translate: a page in the reader's language and a copy with AI off do not start it", async ({ distill }) => {
  // No fake model: the e2e build's AI is off, so Translate does not start and the strip keeps "Page in Czech".
  const tab = await distill.openTab("caption-translate");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  expect(await firstSight(frame)).toMatch(/· Page in Czech$/);
  await tab.page.waitForTimeout(500);
  await expect(frame.getByTestId("cap-status")).toHaveText(/· Page in Czech$/);
  await expect(tab.page.locator("[data-distill-translated]")).toHaveCount(0);

  const en = await distill.openTab("article");
  await fakeModel(distill.worker);
  await startCaption(distill.worker, en.id);
  const enFrame = await captionFrame(en.page);
  expect(await firstSight(enFrame)).toBe("Removed 6 distractions");
  await en.page.waitForTimeout(500);
  await expect(en.page.locator("[data-distill-translated]")).toHaveCount(0);
  await expect(enFrame.getByTestId("cap-chip")).toHaveText("No AI used");
});
