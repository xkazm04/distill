// Round 3, r3-06: dark page, on the demo pages caption-dark.html (light, with a photo, an SVG logo, a canvas and a
// background picture) and caption-dark-already.html (dark). Text turns readable (4.5:1 or better, measured on what is
// really behind it), pictures keep their colours pixel for pixel, Original shows the page's own colours, off takes
// every mark away, and a dark page is left alone. Hermetic; real sites: live/probes/dark.live.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { textContrast } from "./dark";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};

const PICTURES = ["#photo", "#logo", "#canvas", "#bgpic"];
/** Each picture as rendered, pixel for pixel. */
const pictures = async (page: Page) => {
  const out: Record<string, string> = {};
  for (const sel of PICTURES) {
    const el = page.locator(sel);
    await el.scrollIntoViewIfNeeded();
    out[sel] = (await el.screenshot({ animations: "disabled" })).toString("base64");
  }
  await page.evaluate(() => scrollTo(0, 0));
  return out;
};

/**
 * For each picture: how many of its own pixels (those that were not the white page showing through a transparent part
 * or the 1 px edge) changed colour. Decoded in the page with a canvas.
 */
const changedPixels = (page: Page, before: Record<string, string>, after: Record<string, string>) =>
  page.evaluate(async ({ before, after }) => {
    const pixels = async (b64: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d") as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      return { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
    };
    const out: Record<string, { compared: number; changed: number }> = {};
    for (const key of Object.keys(before)) {
      const a = await pixels(before[key] as string), b = await pixels(after[key] as string);
      let compared = 0, changed = 0;
      for (let y = 1; y < Math.min(a.h, b.h) - 1; y++) for (let x = 1; x < Math.min(a.w, b.w) - 1; x++) {
        const i = (y * a.w + x) * 4, j = (y * b.w + x) * 4;
        if (a.d[i] === 255 && a.d[i + 1] === 255 && a.d[i + 2] === 255) continue; // the page behind a transparent part
        compared++;
        if (Math.abs((a.d[i] as number) - (b.d[j] as number)) + Math.abs((a.d[i + 1] as number) - (b.d[j + 1] as number)) + Math.abs((a.d[i + 2] as number) - (b.d[j + 2] as number)) > 6) changed++;
      }
      out[key] = { compared, changed };
    }
    return out;
  }, { before, after });
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const marks = (page: Page) => page.evaluate(() => ({
  marked: document.querySelectorAll("[data-distill-dark]").length,
  style: !!document.querySelector('style[data-distill="dark"]'),
  on: document.documentElement.hasAttribute("data-distill-dark-on"),
}));

test("caption dark: text reads at 4.5:1 or better, pictures keep their colours, Original and off bring the page back exactly", async ({ distill }) => {
  const tab = await distill.openTab("caption-dark");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(page);
  await firstSight(frame);
  const before = await pictures(page);
  const light = await textContrast(page);
  const main = await page.evaluate(() => (document.querySelector("main") as Element).outerHTML);
  const header = await page.evaluate(() => ({ bg: getComputedStyle(document.getElementById("band") as Element).backgroundColor, fg: getComputedStyle(document.getElementById("brand") as Element).color }));
  expect(await bodyBg(page)).toBe("rgb(255, 255, 255)");

  await frame.getByTestId("cap-more-btn").click();
  const sw = frame.getByTestId("cap-dark");
  await sw.click();
  await expect(sw).toBeChecked();
  await expect.poll(async () => (await marks(page)).on).toBe(true);

  // Dark, and every main text element reads at 4.5:1 or better on what is behind it.
  const dark = await textContrast(page);
  expect(dark.pageLuminance).toBeLessThan(0.05);
  expect(dark.measured).toBeGreaterThanOrEqual(6);
  expect(dark.below, JSON.stringify(dark.worst)).toBe(0);
  expect(dark.min).toBeGreaterThanOrEqual(4.5);
  // The dark band was dark already: its colours stay.
  expect(await page.evaluate(() => ({ bg: getComputedStyle(document.getElementById("band") as Element).backgroundColor, fg: getComputedStyle(document.getElementById("brand") as Element).color }))).toEqual(header);
  // Pictures keep their colours, pixel for pixel (the strip as slim as before, so nothing moved); none is marked.
  await frame.getByTestId("cap-more-btn").click();
  await settled(page);
  const after = await pictures(page);
  const changed = await changedPixels(page, before, after);
  for (const [sel, c] of Object.entries(changed)) {
    if (c.changed > c.compared * 0.01) for (const [k, v] of [["before", before], ["after", after]] as const) writeFileSync(join(OUT, `dark-${sel.slice(1)}-${k}.png`), Buffer.from(v[sel] as string, "base64"));
    expect(c.compared, sel).toBeGreaterThan(100);
    expect(c.changed, `${sel}: ${JSON.stringify(c)}`).toBeLessThanOrEqual(c.compared * 0.01);
  }
  expect(await page.locator("#photo[data-distill-dark], #logo[data-distill-dark], #logo [data-distill-dark], #canvas[data-distill-dark], #bgpic[data-distill-dark]").count()).toBe(0);
  await shot(page, "r3-06-demo");

  // Original: the page's own colours; back: dark again.
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  expect(await bodyBg(page)).toBe("rgb(255, 255, 255)");
  await frame.getByTestId("cap-back").click();
  await expect.poll(() => bodyBg(page)).not.toBe("rgb(255, 255, 255)");

  // Off: every mark and the stylesheet go; the page is as it was.
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-dark").click();
  await expect(frame.getByTestId("cap-dark")).not.toBeChecked();
  expect(await marks(page)).toEqual({ marked: 0, style: false, on: false });
  expect(await page.evaluate(() => (document.querySelector("main") as Element).outerHTML)).toBe(main);
  expect(await bodyBg(page)).toBe("rgb(255, 255, 255)");
  expect((await textContrast(page)).min).toBe(light.min);

  // Kept on the device: on once means on by itself in dark mode; off withdraws it.
  expect(await distill.worker.evaluate(async () => (await chrome.storage.local.get("distill:dark"))["distill:dark"] as unknown)).toEqual({ auto: false });

  // On, then close: everything goes with the strip.
  await frame.getByTestId("cap-dark").click();
  await expect.poll(async () => (await marks(page)).on).toBe(true);
  expect(await distill.worker.evaluate(async () => (await chrome.storage.local.get("distill:dark"))["distill:dark"] as unknown)).toEqual({ auto: true });
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await marks(page)).toEqual({ marked: 0, style: false, on: false });
});

test("caption dark: a page that is dark already is left alone", async ({ distill }) => {
  const tab = await distill.openTab("caption-dark-already");
  const page = tab.page;
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(page);
  await firstSight(frame);
  const main = await page.evaluate(() => (document.querySelector("main") as Element).outerHTML);
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-dark").click();
  await expect(frame.getByTestId("cap-dark-note")).toContainText("dark already");
  await expect(frame.getByTestId("cap-dark")).not.toBeChecked();
  expect(await marks(page)).toEqual({ marked: 0, style: false, on: false });
  expect(await page.evaluate(() => (document.querySelector("main") as Element).outerHTML)).toBe(main);
  expect(await bodyBg(page)).toBe("rgb(18, 20, 23)");
});

test("caption dark: once chosen, it turns on by itself when Chrome is in dark mode", async ({ distill }) => {
  await distill.worker.evaluate(async () => { await chrome.storage.local.set({ "distill:dark": { auto: true } }); });
  const tab = await distill.openTab("caption-dark");
  const page = tab.page;
  // Dark mode for the page and its frames (the strip's frame reads prefers-color-scheme).
  await page.emulateMedia({ colorScheme: "dark" });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await expect.poll(async () => (await marks(page)).on, { timeout: 5_000 }).toBe(true);
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-dark")).toBeChecked();
  await expect(frame.getByTestId("cap-dark-note")).toContainText("by itself");
});
