// Probe for spark universal-core round 1, W2 "motion" (#3 Stay clean, #4 Things that float, #8 Calm): numbers the live
// run (../caption.live.ts) does not collect yet. Per site: open with no cookies (or the site's own), wait only 3 s (so a
// late pop-up arrives after the caption opened), start the caption, then keep it open 15 s while scrolling, and record
// how the removed count grows, the big overlays left, what Calm paused and whether the main video plays on, sticky
// headers made to scroll, and the share of a 390x844 window covered by fixed boxes with the original page and with
// Distill's. Output: e2e/out/live/probes/motion/<label>/<site>/ (screenshots) and e2e/out/live/probes/motion/metrics.json.
// Run: npx playwright test -c e2e/playwright.live.config.ts probes/motion   (E2E_LIVE_SITES=<ids> to pick sites; the
// extension is the dist-e2e build, so build it first: npm run build:e2e)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, test, type Frame, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
/** PROBE_LABEL names the build under test ("after" by default; "before" for a build of the commit before the feature),
 *  so the same probe can compare two builds: e2e/out/live/probes/motion/<label>/<site>/. */
const LABEL = process.env.PROBE_LABEL || "after";
const MOTION_OUT = join(OUT, "live", "probes", "motion");
const PROBE_OUT = join(MOTION_OUT, LABEL);
const DEFAULT_SITES = ["demo-article", "news-denik", "news-aktualne", "video-pohlreich", "video-kubicek-gulas"];
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT_SITES.includes(s.id)));

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const OPEN_MS = 15_000;

/** The share of the window covered by fixed boxes (and sticky ones stuck where they stick), by sampling a grid of
 *  points. `strip`: count Distill's own strip too. Runs in the page. */
function coveredShare(page: Page, strip: boolean): Promise<number> {
  return page.evaluate((withStrip) => {
    const floats = (el: Element | null): boolean => {
      for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        if (e.localName === "distill-caption") return withStrip;
        const cs = getComputedStyle(e);
        if (cs.position === "fixed") return true;
        if (cs.position === "sticky" && Math.abs(e.getBoundingClientRect().top - (parseFloat(cs.top) || 0)) < 2) return true;
      }
      return false;
    };
    const cols = 26, rows = 52;
    let hit = 0;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (floats(document.elementFromPoint((i + 0.5) * innerWidth / cols, (j + 0.5) * innerHeight / rows))) hit++;
    }
    return hit / (cols * rows);
  }, strip);
}

/** Fixed or sticky boxes over a quarter of the window (a cookie wall or a pop-up left on screen). */
function bigOverlays(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.body.querySelectorAll("*")).filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "sticky") return false;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const q = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(q.right, innerWidth) - Math.max(q.left, 0));
    const h = Math.max(0, Math.min(q.bottom, innerHeight) - Math.max(q.top, 0));
    return w * h >= innerWidth * innerHeight * 0.25;
  }).map((el) => `${el.localName}${el.id ? `#${el.id}` : ""}.${String(el.className).slice(0, 40)}`));
}

/** Every video and audio on the page: playing now (its time moves), muted, its width. */
function mediaState(page: Page) {
  return page.evaluate(async () => {
    const all = Array.from(document.querySelectorAll<HTMLMediaElement>("video, audio"));
    const t0 = all.map((m) => m.currentTime);
    await new Promise((r) => setTimeout(r, 700));
    return all.map((m, i) => ({
      tag: m.localName, width: Math.round(m.getBoundingClientRect().width), muted: m.muted,
      playing: !m.paused && m.currentTime > (t0[i] ?? 0), paused: m.paused, distillPaused: m.hasAttribute("data-distill-paused"),
    }));
  });
}

const removedCount = async (frame: Frame) => Number(/^Removed (\d+)/.exec((await frame.getByTestId("cap-status").textContent()) ?? "")?.[1] ?? 0);

interface ProbeResult {
  site: string; url: string; at: string; status: "ok" | "skipped" | "error"; reason?: string;
  firstSight?: string; firstMs?: number;
  removedAtFirst?: number; removedAfter?: number; timeline?: { s: number; removed: number }[];
  statusAfter?: string; overlaysAtFirst?: string[]; overlaysAfter?: string[];
  calm?: { attr: boolean; stillMarked: number; mediaBefore: unknown; mediaAfter: unknown; section: string | null };
  unstuck?: number; removedLabels?: string[];
  phone?: { originalShare: number; distillShare: number; distillShareWithStrip: number };
  desktop?: { originalShare: number; distillShare: number };
  longTaskMs?: number; extErrors?: string[]; shots: string[];
}

// metrics.json holds one list per label, so a "before" and an "after" run sit side by side.
test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const results = SITES.map((s) => join(PROBE_OUT, s.id, "result.json")).filter(existsSync).map((f) => JSON.parse(readFileSync(f, "utf8")) as ProbeResult);
  const file = join(MOTION_OUT, "metrics.json");
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Record<string, ProbeResult[]> : {};
  all[LABEL] = results;
  writeFileSync(file, JSON.stringify(all, null, 2));
});

for (const site of SITES) {
  test(`motion probe: ${site.id}`, async () => {
    const dir = join(PROBE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-profile-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: DESKTOP, locale: "cs-CZ",
      // PROBE_AUTOPLAY=1 lets videos start with sound and no click (Playwright's Chromium blocks that, like Chrome on a
      // site the person never used), to see Calm leave the main video playing and pause the others.
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...(process.env.PROBE_AUTOPLAY ? ["--autoplay-policy=no-user-gesture-required"] : [])],
    });
    const r: ProbeResult = { site: site.id, url: site.url, at: new Date().toISOString(), status: "error", shots: [] };
    const extErrors: string[] = [];
    let page: Page | null = null;
    const shot = async (name: string) => { await (page as Page).screenshot({ path: join(dir, `${name}.png`) }); r.shots.push(join(dir, `${name}.png`)); };
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      worker.on("console", (m) => { if (m.type() === "error") extErrors.push(`[worker] ${m.text()}`); });
      if (site.cookies?.length) await context.addCookies(site.cookies.map((c) => ({ path: "/", ...c })));
      page = await context.newPage();
      for (const p of context.pages()) if (p !== page) await p.close();
      page.on("console", (m) => { const u = m.location().url; if (m.type() === "error" && (u.startsWith("chrome-extension://") || m.text().includes("chrome-extension://"))) extErrors.push(`[page] ${m.text()} (${u})`); });
      page.on("pageerror", (e) => { if ((e.stack ?? "").includes("chrome-extension://")) extErrors.push(`[page] uncaught: ${e.message}`); });
      const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
      if (resp instanceof Error || !resp || resp.status() >= 400) {
        r.status = "skipped"; r.reason = resp instanceof Error ? resp.message.split("\n")[0] : `HTTP ${resp?.status() ?? "no answer"}`;
        test.skip(true, `${site.id} is not reachable: ${r.reason}`);
        return;
      }
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(3000);
      // Long tasks on the page's main thread from now on (the content script runs there too).
      await page.evaluate(() => {
        (window as unknown as { __lt: number }).__lt = 0;
        new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as unknown as { __lt: number }).__lt += e.duration; }).observe({ type: "longtask" });
      });
      const mediaBefore = await mediaState(page);
      await shot("start");

      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("no tab id");
      const t0 = Date.now();
      await startCaption(worker, tabId);
      const frame = await captionFrame(page);
      r.firstSight = await firstSight(frame);
      r.firstMs = Date.now() - t0;
      r.removedAtFirst = await removedCount(frame);
      r.overlaysAtFirst = await bigOverlays(page);
      await page.waitForTimeout(400);
      await shot("first");

      // 15 s open: scroll down a screen every 3 s (lazy adverts come with scrolling), then back to the top.
      r.timeline = [];
      const started = Date.now();
      for (let s = 1; s <= OPEN_MS / 1000; s++) {
        await page.waitForTimeout(1000);
        if (s % 3 === 0 && s < OPEN_MS / 1000) await page.mouse.wheel(0, 700);
        r.timeline.push({ s, removed: await removedCount(frame) });
      }
      void started;
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(1200);
      r.removedAfter = await removedCount(frame);
      r.statusAfter = (await frame.getByTestId("cap-status").textContent()) ?? "";
      r.overlaysAfter = await bigOverlays(page);
      r.unstuck = await page.evaluate(() => document.querySelectorAll("[data-distill-unstick]").length);
      const mediaAfter = await mediaState(page);
      await shot("after-15s");

      await frame.getByTestId("cap-more-btn").click();
      await page.waitForTimeout(400);
      r.removedLabels = await frame.getByTestId("cap-removed-item").locator("span:first-child").allTextContents();
      const section = frame.getByTestId("cap-calm");
      r.calm = {
        attr: await page.evaluate(() => document.documentElement.hasAttribute("data-distill-calm")),
        stillMarked: await page.evaluate(() => document.querySelectorAll("[data-distill-still]").length),
        mediaBefore, mediaAfter,
        section: (await section.count()) ? await section.textContent() : null,
      };
      await shot("more");
      await frame.getByTestId("cap-more-btn").click();

      r.desktop = { distillShare: await coveredShare(page, false), originalShare: 0 };
      await frame.getByTestId("cap-original").click();
      await frame.getByTestId("cap-back").waitFor();
      await page.waitForTimeout(300);
      r.desktop.originalShare = await coveredShare(page, false);
      await frame.getByTestId("cap-back").click();

      // The phone: the share covered by fixed boxes with the original page and with Distill's.
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(900);
      await frame.getByTestId("cap-original").click();
      await frame.getByTestId("cap-back").waitFor();
      await page.waitForTimeout(400);
      const originalShare = await coveredShare(page, false);
      await shot("phone-original");
      await frame.getByTestId("cap-back").click();
      await page.waitForTimeout(600);
      r.phone = { originalShare, distillShare: await coveredShare(page, false), distillShareWithStrip: await coveredShare(page, true) };
      await shot("phone-distill");
      r.longTaskMs = Math.round(await page.evaluate(() => (window as unknown as { __lt: number }).__lt));
      r.status = "ok";
    } catch (e) {
      if (r.status === "skipped") throw e;
      r.reason = e instanceof Error ? e.message.split("\n")[0] : String(e);
      if (page && !page.isClosed()) await shot("error").catch(() => undefined);
      throw e;
    } finally {
      r.extErrors = extErrors;
      writeFileSync(join(dir, "result.json"), JSON.stringify(r, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
