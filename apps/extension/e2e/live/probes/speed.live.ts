// Probe for the round-1 gap G15 (Clean is fast on very large pages): click to first sight per site, the size of the
// page, and what Clean removed (each removed box named by its tag, id and classes, so two builds can be compared item by
// item). A build with timing marks (a temporary patch, never committed) leaves its per-phase times on <html> as
// `data-distill-timing` (and, comparing two ways of judging on the same page, `data-distill-ab`); the probe saves them
// when they are there. Each site runs E2E_SPEED_RUNS times (default 3) in a fresh profile; the median counts.
// Output: e2e/out/live/probes/speed/<label>/<site>-<run>.png and e2e/out/live/probes/speed/<label>/metrics.json.
// Run: npx playwright test -c e2e/playwright.live.config.ts probes/speed   (PROBE_LABEL=before|after names the build,
// E2E_LIVE_SITES=<ids> picks sites; the extension is the dist-e2e build, so build it first: npm run build:e2e)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "playwright/test";
import { captionFrame, settled, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.PROBE_LABEL || "after";
const PROBE_OUT = join(OUT, "live", "probes", "speed", LABEL);
const DEFAULT_SITES = ["video-pohlreich", "video-kubicek-gulas", "news-denik", "news-aktualne", "form-stahlavy"];
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT_SITES.includes(s.id)));
const RUNS = Math.max(1, Number(process.env.E2E_SPEED_RUNS) || 3);

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
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

const results: Record<string, { runs: Run[]; medianFirstMs: number; sameRemovedEveryRun: boolean } | { skipped: string }> = {};
test.afterAll(() => {
  mkdirSync(PROBE_OUT, { recursive: true });
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(results, null, 2));
});

for (const site of SITES) {
  test(`speed: ${site.id}`, async () => {
    mkdirSync(PROBE_OUT, { recursive: true });
    const runs: Run[] = [];
    for (let n = 0; n < RUNS; n++) {
      const ext = prepareExtension(true, false);
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
          results[site.id] = { skipped: resp instanceof Error ? resp.message.split("\n")[0] ?? "" : `HTTP ${resp?.status()}` };
          test.skip(true, `${site.id} not reachable`);
          return;
        }
        await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
        await page.waitForTimeout(site.settleMs ?? 3000);
        const tabId = await worker.evaluate(async (u) => {
          const tabs = await chrome.tabs.query({});
          return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
        }, page.url());
        const elements = await page.evaluate(() => document.querySelectorAll("*").length);
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
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(PROBE_OUT, `${site.id}-${n + 1}.png`) });
        const read = await page.evaluate(() => {
          const name = (el: Element) => `${el.localName}${el.id ? `#${el.id}` : ""}${el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : ""}`;
          const removed = Array.from(document.querySelectorAll("[data-distill-hide]")).map((el) => `${el.getAttribute("data-distill-hide")} ${name(el)}`);
          const raw = document.documentElement.getAttribute("data-distill-timing");
          const ab = document.documentElement.getAttribute("data-distill-ab");
          const unstuck = Array.from(document.querySelectorAll("[data-distill-unstick]")).map((el) => `${el.getAttribute("data-distill-unstick")} ${name(el)}`);
          const widened = Array.from(document.querySelectorAll("[data-distill-widen]")).map(name);
          return { removed, unstuck, widened, timing: raw ? JSON.parse(raw) as Record<string, number> : null, ab: ab ? JSON.parse(ab) as unknown : null };
        });
        runs.push({ openMs, frameMs, lineMs, firstMs, t0, status, elements, removed: read.removed, unstuck: read.unstuck, widened: read.widened, timing: read.timing, ab: read.ab, errors });
      } finally {
        await context.close();
        rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
        rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
      }
    }
    const key = (r: Run) => r.removed.map((s) => s.replace(/^c\d+ /, "")).join("|");
    results[site.id] = { runs, medianFirstMs: median(runs.map((r) => r.firstMs)), sameRemovedEveryRun: runs.every((r) => key(r) === key(runs[0] as Run)) };
    expect(runs.flatMap((r) => r.errors)).toEqual([]);
  });
}
