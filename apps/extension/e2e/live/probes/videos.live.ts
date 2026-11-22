// Probe for round-1 gap G1 (only the main video is protected): per site, every video on the page, where it is, whether
// it plays, and whether Calm paused it, at first sight and once scrolled to each video (a news site's second video
// starts when it comes into view). Screenshots with the strip: e2e/out/live/probes/videos/<label>/<site>/.
// Run: npx playwright test -c e2e/playwright.live.config.ts probes/videos   (E2E_LIVE_SITES=<ids>; PROBE_LABEL=before|after)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, test, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.PROBE_LABEL || "after";
const ROOT = join(OUT, "live", "probes", "videos");
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["news-denik", "video-kubicek-gulas"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only : DEFAULT).includes(s.id));

/** Every video: its box in the page, playing (its time moves), paused by Calm. Runs in the page. */
function videos(page: Page) {
  return page.evaluate(async () => {
    const all = Array.from(document.querySelectorAll("video"));
    const t0 = all.map((v) => v.currentTime);
    await new Promise((r) => setTimeout(r, 800));
    return all.map((v, i) => {
      const r = v.getBoundingClientRect();
      return {
        i, where: `${v.parentElement?.localName}.${String(v.parentElement?.className ?? "").slice(0, 40)}`,
        top: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height),
        autoplay: v.autoplay, muted: v.muted, playing: !v.paused && v.currentTime > (t0[i] ?? 0), calmPaused: v.hasAttribute("data-distill-paused"),
      };
    });
  });
}

const results: Record<string, unknown> = {};
test.afterAll(() => {
  const file = join(ROOT, "metrics.json");
  mkdirSync(ROOT, { recursive: true });
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown> : {};
  all[LABEL] = results;
  writeFileSync(file, JSON.stringify(all, null, 2));
});

for (const site of SITES) {
  test(`videos: ${site.id}`, async () => {
    const dir = join(ROOT, LABEL, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: { width: 1440, height: 900 }, locale: "cs-CZ",
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required"],
    });
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) ?? await context.waitForEvent("serviceworker");
      if (site.cookies?.length) await context.addCookies(site.cookies.map((c) => ({ path: "/", ...c })));
      const page = await context.newPage();
      for (const p of context.pages()) if (p !== page) await p.close();
      const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
      if (resp instanceof Error || !resp || resp.status() >= 400) { results[site.id] = { skipped: true }; test.skip(true, `${site.id} not reachable`); return; }
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 3000);
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      await startCaption(worker, tabId as number);
      const frame = await captionFrame(page);
      const status = await firstSight(frame);
      const atFirst = await videos(page);
      await page.screenshot({ path: join(dir, "first.png") });
      // Each video in turn, near the top of the window, for 4 s. Scrolled by the mouse wheel after 6 s without any
      // page.evaluate: Playwright evaluates with a user gesture, and a video the page starts within 5 s of one counts
      // as started by the person (Calm leaves it playing).
      const scrolled: unknown[] = [];
      let y = await page.evaluate(() => scrollY);
      await page.mouse.move(720, 400);
      for (const v of [...atFirst].sort((a, b) => a.top - b.top)) {
        // Where the video is now (Clean and widening moved it), read before the quiet time.
        const top = await page.evaluate((i) => { const el = document.querySelectorAll("video")[i]; return el ? el.getBoundingClientRect().top + scrollY : null; }, v.i);
        await page.waitForTimeout(6000);
        const target = Math.max(0, (top ?? v.top) - 120);
        while (Math.abs(target - y) > 4) {
          const step = Math.max(-600, Math.min(600, target - y));
          await page.mouse.wheel(0, step);
          y += step;
          await page.waitForTimeout(250);
        }
        await page.waitForTimeout(4000);
        scrolled.push({ at: v.i, videos: await videos(page), status: await frame.getByTestId("cap-status").textContent() });
        await page.screenshot({ path: join(dir, `video-${v.i}.png`) });
        y = await page.evaluate(() => scrollY);
      }
      results[site.id] = { status, atFirst, scrolled };
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
