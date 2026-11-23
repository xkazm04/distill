// Plain words in place (r2-04) on a Czech official-style demo page, in real Chromium. The e2e build has no model: each
// test switches the stand-in model on for the session (it answers every block as "[PLAIN] " + the block, and drops the
// digits of a block that says "vynechá číslo"), so what is checked is the mechanism: which text is replaced, that the
// facts door refuses a rewrite that lost a number, and that every word of the page comes back.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { BAR, baseline, captionFrame, measure, settled, startCaption } from "./caption";
import { expect, test } from "./harness";

/** Evidence for the spark round (screenshots as JPG), outside the repo. */
const EVIDENCE = "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r2";

async function fakeModel(worker: Worker, opts: { fail?: string; source?: "on_device" | "in_cloud" } = {}) {
  await worker.evaluate(async (o) => { await chrome.storage.session.set({ "distill:e2e:fakeAi": o }); }, opts);
}

const exactly = (page: Page) => page.locator("article").evaluate((el) => el.innerHTML.replace(/ style=""/g, ""));
// r3-07: a price's or date's words wrapped by "in your terms" (its addition is ::after, never text) read as the page's own.
const unwrapTerms = (html: string) => html.replace(/<span data-distill-term="[a-z]+" data-distill-term-add="[^"]*" title="[^"]*">([^<]*)<\/span>/g, "$1");
const article = async (page: Page) => unwrapTerms(await exactly(page)).replace(/\s(data-distill-[a-z-]+|data-e2e-[a-z0-9-]+)(="[^"]*")?/g, "");

const evidence = async (page: Page, name: string) => {
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
  } catch { /* another machine: no evidence folder, the test itself still runs */ }
};

/** The strip's row fits its frame: no button cut off or pushed out sideways. */
const rowFits = (frame: Frame) => frame.getByTestId("cap-row").evaluate((row) => {
  const r = row.getBoundingClientRect();
  return row.scrollWidth <= row.clientWidth + 1 && Array.from(row.children).every((c) => {
    const b = c.getBoundingClientRect();
    return b.left >= r.left - 1 && b.right <= r.right + 1;
  });
});

const NUMBER_LOST = "Plain words · 1 part kept as written: a number would have changed";

test("plain: Plain rewrites the long blocks in place; a rewrite that loses a number is refused; As written, Original and close bring every word back", async ({ distill }) => {
  const tab = await distill.openTab("caption-plain");
  const page = tab.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  const base = await baseline(page);
  await page.fill("#jmeno", "Zkouška Hodnoty");
  await page.fill("#zprava", "Moje zpráva 4711");
  const before = await article(page);
  const exact = await exactly(page);
  // Translate cannot run here (its task fails), so Plain rewrites the page's own Czech words.
  await fakeModel(distill.worker, { fail: "device:translateBlocks" });

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  const status = frame.getByTestId("cap-status");
  await expect(status).toContainText("Not translated", { timeout: 15_000 });
  const plain = frame.getByTestId("cap-plain");
  await expect(plain).toHaveText("Plain");
  await expect(page.locator("[data-distill-plain]")).toHaveCount(0); // never by itself
  // The claims and the gist may have run by themselves (cards 1 and 10); nothing says plain words ran yet.
  await expect(frame.getByTestId("cap-chip")).not.toHaveAttribute("title", /plain words/i);

  await plain.click();
  await expect(status).toHaveText(new RegExp(`^${NUMBER_LOST} · `), { timeout: 15_000 });
  await expect(plain).toHaveText("As written");
  await expect(page.locator("#sazba")).toHaveText(/^\[PLAIN\] Na základě obecně závazné vyhlášky č\. 2\/2026/);
  await expect(page.locator("#sazba b")).toHaveText(/\S/); // the bold keeps words of its own
  await expect(page.locator("#splatnost")).toHaveText(/^\[PLAIN\] Poplatek je splatný/);
  await expect(page.locator("#ucet")).toHaveText(/^\[PLAIN\] /);
  await expect(page.locator("#pokladna")).toHaveText(/^\[PLAIN\] /);
  // The block whose rewrite lost its numbers stays exactly as written.
  await expect(page.locator("#osvobozeni")).toHaveText(/^Od poplatku jsou osvobozeny osoby.*po dobu delší než 6 měsíců.*v roce 2027/);
  await expect(page.locator("#osvobozeni")).not.toHaveAttribute("data-distill-plain", /.*/);
  // Short lines, table cells and the form are left alone.
  await expect(page.locator("h2").first()).toHaveText("Jak poplatek zaplatit");
  await expect(page.locator("article td").nth(1)).toHaveText("900 Kč");
  await expect(page.locator("#dotaz p")).toHaveText(/^Máte dotaz k poplatku\?/);
  await expect(page.locator("#zprava")).toHaveValue("Moje zpráva 4711");
  expect(await page.locator("[data-distill-plain]").count()).toBe(6);

  // Where it ran, from the run's own answer.
  const chip = frame.getByTestId("cap-chip");
  await expect(chip).toHaveText("On this device");
  await expect(chip).toHaveAttribute("data-src", "on_device");
  await expect(chip).toHaveAttribute("title", /^The plain words ran on this device\./);
  await expect(chip).toHaveAttribute("data-plain-blocks", "6/7");
  await expect(chip).toHaveAttribute("data-plain-lost", "1");
  await expect(frame.getByTestId("cap-row").locator(":scope > button")).toHaveCount(3); // As written, More, Original

  const m = await measure(page, base);
  expect(m.strip.share).toBeLessThanOrEqual(BAR.shareDesktop);
  expect(m.strip.onTop).toBe(true);
  expect(m.contentKept).toBe(1);
  expect(await rowFits(frame)).toBe(true);
  await evidence(page, "r2-04-demo");

  // As written: every word as the page wrote it; Plain again shows the same rewrites at once.
  await plain.click();
  await expect(plain).toHaveText("Plain");
  expect(await article(page)).toBe(before);
  await expect(status).not.toContainText("Plain words");
  await plain.click();
  await expect(page.locator("#sazba")).toHaveText(/^\[PLAIN\] /);
  await expect(status).toContainText(NUMBER_LOST);

  // Original: the untouched page; Back to Distill shows the plain words again.
  await frame.getByTestId("cap-original").click();
  await expect(frame.getByTestId("cap-back")).toBeVisible();
  expect(await article(page)).toBe(before);
  await frame.getByTestId("cap-back").click();
  await expect(page.locator("#sazba")).toHaveText(/^\[PLAIN\] /);
  await expect(plain).toHaveText("As written");

  // Close: nothing left behind, to the byte.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(page.locator("distill-caption")).toHaveCount(0);
  expect(await exactly(page)).toBe(exact);
  await expect(page.locator("#zprava")).toHaveValue("Moje zpráva 4711");
});

test("plain: after Translate, Plain rewrites the translation; Keep Czech shows the page's own words; the phone strip holds", async ({ distill }) => {
  const tab = await distill.openTab("caption-plain");
  const page = tab.page;
  await page.setViewportSize({ width: 390, height: 844 });
  const base = await baseline(page);
  const before = await article(page);
  await fakeModel(distill.worker);

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  const status = frame.getByTestId("cap-status");
  await expect(status).toContainText("Translated from Czech", { timeout: 15_000 });
  // r5-08: on a phone the row keeps More and Original; Plain and Keep Czech are in the sheet.
  await expect(frame.getByTestId("cap-row").getByTestId("cap-plain")).toHaveCount(0);
  await frame.getByTestId("cap-more-btn").click();
  const plain = frame.getByTestId("cap-sheet-acts").getByTestId("cap-plain");
  await expect(plain).toHaveText("Plain");
  await expect(page.locator("#sazba")).toHaveText(/^\[EN\] Na základě/);

  await plain.click();
  await expect(status).toContainText(NUMBER_LOST, { timeout: 15_000 });
  await expect(page.locator("#sazba")).toHaveText(/^\[PLAIN\] \[EN\] Na základě/);
  await expect(page.locator("#sazba")).toHaveAttribute("lang", "en");
  await expect(page.locator("#sazba")).toHaveAttribute("data-distill-translated", "");
  await expect(page.locator("#osvobozeni")).toHaveText(/^\[EN\] Od poplatku/); // its rewrite lost a number: the translation stays
  const chip = frame.getByTestId("cap-chip");
  await expect(chip).toHaveText("On this device");
  await expect(chip).toHaveAttribute("title", /plain words ran on this device.*translation from Czech ran on this device/);
  await expect(frame.getByTestId("cap-keep-source")).toHaveText("Keep Czech");

  // The phone strip, the sheet shut: within its share, nothing pushed out sideways.
  await frame.getByTestId("cap-sheet-close").click();
  await settled(page);
  const m = await measure(page, base);
  expect(m.strip.share).toBeLessThanOrEqual(BAR.sharePhone);
  expect(m.strip.onTop).toBe(true);
  expect(m.overflow).toBe(false);
  expect(await rowFits(frame)).toBe(true);
  await evidence(page, "r2-04-demo-390");

  // Keep Czech: the page's own words, as written; plain words go off with it.
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-keep-source").click();
  await expect(frame.getByTestId("cap-keep-source")).toHaveText("Show English");
  expect(await article(page)).toBe(before);
  await expect(plain).toHaveText("Plain");
  await expect(status).not.toContainText("Plain words");
  // Show English: the translation (Plain stays off until asked); Plain again: the same rewrites, no new call.
  await frame.getByTestId("cap-keep-source").click();
  await expect(page.locator("#sazba")).toHaveText(/^\[EN\] Na základě/);
  await plain.click();
  await expect(page.locator("#sazba")).toHaveText(/^\[PLAIN\] \[EN\] /);
  await expect(chip).toHaveAttribute("data-plain-blocks", "6/7");
  // Keep Czech, then Plain on the Czech words: plain words of the page's own text.
  await frame.getByTestId("cap-keep-source").click();
  await plain.click();
  await expect(page.locator("#sazba")).toHaveText(/^\[PLAIN\] Na základě/);
  await expect(page.locator("#sazba")).not.toHaveAttribute("lang", /./);
  expect(await rowFits(frame)).toBe(true);

  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await article(page)).toBe(before);
  expect(await page.locator("[data-distill-plain], [data-distill-translated], article [lang=en]").count()).toBe(0);
});

test("plain: with no model the control is not offered", async ({ distill }) => {
  const tab = await distill.openTab("caption-plain");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await expect(frame.getByTestId("cap-status")).toContainText("Page in Czech", { timeout: 15_000 });
  await tab.page.waitForTimeout(500);
  await expect(frame.getByTestId("cap-plain")).toHaveCount(0);
});
