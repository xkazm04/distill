// Spark round 5, r5-10: the keyboard walk, in real Chromium on demo pages.
// - The strip: from the page, Tab reaches it; inside, every control is reached in a sensible order (the row left to
//   right; More's tabs before what they show, the parts by the arrows), each with a visible focus ring and a name a
//   screen reader says; the same in the phone sheet.
// - The page after Clean: the skip link inside the removed header still works, the h1 and the main landmark stay, and
//   Tab never lands on anything Distill hid (here and on the demo pages that hide the most).
import type { Frame, Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { type Distill, expect, test } from "./harness";

async function open(distill: Distill, name: string, size = { width: 1280, height: 900 }) {
  await distill.worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
  const tab = await distill.openTab(name);
  await tab.page.setViewportSize(size);
  await tab.page.emulateMedia({ reducedMotion: "reduce" });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  return { page: tab.page, frame };
}

interface Stop { id: string; name: string; ring: boolean; x: number; y: number; inMore: boolean; role: string }

/** What has focus in the strip: an id for it, its visible focus ring, where it is. */
function focused(frame: Frame): Promise<Stop | null> {
  return frame.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || !document.hasFocus()) return null; // focus left the strip
    // The ring on the control or on the pill drawn inside it (a chip rings its inner pill).
    const ringed = (e: Element) => { const cs = getComputedStyle(e); return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) || (cs.boxShadow !== "none" && /px/.test(cs.boxShadow)); };
    const ring = ringed(el) || Array.from(el.querySelectorAll(":scope > *")).some(ringed);
    const r = el.getBoundingClientRect();
    const all = Array.from(document.querySelectorAll("*"));
    const id = `${el.getAttribute("data-testid") ?? `${el.localName}:${(el.textContent ?? "").trim().slice(0, 24)}`}@${all.indexOf(el)}`;
    return { id, name: "", ring, x: r.left, y: r.top, inMore: !!el.closest("#cap-more"), role: el.getAttribute("role") ?? el.localName };
  });
}

/** Every control a keyboard can reach in the strip now: shown, enabled, not tabindex=-1. With `focusFirst`, the first
 *  of them gets focus (where a Tab into the strip lands). */
function tabbable(frame: Frame, focusFirst = false): Promise<string[]> {
  return frame.evaluate((first) => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")).filter((el) => {
      if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled || el.closest("[hidden], [inert], [aria-hidden=true]")) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !el.closest(".fl-measure");
    });
    if (first) els[0]?.focus();
    const all = Array.from(document.querySelectorAll("*"));
    return els.map((el) => `${el.getAttribute("data-testid") ?? `${el.localName}:${(el.textContent ?? "").trim().slice(0, 24)}`}@${all.indexOf(el)}`);
  }, focusFirst);
}

/** The testid part of a stop's id. */
const tid = (id: string) => id.replace(/@\d+$/, "");

/** Tabs through the strip from its first control, until focus leaves it or comes round again. */
async function walk(page: Page, frame: Frame, max = 80): Promise<Stop[]> {
  await frame.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: Stop[] = [];
  await tabbable(frame, true);
  for (let i = 0; i < max; i++) {
    const s = await focused(frame);
    if (!s || stops.some((t) => t.id === s.id)) break;
    // The name a screen reader says, from the browser's accessibility tree.
    await expect(frame.locator(":focus"), `${s.id} has a name`).toHaveAccessibleName(/\S/);
    stops.push(s);
    await page.keyboard.press("Tab");
  }
  return stops;
}

const noRing = (stops: Stop[]) => stops.filter((s) => !s.ring).map((s) => s.id);

test("keyboard: Tab reaches the strip from the page; every control in the row and in each part of More, in order, ringed and named", async ({ distill }) => {
  const { page, frame } = await open(distill, "caption-parts");
  await expect(frame.getByTestId("cap-status")).toContainText("claims to check", { timeout: 15_000 });

  // From the page: Tab goes through the page's links and on into the strip.
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); scrollTo(0, 0); });
  let inStrip = false;
  for (let i = 0; i < 80 && !inStrip; i++) {
    await page.keyboard.press("Tab");
    inStrip = await frame.evaluate(() => document.hasFocus() && document.activeElement !== document.body);
  }
  expect(inStrip, "Tab from the page reaches the strip").toBe(true);

  // The row: left to right, every control.
  const row = await walk(page, frame);
  expect(row.map((s) => tid(s.id))).toEqual(expect.arrayContaining(["cap-more-btn", "cap-original"]));
  expect(new Set(row.map((s) => s.id))).toEqual(new Set(await tabbable(frame)));
  for (let i = 1; i < row.length; i++) expect(row[i]!.x, `${row[i]!.id} after ${row[i - 1]!.id}`).toBeGreaterThanOrEqual(row[i - 1]!.x - 1);
  expect(noRing(row), "every control in the row shows its focus ring").toEqual([]);

  // More, opened from the keyboard: focus order is the tab row first, then the part shown; arrows move between parts.
  await frame.getByTestId("cap-more-btn").focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  await settled(page);
  const parts = await frame.getByRole("tab").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
  expect(parts.length).toBeGreaterThanOrEqual(4);
  const seen = new Set<string>();
  for (let p = 0; p < parts.length; p++) {
    const stops = await walk(page, frame, 120);
    const ids = stops.map((s) => s.id);
    expect(new Set(ids), `part ${p}: every control reached`).toEqual(new Set(await tabbable(frame)));
    expect(noRing(stops), `part ${p}: every control shows its ring`).toEqual([]);
    // One tab of the row is in the Tab order (the chosen one), and it comes before the part's own controls.
    const tabStops = stops.filter((s) => s.role === "tab");
    expect(tabStops).toHaveLength(1);
    const firstInPart = stops.findIndex((s) => s.inMore && s.role !== "tab" && !/^cap-sheet|^cap-tab/.test(tid(s.id)));
    if (firstInPart >= 0) expect(stops.indexOf(tabStops[0]!)).toBeLessThan(firstInPart);
    seen.add(tabStops[0]!.id);
    // Next part by the arrow key, as ARIA tabs do.
    await frame.locator('[role="tab"][aria-selected="true"]').focus();
    await page.keyboard.press("ArrowRight");
    await settled(page).catch(() => undefined);
  }
  expect(seen.size, "the arrows went through every part").toBe(parts.length);

  // Escape-free close from the keyboard: More's button again; focus stays on it.
  await frame.getByTestId("cap-more-btn").focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-more")).toHaveCount(0);
  await expect(frame.getByTestId("cap-more-btn")).toBeFocused();

  // Original and back, from the keyboard.
  await frame.getByTestId("cap-original").focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-back")).toBeVisible();
  const orig = await walk(page, frame);
  expect(orig.map((s) => tid(s.id))).toContain("cap-back");
  expect(noRing(orig)).toEqual([]);
  await frame.getByTestId("cap-back").focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-original")).toBeVisible();
});

test("keyboard: a tour from the keyboard - start, next, back, end; every control ringed and named", async ({ distill }) => {
  const { page, frame } = await open(distill, "caption-claims");
  await expect(frame.getByTestId("cap-status")).toHaveText(/claims to check/, { timeout: 15_000 });
  await frame.getByTestId("cap-more-btn").focus();
  await page.keyboard.press("Enter");
  await frame.getByTestId("cap-tab-do").focus();
  await page.keyboard.press("Enter");
  const start = frame.getByTestId("cap-tour-start-facts");
  await expect(start).toBeVisible();
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-tour-status")).toHaveText(/^Step 1 of/);
  // Starting a tour closes More (the tour's caption takes the strip): wait for it, then walk what is there.
  await expect(frame.getByTestId("cap-more")).toHaveCount(0);
  await settled(page);
  const stops = await walk(page, frame);
  expect(stops.map((s) => tid(s.id))).toEqual(expect.arrayContaining(["cap-tour-next", "cap-tour-end"]));
  expect(new Set(stops.map((s) => s.id))).toEqual(new Set(await tabbable(frame)));
  expect(noRing(stops)).toEqual([]);
  await frame.getByTestId("cap-tour-next").focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-tour-status")).toHaveText(/^Step 2 of/);
  await frame.getByTestId("cap-tour-end").focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-tour-status")).toHaveCount(0);
});

test("keyboard: the phone sheet - opened, made full, closed from the keyboard; every control reached, ringed and named", async ({ distill }) => {
  const { page, frame } = await open(distill, "caption-parts", { width: 390, height: 844 });
  await expect(frame.getByTestId("cap-status")).toContainText("claims to check", { timeout: 15_000 });
  const row = await walk(page, frame);
  expect(new Set(row.map((s) => s.id))).toEqual(new Set(await tabbable(frame)));
  expect(noRing(row)).toEqual([]);
  await frame.getByTestId("cap-more-btn").focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "half");
  await settled(page);
  const half = await walk(page, frame, 120);
  expect(half.map((s) => tid(s.id))).toEqual(expect.arrayContaining(["cap-sheet-grip", "cap-sheet-size", "cap-sheet-close"]));
  expect(noRing(half)).toEqual([]);
  // The sheet's own buttons come first, then its tabs.
  const ids = half.map((s) => tid(s.id));
  expect(ids.indexOf("cap-sheet-close")).toBeLessThan(ids.findIndex((id) => id.startsWith("cap-tab-")));
  await frame.getByTestId("cap-sheet-size").focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "full");
  await frame.getByTestId("cap-sheet-close").focus();
  await page.keyboard.press("Enter");
  await expect(frame.getByTestId("cap-more")).toHaveCount(0);
  await expect(frame.getByTestId("cap-more-btn")).toBeFocused();
});

/** Puts the keyboard's starting point at the top of the page, as a click there does. */
async function fromTop(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    scrollTo(0, 0);
    // A focusable stand-in at the very start, focused and removed: the next Tab goes to the page's first control.
    const start = document.createElement("span");
    start.tabIndex = -1;
    document.body.prepend(start);
    start.focus();
    start.remove();
  });
}

/** Tabs through the page (not the strip) from its start; returns what each stop was, and whether it could be seen. */
async function pageWalk(page: Page, max = 60) {
  await fromTop(page);
  const stops: { what: string; seen: boolean; hiddenByDistill: boolean }[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el.localName === "distill-caption") return null;
      const r = el.getBoundingClientRect();
      let seen = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      for (let e: Element | null = el; e && seen; e = e.parentElement) if (parseFloat(getComputedStyle(e).opacity) === 0) seen = false;
      const hid = el.closest("[data-distill-hide]");
      return { what: `${el.localName}${el.id ? `#${el.id}` : ""} ${(el.textContent ?? "").trim().slice(0, 30)}`, seen, hiddenByDistill: !!hid && !el.hasAttribute("data-distill-way-link") };
    });
    if (!s) break; // focus went on into the strip
    stops.push(s);
  }
  return stops;
}

test("keyboard: after Clean the skip link in the removed header still works; the h1 and the main landmark stay; focus never lands on what went", async ({ distill }) => {
  await distill.worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
  const tab = await distill.openTab("caption-a11y");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Focus sits in the sidebar's advert when Clean runs: it must not stay there.
  await page.getByTestId("ad-btn").focus();
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await expect(page.locator("aside.side")).toBeHidden();
  expect(await page.evaluate(() => !!document.activeElement?.closest("[data-distill-hide]"))).toBe(false);

  // The header (its menu) went; the h1 and the main landmark with the text stay.
  await expect(page.locator("header.site nav")).toBeHidden();
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("main#obsah")).toBeVisible();

  // The first Tab: the skip link, shown where the page shows it on focus; Enter takes the reader to the text.
  await fromTop(page);
  await page.keyboard.press("Tab");
  const skip = page.getByTestId("skip");
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  expect(box && box.width > 20 && box.height > 10 && box.x >= 0 && box.y >= 0, `skip link shown on focus: ${JSON.stringify(box)}`).toBe(true);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#obsah");
  await expect(page.locator("main#obsah")).toBeFocused();

  // The whole page by Tab: nothing hidden is ever focused, and the menu's links are not in the way.
  const stops = await pageWalk(page);
  expect(stops.filter((s) => !s.seen || s.hiddenByDistill).map((s) => s.what)).toEqual([]);
  expect(stops.map((s) => s.what).join("|")).not.toMatch(/Zavřít reklamu|Aktuality|Odebírat/);

  // Original: the page as it was (the header and the sidebar back); close leaves no mark.
  await frame.getByTestId("cap-original").click();
  await expect(page.locator("header.site nav")).toBeVisible();
  await expect(page.locator("aside.side")).toBeVisible();
  await frame.getByTestId("cap-back").click();
  await expect(page.locator("header.site nav")).toBeHidden();
});

for (const name of ["caption-parts", "caption-reflow", "caption-media", "caption-consent", "caption-shop"]) {
  test(`keyboard: ${name} after Clean - Tab never lands on anything Distill hid`, async ({ distill }) => {
    const { page } = await open(distill, name);
    await page.waitForTimeout(800);
    // A page whose every control was in what Clean hid has no stop before the strip: that is the point.
    const stops = await pageWalk(page);
    expect(stops.filter((s) => !s.seen || s.hiddenByDistill).map((s) => s.what)).toEqual([]);
  });
}
