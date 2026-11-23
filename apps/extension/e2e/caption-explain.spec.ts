// Spark round 4, r4-05: explain this word, in real Chromium with the e2e build's stand-in model (it answers
// "[EXPLAIN] ..." built from the selected words). What is checked is the mechanism: the Explain button beside words
// selected in the main text (never in a form field), the answer from the stand-in "On this device", an abbreviation the
// page spells out answered "From this page" with no model at all, the keyboard path (Tab, Enter, Esc), and that with no
// model the note says why. The words are kept in no storage.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Worker } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

/** Screenshots for the spark board, outside the repo on purpose. */
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r4";

async function fakeModel(worker: Worker, opts: { fail?: string; source?: "on_device" | "in_cloud" } = {}) {
  await worker.evaluate(async (o) => { await chrome.storage.session.set({ "distill:e2e:fakeAi": o }); }, opts);
}

const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `caption-explain-${name}.png`) });
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 82 });
  } catch { /* the evidence folder is a convenience of the owner's machine */ }
};

/** Selects `words` inside the element `#id` as a person's drag would (the page's own selection). */
const select = (page: Page, id: string, words: string) => page.evaluate(([id, words]) => {
  const el = document.getElementById(id) as HTMLElement;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const at = n.data.indexOf(words);
    if (at < 0) continue;
    const r = document.createRange();
    r.setStart(n, at);
    r.setEnd(n, at + words.length);
    const sel = getSelection() as Selection;
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }
  return false;
}, [id, words] as const);

const note = (page: Page) => page.locator("distill-explain-note .note");
/** The note while it is up (hidden, it stays in the page empty, with no phase). */
const up = (page: Page) => page.locator("distill-explain-note .note[data-phase]");
const noteButton = (page: Page, name: string) => page.locator("distill-explain-note button", { hasText: name });

test("explain: select words, press Explain, the answer on this device; Esc closes it; never in a form field", async ({ distill }) => {
  const tab = await distill.openTab("caption-explain");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 760 });
  await fakeModel(distill.worker);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  await firstSight(await captionFrame(page));

  expect(await select(page, "dph", "kontrolní hlášení")).toBe(true);
  await expect(noteButton(page, "Explain")).toBeVisible();
  await expect(note(page)).toHaveAttribute("data-phase", "offer");
  await noteButton(page, "Explain").click();
  await expect(note(page)).toHaveAttribute("data-phase", "shown", { timeout: 10_000 });
  await expect(note(page)).toHaveAttribute("data-source", "on_device");
  await expect(note(page)).toContainText('[EXPLAIN] "kontrolní hlášení" is explained here by the stand-in model.');
  await expect(note(page)).toContainText("On this device");
  // Beside the words, on screen, clear of the strip.
  const box = await page.locator("distill-explain-note").boundingBox();
  const words = await page.evaluate(() => getSelection()?.getRangeAt(0).getBoundingClientRect().toJSON() as DOMRect);
  expect(box && Math.abs(box.y - (words.bottom + 6)) < 4).toBe(true);
  await page.waitForTimeout(200);
  await shot(page, "r4-05-explain");

  // The words are a person's choice: kept in no storage the extension has.
  const stored = await distill.worker.evaluate(async () => JSON.stringify([
    await chrome.storage.local.get(null), await chrome.storage.session.get(null), await chrome.storage.sync.get(null)]));
  expect(stored).not.toContain("kontrolní");

  await page.keyboard.press("Escape");
  await expect(up(page)).toHaveCount(0);

  // A press elsewhere closes it as well.
  await select(page, "portal", "XML");
  await noteButton(page, "Explain").click();
  await expect(note(page)).toHaveAttribute("data-phase", "shown", { timeout: 10_000 });
  await page.mouse.click(40, 300);
  await expect(up(page)).toHaveCount(0);

  // Never in a form field.
  await page.locator("#income").focus();
  await page.locator("#income").selectText();
  await page.waitForTimeout(500);
  await expect(up(page)).toHaveCount(0);

  // Close takes the note and its listener off the page.
  await page.locator("#income").blur();
  await select(page, "dph", "kontrolní hlášení");
  await expect(noteButton(page, "Explain")).toBeVisible();
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(page.locator("distill-explain-note")).toHaveCount(0);
  await select(page, "portal", "XML");
  await page.waitForTimeout(500);
  await expect(page.locator("distill-explain-note")).toHaveCount(0);
});

test("explain: an abbreviation the page spells out is answered from the page, with no model at all", async ({ distill }) => {
  // No stand-in model: the e2e build has no AI. The page's own words still explain DPH and OSVČ.
  const tab = await distill.openTab("caption-explain");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 760 });
  await startCaption(distill.worker, tab.id);
  await firstSight(await captionFrame(page));

  await select(page, "dph", "DPH");
  await noteButton(page, "Explain").click();
  await expect(note(page)).toHaveAttribute("data-source", "page");
  await expect(note(page)).toContainText("daně z přidané hodnoty");
  await expect(note(page)).toContainText("From this page");
  await page.keyboard.press("Escape");

  // OSVČ is bare in the main text; the page's tag list spells it out.
  await select(page, "osvc", "OSVČ");
  await noteButton(page, "Explain").click();
  await expect(note(page)).toHaveAttribute("data-source", "page");
  await expect(note(page)).toContainText("osoby samostatně výdělečně činné");
  await page.waitForTimeout(200);
  await shot(page, "r4-05-spelled");
});

test("explain: with no model on this device the note says why", async ({ distill }) => {
  const tab = await distill.openTab("caption-explain");
  const page = tab.page;
  await startCaption(distill.worker, tab.id);
  await firstSight(await captionFrame(page));
  await select(page, "portal", "finanční správa");
  await noteButton(page, "Explain").click();
  await expect(note(page)).toHaveAttribute("data-source", "refused", { timeout: 10_000 });
  await expect(note(page)).toContainText("not sent anywhere");
  await expect(note(page)).toContainText("Not explained");
  await shot(page, "r4-05-nomodel");
});

test("explain: the keyboard reaches it: Tab to Explain, Enter, Esc", async ({ distill }) => {
  const tab = await distill.openTab("caption-explain");
  const page = tab.page;
  await fakeModel(distill.worker);
  await startCaption(distill.worker, tab.id);
  await firstSight(await captionFrame(page));
  await select(page, "dph", "datovou schránku");
  await expect(noteButton(page, "Explain")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName.toLowerCase())).toBe("distill-explain-note");
  await page.keyboard.press("Enter");
  await expect(note(page)).toHaveAttribute("data-source", "on_device", { timeout: 10_000 });
  await expect(noteButton(page, "Close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(up(page)).toHaveCount(0);
});
