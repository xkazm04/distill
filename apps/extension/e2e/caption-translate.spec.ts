// Translate in place (#10, docs/caption.md slice 2) on a Czech demo page, in real Chromium. The e2e build has no model:
// each test switches the dev fake model on for the session first (it answers every block as "[EN] " + the block), so
// what is checked is the mechanism: which text is replaced, what survives, and that the page's own words come back.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
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
  // The claims to check (r2-01) follow the translation and may already be on the line.
  expect(await firstSight(frame)).toMatch(/^Removed \d+ distractions · Translated from Czech( · \d+ claims? to check)?$/);

  // Where it ran, from the run's own answer; one quiet button; at most 5 controls.
  const chip = frame.getByTestId("cap-chip");
  await expect(chip).toHaveText("On this device");
  await expect(chip).toHaveAttribute("data-src", "on_device");
  await expect(chip).toHaveAttribute("title", /translation from Czech ran on this device/);
  await expect(frame.getByTestId("cap-keep-source")).toHaveText("Keep Czech");
  await expect(frame.getByRole("button")).toHaveCount(4); // Keep Czech, Plain (r2-04), More, Original

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
  // (The stand-in model is on, so the claims to check (r2-01) may join the line and the chip: Translate stays idle.)
  expect(await firstSight(enFrame)).toMatch(/^Removed 6 distractions( · \d+ claims? to check)?$/);
  await en.page.waitForTimeout(500);
  await expect(en.page.locator("[data-distill-translated]")).toHaveCount(0);
  await expect(enFrame.getByTestId("cap-chip")).toHaveAttribute("data-translate", "idle");
  await expect(enFrame.getByTestId("cap-status")).not.toContainText("Translat");
});

/** Counts what the page side tells the frames (distill:caption:moreText reaches the service worker too). */
async function listenMoreText(worker: Worker) {
  await worker.evaluate(() => {
    const g = globalThis as { __moreText?: unknown[] };
    g.__moreText = [];
    chrome.runtime.onMessage.addListener((m: { type?: string }) => { if (m?.type === "distill:caption:moreText") g.__moreText?.push(m); });
  });
  return () => worker.evaluate(() => ((globalThis as { __moreText?: unknown[] }).__moreText ?? []) as Record<string, unknown>[]);
}

test("translate: text the page adds or rewrites later is translated too; Keep Czech and Original keep working; no loop", async ({ distill }) => {
  const tab = await distill.openTab("caption-translate-more");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const page = tab.page;
  await fakeModel(distill.worker);
  const heard = await listenMoreText(distill.worker);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  const chip = frame.getByTestId("cap-chip");
  await expect(frame.getByTestId("cap-status")).toContainText("Translated from Czech", { timeout: 15_000 });
  await expect(page.locator("h1")).toHaveText(/^\[EN\] Uzavírka mostu/);
  const first = await chip.getAttribute("data-blocks");

  // "Load more": two new paragraphs in the main column.
  await page.click("#nacist");
  await expect(page.locator("#dalsi p")).toHaveCount(2);
  for (const p of await page.locator("#dalsi p").all()) await expect(p).toHaveText(/^\[EN\] /, { timeout: 8_000 });
  await expect(page.locator("#dalsi p").first()).toHaveAttribute("lang", "en");
  await expect(chip).not.toHaveAttribute("data-blocks", first ?? "");
  // The frame heard a count, never the words.
  const told = await heard();
  expect(told.length).toBeGreaterThanOrEqual(1);
  for (const m of told) expect(Object.keys(m).sort()).toEqual(["count", "tabId", "type"]);
  expect(told[0]).toMatchObject({ tabId: tab.id, count: 2 });

  // The page rewrites a line it translated: the new words are translated, and Keep Czech shows the new ones.
  await expect(page.locator("#stav")).toHaveText(/^\[EN\] Stav k 8:00/);
  await page.evaluate(() => (window as unknown as { updateStatus(): void }).updateStatus());
  await expect(page.locator("#stav")).toHaveText("[EN] Stav k 9:00: na objížďce se tvoří kolona, počítejte se zdržením.", { timeout: 8_000 });
  await shot(page, "more-translated");
  await frame.getByTestId("cap-keep-source").click();
  await expect(page.locator("#stav")).toHaveText("Stav k 9:00: na objížďce se tvoří kolona, počítejte se zdržením.");
  await expect(page.locator("#dalsi p").first()).toHaveText(/^Řidiči nákladních aut/);
  await expect(page.locator("h1")).toHaveText(/^Uzavírka mostu/);
  await frame.getByTestId("cap-keep-source").click();
  await expect(page.locator("#stav")).toHaveText(/^\[EN\] Stav k 9:00/);

  // The comments Clean removed, brought back from More: translated too.
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByRole("button", { name: "Show Comments again" }).click();
  await frame.getByTestId("cap-more-btn").click();
  await expect(page.locator("#komentare")).toBeVisible();
  await expect(page.locator("#komentare .comment div").first()).toHaveText(/^\[EN\] Díky za včasnou/, { timeout: 8_000 });

  // A single-page app's next view: the article is replaced in place.
  await page.click("#dalsi-clanek");
  await expect(page.locator("h1")).toHaveText("[EN] Sběr nebezpečného odpadu bude v sobotu na návsi", { timeout: 8_000 });
  for (const p of await page.locator("#clanek p").all()) await expect(p).toHaveText(/^\[EN\] /, { timeout: 8_000 });
  await shot(page, "next-view");

  // Original: every word the page has now is its own.
  await frame.getByTestId("cap-original").click();
  await expect(frame.getByTestId("cap-back")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("[EN]");
  await expect(page.locator("h1")).toHaveText("Sběr nebezpečného odpadu bude v sobotu na návsi");
  await frame.getByTestId("cap-back").click();
  await expect(page.locator("h1")).toHaveText(/^\[EN\] /);

  // Never loops: with the page quiet, nothing more is heard and the counts stand still.
  await page.waitForTimeout(1500);
  const quietCount = (await heard()).length;
  const quietBlocks = await chip.getAttribute("data-blocks");
  await page.waitForTimeout(3000);
  expect((await heard()).length).toBe(quietCount);
  await expect(chip).toHaveAttribute("data-blocks", quietBlocks ?? "");
  expect(quietCount).toBeLessThanOrEqual(6);

  // Close: nothing of Distill's left, the page's latest words in place.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await page.locator("body").innerText()).not.toContain("[EN]");
  expect(await page.locator("[data-distill-translated]").count()).toBe(0);
});

/** How many offscreen documents Distill has open now. */
const offscreenDocs = (worker: Worker) => worker.evaluate(async () =>
  (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType] })).length);
const policyAllows = (target: Page | Frame) => target.evaluate(() =>
  (document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy?.allowsFeature("language-model") ?? null);

test("translate: a site that forbids the on-device model in frames is translated through Distill's offscreen document", async ({ distill }) => {
  await fakeModel(distill.worker);

  // The control: a page with no such policy translates in the frame itself, and no offscreen document opens.
  const plain = await distill.openTab("caption-translate");
  await startCaption(distill.worker, plain.id);
  const plainFrame = await captionFrame(plain.page);
  expect(await policyAllows(plainFrame)).toBe(true);
  await expect(plainFrame.getByTestId("cap-status")).toContainText("Translated from Czech", { timeout: 15_000 });
  await expect(plainFrame.getByTestId("cap-chip")).not.toHaveAttribute("data-via", /./);
  expect(await offscreenDocs(distill.worker)).toBe(0);
  expect(await startCaption(distill.worker, plain.id)).toBe(false);

  // The site sends Permissions-Policy: language-model=(): denied to the page and to the caption frame in it.
  const tab = await distill.openTab("caption-translate-blocked");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const page = tab.page;
  distill.tab = page;
  expect(await policyAllows(page)).toBe(false);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  expect(await policyAllows(frame)).toBe(false);

  await expect(frame.getByTestId("cap-status")).toContainText("Translated from Czech", { timeout: 15_000 });
  await expect(page.locator("h1")).toHaveText("[EN] Poplatek za odpad na rok 2027 zůstává stejný");
  for (const li of await page.locator("article li").all()) await expect(li).toHaveText(/^\[EN\] /);
  // The chip says where it ran, from the run's own answer, and why it went through the offscreen document.
  const chip = frame.getByTestId("cap-chip");
  await expect(chip).toHaveText("On this device");
  await expect(chip).toHaveAttribute("data-src", "on_device");
  await expect(chip).toHaveAttribute("data-via", "offscreen");
  await expect(chip).toHaveAttribute("title", /translation from Czech ran on this device/);
  await expect(chip).toHaveAttribute("title", /in Distill's offscreen document/); // the stand-in model's reason, from there
  await expect(chip).toHaveAttribute("title", /blocks on-device AI inside frames, so Distill ran it in a hidden page of its own/);
  expect(await offscreenDocs(distill.worker)).toBe(1);
  await shot(page, "offscreen");

  // Keep Czech works as anywhere.
  await frame.getByTestId("cap-keep-source").click();
  await expect(page.locator("h1")).toHaveText("Poplatek za odpad na rok 2027 zůstává stejný");
  await frame.getByTestId("cap-keep-source").click();

  // Closing Distill on the page closes the offscreen document: no caption needs it any more.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect.poll(() => offscreenDocs(distill.worker), { timeout: 5_000 }).toBe(0);
  expect(await page.locator("body").innerText()).not.toContain("[EN]");
});
