// Round 1, W1 (layout): #1 Fill the hole Clean leaves, on the demo pages. Hermetic, like the
// rest of this folder; the same features on real sites: live/probes/layout.live.ts.
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
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
