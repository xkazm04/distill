// Round 1, W1 (layout): #1 Fill the hole Clean leaves and #6 Comfortable to read, on the demo pages. Hermetic, like the
// rest of this folder; the same features on real sites: live/probes/layout.live.ts.
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

/** A picture of the moment for the review (e2e/out, git-ignored). */
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `caption-layout-${name}.png`) });

/** The article column of caption-reflow.html, its layout box, and how many characters its paragraphs hold a line. */
function column(page: Page) {
  return page.evaluate(() => {
    const a = document.querySelector("article") as HTMLElement;
    const lay = document.querySelector(".layout") as HTMLElement;
    const r = a.getBoundingClientRect();
    const cs = getComputedStyle(lay);
    const lr = lay.getBoundingClientRect();
    const inner = { left: lr.left + parseFloat(cs.paddingLeft), right: lr.right - parseFloat(cs.paddingRight) };
    const p = a.querySelector("p:not(.meta)") as HTMLElement;
    const ps = getComputedStyle(p);
    const g = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    g.font = `${ps.fontStyle} ${ps.fontWeight} ${ps.fontSize} ${ps.fontFamily}`;
    const text = Array.from(a.querySelectorAll("p")).map((x) => x.textContent).join(" ");
    const avg = g.measureText(text).width / text.length;
    return {
      left: Math.round(r.left), width: Math.round(r.width),
      gapLeft: Math.round(r.left - inner.left), gapRight: Math.round(inner.right - r.right),
      chars: Math.round(p.getBoundingClientRect().width / avg),
      widened: document.querySelectorAll("[data-distill-widen]").length,
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

for (const layout of ["grid", "flex", "float"] as const) {
  test(`caption reflow (${layout}): the article grows into the sidebar's room, centred, and gives it back`, async ({ distill }) => {
    const tab = await distill.openTab("caption-reflow");
    await tab.page.setViewportSize({ width: 1440, height: 900 });
    if (layout !== "grid") await tab.page.evaluate((l) => document.documentElement.setAttribute("data-layout", l), layout);
    const before = await column(tab.page);
    expect(before.gapRight).toBeGreaterThan(300); // the sidebar's room, before Clean too

    await startCaption(distill.worker, tab.id);
    const frame = await captionFrame(tab.page);
    expect(await firstSight(frame)).toMatch(/^Removed \d+ distractions/);
    await expect(tab.page.locator("aside.sidebar")).toBeHidden();

    // The column grew (never narrower), its lines are about 70 characters and never past 75, and it sits in the middle.
    const after = await column(tab.page);
    expect(after.widened).toBeGreaterThanOrEqual(1);
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.chars).toBeGreaterThanOrEqual(66);
    expect(after.chars).toBeLessThanOrEqual(75);
    expect(Math.abs(after.gapLeft - after.gapRight)).toBeLessThanOrEqual(2);
    expect(after.sideways).toBe(false);
    await shot(tab.page, `reflow-${layout}-distill`);

    // Original: the page exactly as it was.
    await frame.getByTestId("cap-original").click();
    await frame.getByTestId("cap-back").waitFor();
    expect(await column(tab.page)).toMatchObject({ left: before.left, width: before.width });
    await shot(tab.page, `reflow-${layout}-original`);
    await frame.getByTestId("cap-back").click();
    await expect.poll(async () => (await column(tab.page)).width).toBe(after.width);

    // The phone: the page is one column there, so nothing is widened, and nothing scrolls sideways.
    await tab.page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await column(tab.page)).widened).toBe(0);
    expect((await column(tab.page)).sideways).toBe(false);
    await tab.page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(async () => (await column(tab.page)).width).toBe(after.width);

    // The person brings the sidebar back: the column takes its own width again, the sidebar beside it.
    await frame.getByTestId("cap-more-btn").click();
    await frame.getByRole("button", { name: "Show Sidebar again" }).click();
    await expect(tab.page.locator("aside.sidebar")).toBeVisible();
    expect(await column(tab.page)).toMatchObject({ left: before.left, width: before.width });

    // Close: nothing of it is left on the page.
    expect(await startCaption(distill.worker, tab.id)).toBe(false);
    expect(await tab.page.evaluate(() => document.querySelectorAll("[data-distill-widen], [data-distill-widen-freed], style[data-distill]").length)).toBe(0);
  });
}

test("caption reflow: a column that already fills the page is left alone", async ({ distill }) => {
  const tab = await distill.openTab("article");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  await startCaption(distill.worker, tab.id);
  await firstSight(await captionFrame(tab.page));
  expect(await tab.page.locator("[data-distill-widen]").count()).toBe(0);
  expect(await tab.page.locator('style[data-distill="reflow"]').count()).toBe(0);
});

/** Size, line height, colour and contrast of the main text of caption-comfort.html. Runs in the page. */
function reading(page: Page) {
  return page.evaluate(() => {
    const lum = (s: string) => {
      const [r, g, b] = (/\(([^)]*)\)/.exec(s)?.[1] ?? "0,0,0").split(/[\s,/]+/).map(Number) as [number, number, number];
      const l = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
    };
    const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const of = (sel: string, bg = "rgb(255, 255, 255)") => {
      const el = document.querySelector(sel) as HTMLElement;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      return { size, lineHeight: parseFloat(cs.lineHeight) / size, color: cs.color, contrast: Math.round(ratio(cs.color, bg) * 100) / 100, width: Math.round(el.getBoundingClientRect().width) };
    };
    // Characters a line: the paragraph's width over the average character of its text (in the font of its text).
    const chars = (p: HTMLElement, textEl: HTMLElement) => {
      const g = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
      const ps = getComputedStyle(textEl);
      g.font = `${ps.fontStyle} ${ps.fontWeight} ${ps.fontSize} ${ps.fontFamily}`;
      const text = p.textContent ?? "";
      return Math.round(p.getBoundingClientRect().width / (g.measureText(text).width / text.length));
    };
    const first = document.querySelector("#obsah p") as HTMLElement;
    const font = document.querySelector("#obsah p font") as HTMLElement;
    return {
      p: of("#obsah p"), small: of("#obsah p font"), h1: of("h1"), h2: of("h2"),
      dark: of(".upozorneni", "rgb(43, 43, 43)"), gradient: of(".akce"),
      chars: chars(first, first), smallChars: chars(font.parentElement as HTMLElement, font),
      marked: document.querySelectorAll("[data-distill-comfort]").length,
      sideways: document.documentElement.scrollWidth,
    };
  });
}

test("caption comfort: tiny grey text on long lines becomes 16 px, AA contrast and 75 characters, and the switch turns it off", async ({ distill }) => {
  const tab = await distill.openTab("caption-comfort");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const before = await reading(tab.page);
  expect(before.p.size).toBe(11);
  expect(before.small.size).toBe(10);
  expect(before.p.contrast).toBeLessThan(4.5);
  expect(before.chars).toBeGreaterThan(150);

  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  const after = await reading(tab.page);
  // Size: at least 16 px; relative sizes kept (the headings stay above the text, the small print stays smaller).
  expect(after.p.size).toBeGreaterThanOrEqual(16);
  expect(after.small.size).toBeGreaterThanOrEqual(16);
  expect(after.h1.size).toBeGreaterThan(after.p.size);
  expect(after.h2.size).toBeGreaterThan(after.p.size);
  // Room between lines, line length, contrast.
  expect(after.p.lineHeight).toBeGreaterThanOrEqual(1.49);
  expect(after.small.lineHeight).toBeGreaterThanOrEqual(1.49);
  expect(after.chars).toBeLessThanOrEqual(78);
  expect(after.smallChars).toBeLessThanOrEqual(78);
  expect(after.p.contrast).toBeGreaterThanOrEqual(4.5);
  expect(after.p.contrast).toBeLessThan(5.5); // no darker than it must be
  expect(after.dark.contrast).toBeGreaterThanOrEqual(4.5); // lightened on the dark notice
  expect(after.gradient.color).toBe(before.gradient.color); // over a picture or gradient: left alone
  expect(after.marked).toBeGreaterThanOrEqual(4);

  // More: "Reading", what it did, and the switch, on.
  await frame.getByTestId("cap-more-btn").click();
  const section = frame.getByTestId("cap-comfort-section");
  await expect(section).toContainText("Reading");
  await expect(section).toContainText(`Larger, darker text on ${after.marked} parts of the page`);
  const sw = frame.getByTestId("cap-comfort");
  await expect(sw).toBeChecked();
  await expect(frame.getByLabel("Easier to read")).toBeVisible();
  await settled(tab.page);
  await shot(tab.page, "comfort-on");

  // Off: the page's own text; the switch stays so it can come back on.
  await sw.click();
  await expect(sw).not.toBeChecked();
  await expect.poll(async () => (await reading(tab.page)).p.size).toBe(11);
  await expect(section).toContainText(`on ${after.marked} parts`);
  await shot(tab.page, "comfort-off");
  await sw.click();
  await expect(sw).toBeChecked();
  await expect.poll(async () => (await reading(tab.page)).p.size).toBe(after.p.size);
  await frame.getByTestId("cap-more-btn").click();

  // Original shows the page as it was; Back to Distill brings the layer back.
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  expect((await reading(tab.page)).p).toEqual(before.p);
  await frame.getByTestId("cap-back").click();
  await expect.poll(async () => (await reading(tab.page)).p.size).toBe(after.p.size);

  // The phone: no sideways scroll beyond what the page has on its own.
  await tab.page.setViewportSize({ width: 390, height: 844 });
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  const own = (await reading(tab.page)).sideways;
  await frame.getByTestId("cap-back").click();
  await settled(tab.page);
  expect((await reading(tab.page)).sideways).toBeLessThanOrEqual(own);

  // Close: every attribute and style goes.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await tab.page.evaluate(() => document.querySelectorAll("[data-distill-comfort], [data-distill-comfort-text], [data-distill-comfort-measure], style[data-distill]").length)).toBe(0);
  expect(await tab.page.evaluate(() => document.documentElement.hasAttribute("data-distill-comfort-off"))).toBe(false);
  expect((await reading(tab.page)).p).toEqual(before.p);
});

test("caption comfort: a page that reads well gets nothing, and More has no Reading section", async ({ distill }) => {
  const tab = await distill.openTab("caption-reflow");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  expect(await tab.page.locator("[data-distill-comfort]").count()).toBe(0);
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  await expect(frame.getByTestId("cap-comfort-section")).toHaveCount(0);
});
