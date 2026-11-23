// r2-08 Remember this site, end to end: "Always clean this site" in More, the strip opening by itself on the next load
// with the kept choices, Forget, the permission taken back in Chrome's settings, Close until the next load, and never in
// a frame.
//
// Chrome's permission prompt cannot be pressed from Playwright, so the e2e build's stand-in for the site permission is
// switched on first (caption/sitePermission.ts; the service worker's __distillRemember hook): pressing the switch
// "grants" the one origin, revoke() plays the person removing it in Chrome's settings. Everything else is the real code:
// the frame's click, chrome.storage.local, tabs.onUpdated in the service worker, chrome.scripting and the content script.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

/** Screenshots for the review: e2e/out always, and SPARK_EVIDENCE (a folder) as JPG when set. */
const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `caption-remember-${name}.png`) });
  const ev = process.env.SPARK_EVIDENCE;
  if (ev) { mkdirSync(ev, { recursive: true }); await page.screenshot({ path: join(ev, `r2-08-${name}.jpg`), type: "jpeg", quality: 85 }); }
};

interface RememberHook { use(granted?: string[]): Promise<void>; revoke(origin: string): Promise<void>; tabUpdated(tabId: number): Promise<boolean> }
declare global { var __distillRemember: RememberHook | undefined }
const fakePermissions = (worker: Worker) => worker.evaluate(() => {
  if (!globalThis.__distillRemember) throw new Error("No remember hook in the service worker: run the e2e build.");
  return globalThis.__distillRemember.use([]);
});
const revoke = (worker: Worker, origin: string) => worker.evaluate((o) => globalThis.__distillRemember!.revoke(o), origin);
const tabUpdated = (worker: Worker, tabId: number) => worker.evaluate((id) => globalThis.__distillRemember!.tabUpdated(id), tabId);
const granted = (worker: Worker) => worker.evaluate(async () => (await chrome.storage.session.get("distill:e2e:fakeSites"))["distill:e2e:fakeSites"] as string[]);
const kept = (worker: Worker) => worker.evaluate(async () => (await chrome.storage.local.get("distill:sites"))["distill:sites"] as Record<string, unknown> | undefined);

/** No strip comes: waits long enough for an automatic open to have happened (it takes well under a second here). */
async function noStrip(page: Page, ms = 2_000) {
  await page.waitForTimeout(ms);
  await expect(page.locator("distill-caption")).toHaveCount(0);
  expect(page.frames().some((f) => f.url().includes("/caption.html"))).toBe(false);
}

/** Opens the caption with the "click", More, and switches "Always clean this site" on. */
async function rememberSite(worker: Worker, tab: { page: Page; id: number }): Promise<Frame> {
  expect(await startCaption(worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await frame.getByTestId("cap-more-btn").click();
  return frame;
}

async function switchOn(frame: Frame, site: string) {
  const sw = frame.getByTestId("cap-remember-switch");
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();
  await expect(frame.getByTestId("cap-remember-note")).toHaveText(`Distill opens by itself on ${site}. Kept on this device only.`);
}

/** Reloads and waits for the strip to come by itself; returns the frame and ms from the page's load event to first sight. */
async function reloadToStrip(page: Page): Promise<{ frame: Frame; autoMs: number; status: string }> {
  await page.reload();
  const frame = await captionFrame(page);
  const status = await firstSight(frame);
  const autoMs = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return Math.round(performance.now() - nav.loadEventEnd);
  });
  return { frame, autoMs, status };
}

test("remember: switched on, the next load opens the strip by itself, Clean runs, and an item shown again stays shown", async ({ distill, demo }) => {
  await fakePermissions(distill.worker);
  const tab = await distill.openTab("article");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const site = new URL(demo.origin).host;

  // The click path, timed.
  const t0 = Date.now();
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  const clickMs = Date.now() - t0;
  await frame.getByTestId("cap-more-btn").click();

  // Show one removed item again, then remember the site.
  const items = frame.getByTestId("cap-removed-item");
  const label = (await items.first().locator("span").first().textContent()) ?? "";
  expect(label).not.toBe("");
  await items.first().getByRole("button").click();
  await expect(items.first()).toContainText("Back on the page");
  const hiddenBefore = await tab.page.locator("[data-distill-hide]").count();
  await switchOn(frame, site);
  await expect(frame.getByTestId("cap-remember-kept")).toHaveText(`Remembered here: Shown again: ${label}.`);
  expect(await granted(distill.worker)).toEqual([demo.origin]); // that one origin, nothing wider
  expect(Object.keys((await kept(distill.worker)) ?? {})).toEqual([demo.origin]);
  await settled(tab.page);
  await shot(tab.page, "more");

  // Next load: no click. The strip comes, Clean runs, the item is back by itself.
  const { frame: again, autoMs, status } = await reloadToStrip(tab.page);
  expect(status).toMatch(/^Removed \d+ distractions/);
  await expect.poll(() => tab.page.locator("[data-distill-hide]").count()).toBe(hiddenBefore);
  await settled(tab.page);
  await shot(tab.page, "reload"); // the strip came by itself; the item shown again is on the page
  await again.getByTestId("cap-more-btn").click();
  const back = again.getByTestId("cap-removed-item").filter({ hasText: label });
  await expect(back.first()).toContainText("Back on the page");
  await expect(again.getByTestId("cap-remember-switch")).toBeChecked();
  await expect(again.getByTestId("cap-remember-kept")).toContainText(`Shown again: ${label}`);
  // Only one strip, in the top document.
  await expect(tab.page.locator("distill-caption")).toHaveCount(1);
  await settled(tab.page);
  await shot(tab.page, "reload-more");

  // First sight: the click (inject + open + Clean) against the automatic open (load complete -> first sight).
  test.info().annotations.push({ type: "first sight", description: `click ${clickMs} ms, auto-open ${autoMs} ms after load` });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "caption-remember-speed.json"), JSON.stringify({ page: "article.html", clickMs, autoMs }, null, 2));
  expect(autoMs).toBeLessThan(3_000);
});

test("remember: Keep Czech is kept for the site and put back on the next load, without the page flipping", async ({ distill, demo }) => {
  await fakePermissions(distill.worker);
  await distill.worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
  const tab = await distill.openTab("caption-translate");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await expect(frame.getByTestId("cap-status")).toContainText("Translated from Czech", { timeout: 15_000 });
  await frame.getByTestId("cap-keep-source").click();
  await expect(frame.getByTestId("cap-keep-source")).toHaveText("Show English");
  await frame.getByTestId("cap-more-btn").click();
  await switchOn(frame, new URL(demo.origin).host);
  await expect(frame.getByTestId("cap-remember-kept")).toContainText("Kept in Czech, not translated");

  const { frame: again } = await reloadToStrip(tab.page);
  // The page keeps its own words; the translation is one click away.
  await expect(again.getByTestId("cap-keep-source")).toHaveText("Show English", { timeout: 15_000 });
  await expect(tab.page.locator("h1")).not.toContainText("[EN]");
  await again.getByTestId("cap-keep-source").click();
  await expect(tab.page.locator("h1")).toContainText("[EN]");
  // That choice is kept too: translated from now on.
  await again.getByTestId("cap-more-btn").click();
  await expect(again.getByTestId("cap-remember-kept")).toHaveCount(0); // translated is what Distill does anyway
  await expect.poll(async () => Object.values((await kept(distill.worker)) ?? {}).map((e) => (e as { prefs: { translate?: string } }).prefs.translate)).toEqual(["translated"]);
});

test("remember: Easier to read switched off stays off on the next load, and its switch stays", async ({ distill, demo }) => {
  await fakePermissions(distill.worker);
  const tab = await distill.openTab("caption-comfort");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const frame = await rememberSite(distill.worker, tab);
  await frame.getByTestId("cap-comfort").click();
  await expect(frame.getByTestId("cap-comfort")).not.toBeChecked();
  await switchOn(frame, new URL(demo.origin).host);
  await expect(frame.getByTestId("cap-remember-kept")).toContainText("Easier to read: off");

  const { frame: again } = await reloadToStrip(tab.page);
  await again.getByTestId("cap-more-btn").click();
  await expect(again.getByTestId("cap-comfort")).not.toBeChecked();
  await expect(tab.page.locator("html")).toHaveAttribute("data-distill-comfort-off", "");
});

test("remember: Forget gives the site back; the next load opens nothing", async ({ distill, demo }) => {
  await fakePermissions(distill.worker);
  const tab = await distill.openTab("article");
  const frame = await rememberSite(distill.worker, tab);
  await switchOn(frame, new URL(demo.origin).host);
  await frame.getByTestId("cap-remember-forget").click();
  await expect(frame.getByTestId("cap-remember-switch")).not.toBeChecked();
  await expect(frame.getByTestId("cap-remember-note")).toHaveCount(0);
  expect(await granted(distill.worker)).toEqual([]); // the permission went back to Chrome
  expect(await kept(distill.worker)).toBeUndefined(); // nothing kept on the device
  await shot(tab.page, "forget");
  await tab.page.reload();
  await noStrip(tab.page);
});

test("remember: the permission removed in Chrome's settings stops it, and More no longer shows the site as kept", async ({ distill, demo }) => {
  await fakePermissions(distill.worker);
  const tab = await distill.openTab("article");
  const frame = await rememberSite(distill.worker, tab);
  await switchOn(frame, new URL(demo.origin).host);
  await revoke(distill.worker, demo.origin);
  await expect(frame.getByTestId("cap-remember-switch")).not.toBeChecked(); // the strip follows storage
  expect(await kept(distill.worker)).toBeUndefined();
  await tab.page.reload();
  await noStrip(tab.page);
});

test("remember: closed on an auto-opened page it stays closed until the next load", async ({ distill, demo }) => {
  await fakePermissions(distill.worker);
  const tab = await distill.openTab("article");
  const frame = await rememberSite(distill.worker, tab);
  await switchOn(frame, new URL(demo.origin).host);
  const { frame: again } = await reloadToStrip(tab.page);
  await again.getByTestId("cap-more-btn").click();
  await again.getByTestId("cap-close").click();
  await expect(tab.page.locator("distill-caption")).toHaveCount(0);
  await expect(tab.page.locator("[data-distill-hide]")).toHaveCount(0); // everything back, as today
  // The same document "completes" again (a single-page app's next view): no reopen.
  expect(await tabUpdated(distill.worker, tab.id)).toBe(false);
  await noStrip(tab.page, 800);
  // The next load opens it again.
  await reloadToStrip(tab.page);
  await expect(tab.page.locator("distill-caption")).toHaveCount(1);
});

test("remember: never opens in a frame - not in a frame of the remembered site, not in the remembered site framed elsewhere", async ({ distill, demo }) => {
  await fakePermissions(distill.worker);
  const tab = await distill.openTab("framed-form");
  const frame = await rememberSite(distill.worker, tab);
  await switchOn(frame, new URL(demo.origin).host);

  // The remembered site with a frame of its own: one strip, in the top document; none inside the frame.
  await tab.page.reload();
  await captionFrame(tab.page);
  await tab.page.waitForTimeout(1_000);
  await expect(tab.page.locator("distill-caption")).toHaveCount(1);
  const inner = tab.page.frames().find((f) => f.url().includes("/form.html"));
  expect(inner).toBeTruthy();
  expect(await inner!.locator("distill-caption").count()).toBe(0);

  // The remembered site inside another site's page (localhost is another origin): nothing anywhere.
  const port = new URL(demo.origin).port;
  const other = await distill.context.newPage();
  distill.watch(other, "other");
  await other.goto(`http://localhost:${port}/blank.html`);
  await other.evaluate((src) => {
    const f = document.createElement("iframe");
    f.src = src;
    f.style.cssText = "width:100%;height:600px;border:0";
    document.body.append(f);
  }, `${demo.origin}/article.html?framed=1`);
  await other.waitForLoadState("load");
  await other.waitForTimeout(2_000);
  await expect(other.locator("distill-caption")).toHaveCount(0);
  const framed = other.frames().find((f) => f.url().includes("framed=1"));
  expect(framed).toBeTruthy();
  expect(await framed!.locator("distill-caption").count()).toBe(0);
  expect(other.frames().some((f) => f.url().includes("/caption.html"))).toBe(false);
});
