// Spark round 5, r5-10: round 5's loose ends, each with a test that failed before its fix.
// 2. caption-tables: the widened main column came out 900 or 860 px at first sight depending on timing, and 764 px
//    after a resize. The widen rule (caption/reflow.ts) took its measure from the narrow timetable, whose width grows
//    when Translate and Prices and dates change its cells, and read the page once before the reading layer ran and
//    later after it. It now takes the measure from the running text (paragraphs), keeps the first character width, and
//    reads the page with the reading layer off for that moment: every look reads the same width.
// 1. More open and held at its cap (Aktuálně at 1280 px): the frame's content ended 1 px short of the strip's box, so a
//    line of the page showed under the row. More's height now counts its own border; the row sits on the bottom edge.
import type { Frame, Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { type Distill, expect, test } from "./harness";

async function open(distill: Distill, name: string, size: { width: number; height: number }) {
  await distill.worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
  const tab = await distill.openTab(name);
  await tab.page.setViewportSize(size);
  await tab.page.emulateMedia({ reducedMotion: "reduce" });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  return { page: tab.page, frame };
}

const columnWidth = (page: Page) => page.evaluate(() => Math.round(document.querySelector("main")?.getBoundingClientRect().width ?? 0));

test("loose end 2: caption-tables widens to one width - at first sight, after the reading layer ran, after a resize, every time", async ({ distill }) => {
  const widths: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { page } = await open(distill, "caption-tables", { width: 1440, height: 900 });
    await page.waitForTimeout(600); // what runs after first sight (prices and dates, Stay clean)
    widths.push(await columnWidth(page));
    // A resize to the same size measures again (reflow.ts on resize), with the reading layer on the page by now.
    await page.evaluate(() => dispatchEvent(new Event("resize")));
    await page.waitForTimeout(500);
    widths.push(await columnWidth(page));
    // Narrower and back: the same width again.
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForTimeout(500);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    widths.push(await columnWidth(page));
    await page.close();
  }
  expect(new Set(widths).size, `widths: ${widths.join(", ")}`).toBe(1);
  // Its own measure is set by its paragraphs (760 px of 16 px Verdana is already past 70 characters), not by the narrow
  // timetable; the column moves into the middle of the room the sidebar left.
  expect(widths[0]).toBe(760);
});

test("loose end 2: the column reflowed on caption-tables sits in the middle of the freed room", async ({ distill }) => {
  const { page } = await open(distill, "caption-tables", { width: 1440, height: 900 });
  const at = await page.evaluate(() => {
    const m = (document.querySelector("main") as Element).getBoundingClientRect();
    const w = document.querySelector(".wrap") as Element;
    const r = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    const left = r.left + parseFloat(cs.paddingLeft), right = r.right - parseFloat(cs.paddingRight);
    return { off: Math.round((m.left + m.right) / 2 - (left + right) / 2), widen: document.querySelector("main")?.getAttribute("data-distill-widen") };
  });
  expect(at.widen).toBe("w0");
  expect(Math.abs(at.off)).toBeLessThanOrEqual(2);
});

/** The strip's box in the window, and how much of the frame (transparent: the page shows through) is left below the
 *  strip's own content. */
async function dock(page: Page, frame: Frame) {
  const host = await page.evaluate(() => {
    const r = (document.querySelector("distill-caption") as HTMLElement).getBoundingClientRect();
    return { bottom: r.bottom, height: r.height, win: innerHeight };
  });
  const gap = await frame.evaluate(() => innerHeight - (document.querySelector("[data-testid=cap-row]") as HTMLElement).getBoundingClientRect().bottom);
  return { ...host, gap };
}

test("loose end 1: More open and clamped at 1280 px - the strip's row sits on the window's bottom edge, no page pixel below it", async ({ distill }) => {
  const { page, frame } = await open(distill, "caption-parts", { width: 1280, height: 900 });
  await expect(frame.getByTestId("cap-status")).toContainText("claims to check", { timeout: 15_000 });
  const shut = await dock(page, frame);
  expect(shut.bottom).toBe(shut.win);
  expect(shut.gap).toBeLessThan(0.5);
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  await expect(frame.getByTestId("cap-gist")).toHaveAttribute("data-phase", "ready");
  // Every part, so More is held at its cap (45% of the window) and scrolls inside: the row stays on the bottom edge.
  for (const tab of await frame.getByRole("tab").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""))) {
    await frame.getByTestId(tab).click();
    await page.waitForTimeout(300);
    await settled(page);
    const opened = await dock(page, frame);
    expect(opened.bottom, `${tab}: ${JSON.stringify(opened)}`).toBe(opened.win);
    // Before the fix the frame's content ended 1 px short of its box (More's own border left out of its height), and
    // a line of the page's text showed under the row (Aktuálně, r5-02's pictures).
    expect(opened.gap, `${tab}: ${JSON.stringify(opened)}`).toBeLessThan(0.5);
  }
  expect((await dock(page, frame)).height).toBeGreaterThan(400); // clamped at 45% of 900
});
