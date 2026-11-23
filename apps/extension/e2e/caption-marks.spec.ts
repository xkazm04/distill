// Spark round 5, r5-07: one system for every mark Distill puts on the page, in real Chromium. Quiet marks (the claims'
// underlines, the wash on things to do), the active mark (Show me, a tour's step, the ring on a place), and the notes
// (where a link goes, explain this word) in one shape. Checked: the marks still appear and keep their names, the active
// mark paints over the quiet ones, the ring uses the system's colours (not Distill's blue), the wash is weighed against
// the page's own text (full on a light page, fainter on a dark page with grey text, weighed again when Dark page turns
// on), the marks survive round 3's text splits (dates written your way), and Original and close take every mark off.
// Contrast numbers for docs/caption.md ("Round 5, r5-07") are printed and attached.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";
import { contrastOf, markColours, marksNow } from "./marks";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 82 });
};

async function fakeModel(worker: Worker) {
  await worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
}
async function openMore(frame: Frame) {
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
}
const unwrapTerms = (html: string) => html.replace(/<span data-distill-term="[a-z]+" data-distill-term-add="[^"]*" title="[^"]*">([^<]*)<\/span>/g, "$1");
const article = (page: Page) => page.locator("article").evaluate((el) => el.innerHTML)
  .then((html) => unwrapTerms(html).replace(/\s(data-distill-[a-z-]+)(="[^"]*")?/g, "").replace(/ style=""/g, ""));
/** Every trace of the marks on the page: highlights, attributes, style sheets. */
const traces = (page: Page) => page.evaluate(() => {
  const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const names = Array.from(reg?.keys() ?? []).filter((n) => n.startsWith("distill-"));
  const sel = "[data-distill-claim], [data-distill-action], [data-distill-tour], [data-distill-place], [data-distill-locate], "
    + "#distill-claims-style, #distill-actions-style, #distill-tour-style, #distill-place-style, #distill-locate-style";
  return { names, left: document.querySelectorAll(sel).length };
});

test("marks: things to do get the quiet wash, Show me and a place get the active mark, over text splits; Original and close clear", async ({ distill }, info) => {
  const tab = await distill.openTab("caption-actions");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  const before = await article(page);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await expect(frame.getByTestId("cap-status")).toHaveText(/7 things to do$/, { timeout: 10_000 });

  // Quiet: seven washed ranges at full strength on this light page, under the active priority.
  await expect.poll(async () => (await marksNow(page)).ranges["distill-action"]).toBe(7);
  let now = await marksNow(page);
  expect(now.wash).toBe(32);
  expect(now.priority["distill-action"]).toBe(0);

  // Round 3's text splits: dates written your way wrap the deadline in a span of its own; the marks are found again
  // over the split nodes, the same seven, the deadline's sentence whole.
  await expect.poll(() => page.locator("article [data-distill-term]").count()).toBeGreaterThan(0);
  await page.evaluate(() => document.dispatchEvent(new Event("distill:textsplit")));
  await page.waitForTimeout(300);
  const texts = await page.evaluate(() => Array.from((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("distill-action") ?? []).map((r) => r.toString()));
  expect(texts).toHaveLength(7);
  expect(texts).toContain("Kdo žádá o osvobození od poplatku, musí žádost podat do 28. 2. 2027.");

  // The key in More, in the Things to do section.
  await openMore(frame);
  const key = frame.getByTestId("cap-actions").getByTestId("cap-marks-key");
  await expect(key).toBeVisible();
  await expect(key).toContainText("On the page:");
  expect(await key.locator("[data-mark]").evaluateAll((els) => els.map((e) => e.getAttribute("data-mark")))).toEqual(["action", "active"]);

  // Active: Show me paints over the wash, in the system's find-in-page colours.
  await page.evaluate(() => scrollTo(0, 0));
  const items = frame.getByTestId("cap-action");
  await items.nth(2).getByTestId("cap-action-show").click();
  await expect.poll(async () => (await marksNow(page)).ranges["distill-action-show"]).toBe(1);
  now = await marksNow(page);
  expect(now.priority["distill-action-show"]).toBe(2);
  expect(await page.locator("#distill-actions-style").textContent()).toContain("::highlight(distill-action-show) { background-color: Mark; color: MarkText; }");
  await page.waitForTimeout(400);
  await shot(page, "r5-07-demo-actions");

  // A place (a contact block): the ring, MarkText inside Mark, never Distill's own blue.
  const contact = frame.getByTestId("cap-contact-item").first();
  await contact.getByRole("button", { name: "Show on page" }).click();
  await expect(page.locator("[data-distill-place]")).toHaveCount(1);
  const ring = await page.locator("[data-distill-place]").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { outline: cs.outlineColor, style: cs.outlineStyle, shadow: cs.boxShadow };
  });
  expect(ring.outline).toBe("rgb(255, 255, 0)");
  expect(ring.style).toBe("solid");
  expect(ring.shadow).toContain("rgb(0, 0, 0)");
  await page.waitForTimeout(300);
  await shot(page, "r5-07-demo-ring");

  // Contrast on this light page (white main column, dark green text).
  const light = contrastOf((await markColours(page, "#pay"))!);
  expect(light).not.toBeNull();
  expect(light!.wash).toBe(now.wash);
  expect(light!.textOnWash).toBeGreaterThanOrEqual(4.5);
  expect(light!.activeText).toBeGreaterThan(19);
  expect(light!.ring).toBeGreaterThanOrEqual(4.4);
  // Chromium's system colours, as the pure table assumes them.
  expect([light!.colours.mark, light!.colours.markText]).toEqual(["rgb(255, 255, 0)", "rgb(0, 0, 0)"]);

  // Dark page on: the wash is weighed again on the new colours and the text on it still reads.
  await frame.getByTestId("cap-dark").click();
  await expect(frame.getByTestId("cap-dark")).toBeChecked();
  await page.waitForTimeout(500);
  const dark = contrastOf((await markColours(page, "#pay"))!);
  now = await marksNow(page);
  expect(dark).not.toBeNull();
  expect(now.wash).toBe(dark!.wash);
  expect(dark!.textOnWash).toBeGreaterThanOrEqual(Math.min(4.5, dark!.text));
  expect(dark!.ring).toBeGreaterThanOrEqual(4.4);
  await items.nth(5).getByTestId("cap-action-show").click();
  await page.waitForTimeout(400);
  await shot(page, "r5-07-demo-darkpage");
  await frame.getByTestId("cap-dark").click();
  await expect(frame.getByTestId("cap-dark")).not.toBeChecked();

  // Original: no mark at all; Back to Distill: the quiet marks again.
  await frame.getByTestId("cap-original").click();
  await expect.poll(async () => Object.keys((await marksNow(page)).ranges).filter((n) => n !== "distill-action-show")).toEqual([]);
  await frame.getByTestId("cap-back").click();
  await expect.poll(async () => (await marksNow(page)).ranges["distill-action"]).toBe(7);

  // Close: nothing is left, and the article is as it was (a ring still up included).
  if (!(await frame.getByTestId("cap-more").isVisible())) await openMore(frame);
  await contact.getByRole("button", { name: "Show on page" }).click();
  await expect(page.locator("[data-distill-place]")).toHaveCount(1);
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect.poll(() => traces(page)).toEqual({ names: [], left: 0 });
  expect(await article(page)).toBe(before);

  const table = { light, darkPage: dark };
  console.log(`r5-07 contrast (demo): ${JSON.stringify(table)}`);
  await info.attach("r5-07-contrast-demo.json", { body: JSON.stringify(table, null, 2), contentType: "application/json" });
});

test("marks: on a page dark already with grey text the wash is fainter and the text on it still reads 4.5:1", async ({ distill }, info) => {
  const tab = await distill.openTab("caption-marks-dark");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await expect.poll(async () => (await marksNow(page)).ranges["distill-action"] ?? 0).toBeGreaterThanOrEqual(4);
  const now = await marksNow(page);
  const dark = contrastOf((await markColours(page, "#pay"))!);
  expect(dark).not.toBeNull();
  expect(dark!.text).toBeGreaterThanOrEqual(4.5);
  expect(now.wash).toBe(dark!.wash);
  expect(now.wash).toBeLessThan(32);
  expect(dark!.textOnWash).toBeGreaterThanOrEqual(4.5);
  await openMore(frame);
  await frame.getByTestId("cap-action").first().getByTestId("cap-action-show").click();
  await page.waitForTimeout(400);
  await shot(page, "r5-07-demo-dark");
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect.poll(() => traces(page)).toEqual({ names: [], left: 0 });
  console.log(`r5-07 contrast (dark demo): ${JSON.stringify(dark)}`);
  await info.attach("r5-07-contrast-dark.json", { body: JSON.stringify(dark, null, 2), contentType: "application/json" });
});

test("marks: claims are underlined quietly with one line style per verdict, the key names them, Show me is the active mark", async ({ distill }) => {
  const tab = await distill.openTab("caption-claims");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 760 });
  await fakeModel(distill.worker);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await expect(frame.getByTestId("cap-status")).toHaveText(/6 claims to check$/, { timeout: 15_000 });
  await expect.poll(async () => (await marksNow(page)).ranges["distill-claim"]).toBe(6);
  expect((await marksNow(page)).priority["distill-claim"]).toBe(0);

  // Every state has its own line: told apart without colour.
  const css = (await page.locator("#distill-claims-style").textContent()) ?? "";
  for (const [name, line] of [["distill-claim", "dotted"], ["distill-claim-supported", "solid"], ["distill-claim-disputed", "wavy"], ["distill-claim-mixed", "dashed"], ["distill-claim-notFound", "double"]]) {
    expect(css).toContain(`::highlight(${name}) { text-decoration: underline ${line};`);
  }

  await openMore(frame);
  const key = frame.getByTestId("cap-claims").getByTestId("cap-marks-key");
  await expect(key).toBeVisible();
  expect(await key.locator("[data-mark]").evaluateAll((els) => els.map((e) => e.getAttribute("data-mark")))).toEqual(["claim", "supported", "disputed", "mixed", "notFound", "active"]);
  // A screen reader hears how each sample looks.
  await expect(key).toContainText("wavy underline: disputed");

  await frame.getByTestId("cap-claim-show").nth(1).click();
  await expect.poll(async () => (await marksNow(page)).ranges["distill-show"]).toBe(1);
  expect((await marksNow(page)).priority["distill-show"]).toBe(2);
  await page.waitForTimeout(500);
  await shot(page, "r5-07-demo-claims");

  // The link note and the explain note: one shape (the same base style sheet in their shadow roots).
  await page.mouse.move(0, 0);
  await page.hover("#budget-link");
  await expect.poll(() => page.evaluate(() => (document.querySelector("distill-link-note")?.shadowRoot?.querySelector(".note")?.textContent ?? "").length)).toBeGreaterThan(0);
  const linkBox = await page.evaluate(() => {
    const box = document.querySelector("distill-link-note")!.shadowRoot!.querySelector(".note")!;
    const cs = getComputedStyle(box);
    return { radius: cs.borderRadius, font: cs.fontSize, border: cs.borderTopWidth, maxWidth: cs.maxWidth, title: !!box.querySelector(".title") };
  });
  expect(linkBox).toEqual({ radius: "8px", font: "13px", border: "1px", maxWidth: "320px", title: true });
  await shot(page, "r5-07-demo-linknote");

  // Original and close.
  await page.mouse.move(0, 0);
  await frame.getByTestId("cap-original").click();
  await expect.poll(async () => (await marksNow(page)).ranges["distill-claim"] ?? 0).toBe(0);
  await frame.getByTestId("cap-back").click();
  await expect.poll(async () => (await marksNow(page)).ranges["distill-claim"]).toBe(6);
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect.poll(() => traces(page)).toEqual({ names: [], left: 0 });
});

test("marks: the explain note has the link note's shape", async ({ distill }) => {
  const tab = await distill.openTab("caption-explain");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 760 });
  await fakeModel(distill.worker);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  await firstSight(await captionFrame(page));
  // Select the first longish word of the main text.
  const ok = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll("main p, article p")).find((e) => (e.textContent ?? "").length > 60);
    const t = p ? document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode() as Text | null : null;
    const m = t ? /\p{L}{5,}/u.exec(t.data) : null;
    if (!t || !m) return false;
    const r = document.createRange();
    r.setStart(t, m.index);
    r.setEnd(t, m.index + m[0].length);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
    return true;
  });
  expect(ok).toBe(true);
  await expect(page.locator("distill-explain-note button", { hasText: "Explain" })).toBeVisible();
  await page.locator("distill-explain-note button", { hasText: "Explain" }).click();
  await expect(page.locator("distill-explain-note .note")).toHaveAttribute("data-phase", "shown", { timeout: 10_000 });
  const box = await page.evaluate(() => {
    const el = document.querySelector("distill-explain-note")!.shadowRoot!.querySelector(".note")!;
    const cs = getComputedStyle(el);
    return { radius: cs.borderRadius, font: cs.fontSize, border: cs.borderTopWidth, maxWidth: cs.maxWidth, title: !!el.querySelector(".title"), padding: cs.padding };
  });
  expect(box).toEqual({ radius: "8px", font: "13px", border: "1px", maxWidth: "320px", title: true, padding: "8px 10px" });
  await shot(page, "r5-07-demo-explainnote");
});
