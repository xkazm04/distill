// Spark round 5: r5-05 the cleaned page, typeset, and r5-06 pictures in the cleaned page, on caption-media.html.
// Hermetic, like the rest of this folder; real sites: live/probes/typeset-media.live.ts.
// Screenshots go to E2E_EVIDENCE_DIR when it is set (the review's evidence folder), else e2e/out/evidence.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption, openMoreAt } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};

/** What the main column looks like now. Runs in the page. */
function look(page: Page) {
  return page.evaluate(() => {
    const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
    const rect = (el: Element) => el.getBoundingClientRect();
    const shownBox = (el: Element) => getComputedStyle(el).display !== "none" && rect(el).height > 0;
    const article = $("article");
    const wide = $("#wide") as HTMLImageElement;
    const cap = $("#cap");
    const h2 = $("#h-trasa");
    const p1 = $("#p1"), p2 = $("#p2");
    const lazy = $("#lazy") as HTMLImageElement;
    const price = (document.querySelectorAll("#ceny tbody tr")[3] as HTMLTableRowElement).cells[1] as HTMLElement;
    const items = Array.from(document.querySelectorAll("#galerie > a"));
    const button = document.querySelector("[data-distill-gallery-open]") as HTMLElement | null;
    return {
      column: Math.round(rect(article).width),
      wide: { width: Math.round(rect(wide).width), ratio: rect(wide).width / rect(wide).height },
      caption: { size: parseFloat(getComputedStyle(cap).fontSize), gap: Math.round(rect(cap).top - rect(wide).bottom), padding: parseFloat(getComputedStyle(cap).paddingTop) },
      heading: { above: Math.round(rect(h2).top - rect(h2.previousElementSibling as Element).bottom), below: Math.round(rect(h2.nextElementSibling as Element).top - rect(h2).bottom) },
      paragraphs: Math.round(rect(p2).top - rect(p1).bottom),
      list: parseFloat(getComputedStyle($("#list")).paddingInlineStart),
      quote: { padding: parseFloat(getComputedStyle($("#quote")).paddingInlineStart), border: parseFloat(getComputedStyle($("#quote")).borderInlineStartWidth) },
      price: { align: getComputedStyle(price).textAlign, nums: getComputedStyle($("#ceny")).fontVariantNumeric },
      gallery: { shown: items.filter(shownBox).length, button: button?.textContent ?? null },
      lazy: { src: lazy.getAttribute("src") ?? "", natural: lazy.naturalWidth, ratio: rect(lazy).width / rect(lazy).height },
      empty: shownBox($("#empty")),
      logo: { attrs: $(".logo").getAttributeNames().filter((n) => n.startsWith("data-distill")), width: Math.round(rect($(".logo")).width) },
      icon: { attrs: $("#icon").getAttributeNames().filter((n) => n.startsWith("data-distill")), width: Math.round(rect($("#icon")).width) },
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

/** Starts counting layout shifts (CLS, the browser's own layout-shift entries) from now. Runs in the page. */
const countShifts = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __shift: number };
  w.__shift = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__shift += e.value;
  }).observe({ type: "layout-shift", buffered: false });
});
const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __shift: number }).__shift);

test("caption media + typeset: the column is typeset, its pictures fit, the gallery folds, the lazy photo loads, Original and Close undo it", async ({ distill }) => {
  const tab = await distill.openTab("caption-media");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  await tab.page.waitForLoadState("load");
  const before = await look(tab.page);
  // The page as made: what each card is about.
  expect(before.wide.width).toBeGreaterThan(before.column);
  expect(before.caption.size).toBe(11);
  expect(before.heading.above).toBeLessThan(before.heading.below);
  expect(before.paragraphs).toBe(0);
  expect(before.list).toBe(0);
  expect(before.quote.padding + before.quote.border).toBe(0);
  expect(before.price.align).toBe("left");
  expect(before.gallery.shown).toBe(12);
  expect(before.lazy.src.startsWith("data:")).toBe(true);
  expect(before.empty).toBe(true);
  await shot(tab.page, "r5-05-demo-before");

  await countShifts(tab.page);
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  const duringClean = await shifts(tab.page);
  await countShifts(tab.page);
  // The lazy photo arrives after first sight, in the space kept for it.
  await expect.poll(async () => (await look(tab.page)).lazy.natural).toBe(1200);
  await settled(tab.page);
  const after = await look(tab.page);
  const afterClean = await shifts(tab.page);

  // r5-05 typeset.
  expect(after.heading.above).toBeGreaterThan(after.heading.below);
  expect(after.heading.below).toBeGreaterThanOrEqual(4);
  expect(after.paragraphs).toBeGreaterThanOrEqual(10);
  expect(after.list).toBeGreaterThanOrEqual(20);
  expect(after.quote.padding).toBeGreaterThan(0);
  expect(after.quote.border).toBeGreaterThan(0);
  expect(after.price.align).toMatch(/^(right|end)$/);
  expect(after.price.nums).toContain("tabular-nums");
  // r5-06 pictures.
  expect(after.wide.width).toBeLessThanOrEqual(after.column);
  expect(Math.abs(after.wide.ratio - 2400 / 1350)).toBeLessThan(0.02);
  expect(after.caption.size).toBeGreaterThanOrEqual(14);
  expect(after.caption.gap).toBeGreaterThanOrEqual(4);
  expect(after.gallery.shown).toBe(1);
  expect(after.gallery.button).toBe("+11 photos");
  expect(after.lazy.src).toContain("media/most.png");
  expect(Math.abs(after.lazy.ratio - 1.5)).toBeLessThan(0.02);
  expect(after.empty).toBe(false);
  expect(after.logo.attrs).toEqual([]); // (the header itself is Clean's to hide)
  expect(after.icon).toEqual(before.icon);
  expect(after.sideways).toBe(false);
  // Nothing jumps once Clean is done (the lazy photo had its space before it came).
  expect(afterClean).toBeLessThan(0.01);
  await shot(tab.page, "r5-05-demo-after");

  // The gallery opens in place; the focus goes to the first photo it opened.
  await tab.page.locator("#galerie").scrollIntoViewIfNeeded();
  await shot(tab.page, "r5-06-demo-gallery-folded");
  await tab.page.locator("[data-distill-gallery-open]").click();
  const opened = await look(tab.page);
  expect(opened.gallery.shown).toBe(12);
  expect(opened.gallery.button).toBeNull();
  expect(await tab.page.evaluate(() => document.activeElement?.getAttribute("href"))).toBe("#f2");
  await shot(tab.page, "r5-06-demo-gallery-open");

  // The Reading switch takes the typesetting off (not the pictures: they are not reading).
  await openMoreAt(frame, "cap-comfort"); // r5-02: the Reading switch is in Settings
  const sw = frame.getByTestId("cap-comfort");
  await sw.click();
  await expect.poll(async () => (await look(tab.page)).list).toBe(0);
  expect((await look(tab.page)).price.align).toBe("left");
  await sw.click();
  await expect.poll(async () => (await look(tab.page)).list).toBeGreaterThanOrEqual(20);
  await frame.getByTestId("cap-more-btn").click();

  // Original: the page as it was made (the photo wide again, the caption small, the list without room).
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  const original = await look(tab.page);
  expect(original.wide.width).toBe(before.wide.width);
  expect(original.caption.size).toBe(11);
  expect(original.list).toBe(0);
  expect(original.empty).toBe(true);
  await frame.getByTestId("cap-back").click();

  // The phone: no sideways scroll, the photo fits.
  await tab.page.setViewportSize({ width: 390, height: 844 });
  await settled(tab.page);
  const phone = await look(tab.page);
  expect(phone.sideways).toBe(false);
  expect(phone.wide.width).toBeLessThanOrEqual(phone.column);
  await tab.page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await shot(tab.page, "r5-06-demo-390");

  // Close: every attribute, button and style goes; the lazy photo has its stand-in back.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  const left = await tab.page.evaluate(() => ({
    marks: Array.from(document.querySelectorAll("*")).flatMap((e) => e.getAttributeNames()).filter((n) => /^data-distill-(media|gallery|lazy|comfort)/.test(n)),
    buttons: document.querySelectorAll("[data-distill-gallery-open]").length,
    styles: document.querySelectorAll("style[data-distill]").length,
  }));
  expect(left).toEqual({ marks: [], buttons: 0, styles: 0 });
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const closed = await look(tab.page);
  expect(closed.lazy.src.startsWith("data:")).toBe(true);
  expect(closed.wide.width).toBe(before.wide.width);
  expect(closed.gallery.shown).toBe(12);
  test.info().annotations.push({ type: "cls", description: `during Clean ${duringClean.toFixed(3)}, after ${afterClean.toFixed(3)}` });
});

test("caption media: a gallery that stays folded comes back folded after Stay clean, and one opened stays open", async ({ distill }) => {
  const tab = await distill.openTab("caption-media");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  expect((await look(tab.page)).gallery.button).toBe("+11 photos");
  await tab.page.locator("[data-distill-gallery-open]").click();
  // A late advert in the column: Stay clean hides it and runs the passes again.
  await tab.page.evaluate(() => {
    const ad = document.createElement("div");
    ad.className = "reklama advert";
    ad.style.cssText = "position:fixed;right:0;bottom:120px;width:300px;height:250px;background:#fc0;z-index:5";
    ad.textContent = "Reklama";
    document.body.append(ad);
  });
  await expect.poll(() => tab.page.locator(".reklama[data-distill-hide]").count(), { timeout: 8000 }).toBe(1);
  const after = await look(tab.page);
  expect(after.gallery.shown).toBe(12);
  expect(after.gallery.button).toBeNull();
});
