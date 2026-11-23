// Probe for the round-1 gap G15 (Clean is fast on very large pages): click to first sight per site, the size of the
// page, and what Clean removed (each removed box named by its tag, id and classes, so two builds can be compared item by
// item). A build with timing marks (a temporary patch, never committed) leaves its per-phase times on <html> as
// `data-distill-timing` (and, comparing two ways of judging on the same page, `data-distill-ab`); the probe saves them
// when they are there. Each site runs E2E_SPEED_RUNS times (default 3) in a fresh profile; the median counts.
// Output: e2e/out/live/probes/speed/<label>/<site>-<run>.png and e2e/out/live/probes/speed/<label>/metrics.json.
// Run: npx playwright test -c e2e/playwright.live.config.ts probes/speed   (PROBE_LABEL=before|after names the build,
// E2E_LIVE_SITES=<ids> picks sites; the extension is the dist-e2e build, so build it first: npm run build:e2e)
//
// r4-02, two builds side by side: E2E_SPEED_BUILDS="before=<dir>,after=<dir>" (each dir a built dist-e2e copy) runs
// every round once per build, back to back, the order swapped each round, so both builds meet the same machine load
// (other browsers on the machine make a single sequential run noisy). Each build writes its own <label>/metrics.json.
// E2E_SPEED_TRACE=1 adds, per run, when the strip's box appeared and moved, when Clean faded and hid, the page's long
// tasks and the strip frame's own load times, all in ms from the click (diagnosis only; the measure is unchanged).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "playwright/test";
import { captionFrame, settled, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.PROBE_LABEL || "after";
const SPEED_OUT = join(OUT, "live", "probes", "speed");
const DEFAULT_SITES = ["video-pohlreich", "video-kubicek-gulas", "news-denik", "news-aktualne", "form-stahlavy"];
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT_SITES.includes(s.id)));
const RUNS = Math.max(1, Number(process.env.E2E_SPEED_RUNS) || 3);
const TRACE = !!process.env.E2E_SPEED_TRACE;
/** The builds to time: label -> a built extension directory (null: the harness's dist-e2e). */
const BUILDS: [string, string | null][] = process.env.E2E_SPEED_BUILDS
  ? process.env.E2E_SPEED_BUILDS.split(",").map((b) => { const i = b.indexOf("="); return [b.slice(0, i).trim(), b.slice(i + 1).trim()] as [string, string]; })
  : [[LABEL, null]];

interface Run {
  /** From the click: the strip opened (the service worker's answer), its frame there, the line shown, first sight. */
  openMs: number;
  frameMs: number;
  lineMs: number;
  firstMs: number;
  /** The click, as a clock time (ms), to place a timed build's clock times. */
  t0: number;
  status: string;
  elements: number;
  /** Each removed box, in document order: "c3 div#masthead.style-scope". */
  removed: string[];
  /** What else Clean changed, by name: the headers let scroll away (unstick) and the boxes widened (widen). */
  unstuck: string[];
  widened: string[];
  /** Per-phase times (ms) and call counts from a build with timing marks; null from a plain build. */
  timing: Record<string, number> | null;
  /** From a build that judged the page two ways at the same moment: whether both found the same, and both lists. */
  ab: unknown;
  errors: string[];
  /** With E2E_SPEED_TRACE=1 only (see the head of this file). */
  trace?: unknown;
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

type Result = { runs: Run[]; medianFirstMs: number; sameRemovedEveryRun: boolean } | { skipped: string };
const results = new Map<string, Record<string, Result>>(BUILDS.map(([label]) => [label, {}]));
test.afterAll(() => {
  for (const [label, res] of results) {
    mkdirSync(join(SPEED_OUT, label), { recursive: true });
    writeFileSync(join(SPEED_OUT, label, "metrics.json"), JSON.stringify(res, null, 2));
  }
});

/** One run of one build on one site, in a fresh profile. Returns the run, or why the site could not be reached. */
async function once(site: Site, label: string, dir: string | null, n: number): Promise<Run | { skipped: string }> {
  const out = join(SPEED_OUT, label);
  mkdirSync(out, { recursive: true });
  let ext: string;
  if (dir) {
    // As prepareExtension does for dist-e2e: a copy with every host granted.
    ext = mkdtempSync(join(tmpdir(), "distill-e2e-ext-"));
    cpSync(dir, ext, { recursive: true });
    const file = join(ext, "manifest.json");
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    manifest.host_permissions = ["<all_urls>"];
    writeFileSync(file, JSON.stringify(manifest, null, 2));
  } else {
    ext = prepareExtension(true, false);
  }
  const profile = mkdtempSync(join(tmpdir(), "distill-speed-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: { width: 1440, height: 900 }, locale: "cs-CZ",
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const errors: string[] = [];
  try {
    const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) ?? await context.waitForEvent("serviceworker");
    if (site.cookies?.length) await context.addCookies(site.cookies.map((c) => ({ path: "/", ...c })));
    const page = await context.newPage();
    for (const p of context.pages()) if (p !== page) await p.close();
    page.on("pageerror", (e) => { if ((e.stack ?? "").includes("chrome-extension://")) errors.push(e.message); });
    const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
    if (resp instanceof Error || !resp || resp.status() >= 400) {
      return { skipped: resp instanceof Error ? resp.message.split("\n")[0] ?? "" : `HTTP ${resp?.status()}` };
    }
    await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(site.settleMs ?? 3000);
    const tabId = await worker.evaluate(async (u) => {
      const tabs = await chrome.tabs.query({});
      return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
    }, page.url());
    const elements = await page.evaluate(() => document.querySelectorAll("*").length);
    if (TRACE) await page.evaluate(installTrace);
    // As the live run times it (caption.live.ts, firstSight): from the click to the first-sight line, once the strip
    // has stopped changing size. On the way: the strip open, its frame there, the line shown.
    const t0 = Date.now();
    expect(await startCaption(worker, tabId as number)).toBe(true);
    const openMs = Date.now() - t0;
    const frame = await captionFrame(page);
    const frameMs = Date.now() - t0;
    const line = frame.getByTestId("cap-status");
    await line.filter({ hasText: /^(Removed|Nothing to remove)/ }).waitFor({ timeout: 15_000 });
    const lineMs = Date.now() - t0;
    await settled(page);
    const firstMs = Date.now() - t0;
    const status = (await line.textContent()) ?? "";
    let trace: unknown;
    if (TRACE) {
      const rel = (t: number) => (t ? Math.round(t - t0) : null);
      const p = await page.evaluate(() => (window as unknown as { __speedTrace: Trace }).__speedTrace);
      // How long one call into the page takes right now (after first sight): the measure's own overhead under load.
      const rt0 = Date.now();
      await page.evaluate(() => 1);
      const roundTrip = Date.now() - rt0;
      // A build with timing marks lists the page requests it served: "<type>@<clock ms>+<ms spent>".
      const reqs = ((await page.evaluate(() => document.documentElement.getAttribute("data-distill-reqs"))) ?? "").split(" ").filter(Boolean)
        .map((r) => { const m = /^(.*)@(\d+)\+(\d+)$/.exec(r); return m ? `${m[1]}@${Number(m[2]) - t0}+${m[3]}` : r; });
      const f = await frame.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        const paint = performance.getEntriesByType("paint").map((e) => [e.name, performance.timeOrigin + e.startTime] as const);
        const marks = performance.getEntriesByType("mark").map((e) => [e.name, performance.timeOrigin + e.startTime] as const);
        return { origin: performance.timeOrigin, dcl: nav ? performance.timeOrigin + nav.domContentLoadedEventEnd : 0, paint, marks };
      });
      trace = {
        host: rel(p.host), fade: rel(p.fade), hide: rel(p.hide),
        moves: p.moves.map(([t, top, h]) => [rel(t), top, h]),
        long: p.long.filter(([t]) => t >= t0 - 50).map(([t, d]) => [rel(t), d]),
        // The page's own load before the click: ms of long tasks in the 2 s before it (nothing of Distill runs then).
        busyBefore2s: p.long.filter(([t, d]) => t + d > t0 - 2000 && t < t0).reduce((n, [t, d]) => n + Math.min(t + d, t0) - Math.max(t, t0 - 2000), 0),
        frameStart: rel(f.origin), frameDcl: rel(f.dcl), framePaint: f.paint.map(([name, t]) => [name, rel(t)]),
        frameMarks: f.marks.map(([name, t]) => [name, rel(t)]),
        roundTrip, ...(reqs.length ? { reqs } : {}),
      };
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${site.id}-${n + 1}.png`) });
    const read = await page.evaluate(() => {
      const name = (el: Element) => `${el.localName}${el.id ? `#${el.id}` : ""}${el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : ""}`;
      const removed = Array.from(document.querySelectorAll("[data-distill-hide]")).map((el) => `${el.getAttribute("data-distill-hide")} ${name(el)}`);
      const raw = document.documentElement.getAttribute("data-distill-timing");
      const ab = document.documentElement.getAttribute("data-distill-ab");
      const unstuck = Array.from(document.querySelectorAll("[data-distill-unstick]")).map((el) => `${el.getAttribute("data-distill-unstick")} ${name(el)}`);
      const widened = Array.from(document.querySelectorAll("[data-distill-widen]")).map(name);
      return { removed, unstuck, widened, timing: raw ? JSON.parse(raw) as Record<string, number> : null, ab: ab ? JSON.parse(ab) as unknown : null };
    });
    return { openMs, frameMs, lineMs, firstMs, t0, status, elements, removed: read.removed, unstuck: read.unstuck, widened: read.widened, timing: read.timing, ab: read.ab, errors, ...(TRACE ? { trace } : {}) };
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
  }
}

interface Trace { host: number; fade: number; hide: number; moves: [number, number, number][]; long: [number, number][] }

/** Runs in the page before the click (E2E_SPEED_TRACE=1): records clock times of the strip's box and Clean's marks. */
function installTrace(): void {
  const now = () => performance.timeOrigin + performance.now();
  const tr: Trace = { host: 0, fade: 0, hide: 0, moves: [], long: [] };
  (window as unknown as { __speedTrace: Trace }).__speedTrace = tr;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) tr.long.push([Math.round(performance.timeOrigin + e.startTime), Math.round(e.duration)]); })
      .observe({ type: "longtask", buffered: true });
  } catch { /* no long-task timing here */ }
  new MutationObserver(() => {
    if (!tr.host && document.querySelector("distill-caption")) tr.host = now();
    if (!tr.fade && document.querySelector("[data-distill-fade]")) tr.fade = now();
    if (!tr.hide && document.querySelector("[data-distill-hide]")) tr.hide = now();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-distill-fade", "data-distill-hide"] });
  let last = "";
  const tick = () => {
    const h = document.querySelector("distill-caption");
    if (h) {
      const r = h.getBoundingClientRect();
      const k = `${Math.round(r.top)},${Math.round(r.height)}`;
      if (k !== last) { last = k; tr.moves.push([now(), Math.round(r.top), Math.round(r.height)]); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

for (const site of SITES) {
  test(`speed: ${site.id}`, async () => {
    // Each run opens a fresh browser and waits for the site to settle (up to 12 s): the config's 150 s is too short.
    test.setTimeout(RUNS * BUILDS.length * 60_000);
    const runs = new Map<string, Run[]>(BUILDS.map(([label]) => [label, []]));
    for (let n = 0; n < RUNS; n++) {
      // Two builds: the order swaps each round, so neither always goes first.
      const order = n % 2 ? [...BUILDS].reverse() : BUILDS;
      for (const [label, dir] of order) {
        const r = await once(site, label, dir, n);
        if ("skipped" in r) {
          for (const [l] of BUILDS) (results.get(l) as Record<string, Result>)[site.id] = r;
          test.skip(true, `${site.id} not reachable`);
          return;
        }
        (runs.get(label) as Run[]).push(r);
      }
    }
    const key = (r: Run) => r.removed.map((s) => s.replace(/^c\d+ /, "")).join("|");
    for (const [label, rs] of runs) {
      (results.get(label) as Record<string, Result>)[site.id] = { runs: rs, medianFirstMs: median(rs.map((r) => r.firstMs)), sameRemovedEveryRun: rs.every((r) => key(r) === key(rs[0] as Run)) };
    }
    expect([...runs.values()].flat().flatMap((r) => r.errors)).toEqual([]);
  });
}
