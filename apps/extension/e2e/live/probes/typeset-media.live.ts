// Spark round 5 probe: r5-05 the cleaned page typeset and r5-06 pictures in the cleaned page, on the live sites. For
// each site and each build it opens the page in a fresh profile, counts layout shifts (the browser's own layout-shift
// entries, CLS) during Clean (click to first sight) and after it (3 s at the top, then a slow scroll through the page,
// where lazy pictures arrive), and measures the main text: characters a line, line height / size, the gap between
// paragraphs, plus what Clean removed (the same items must go with both builds) and what the picture pass did.
// Screenshots at 1440 and 390 for the four sites the card names.
//   Two builds: E2E_TM_BUILDS="before=<dir>,after=<dir>" (each a built dist-e2e copy); default: this checkout's dist-e2e
//   as "after". Run (after npm run build:e2e):
//   E2E_PROBES=1 E2E_EVIDENCE_DIR=<dir> npx playwright test -c e2e/playwright.live.config.ts typeset-media
// Output: e2e/out/live/probes/typeset-media/metrics.json and JPGs in E2E_EVIDENCE_DIR (r5-05-<site>-<build>[-390].jpg,
// r5-06-<site>-<build>[-390].jpg).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, test, type Frame, type Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "typeset-media");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? join(OUT, "evidence");
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => !only.length || only.includes(s.id));
/** The sites the card wants pictures of. */
const SHOTS: Record<string, string> = { "news-denik": "denik", "news-aktualne": "aktualne", "form-praslavice": "praslavice", "company-pujcovna-smid": "pujcovna-smid" };
const BUILDS: [string, string | null][] = process.env.E2E_TM_BUILDS
  ? process.env.E2E_TM_BUILDS.split(",").map((b) => { const i = b.indexOf("="); return [b.slice(0, i).trim(), b.slice(i + 1).trim()] as [string, string]; })
  : [["after", null]];

/** The main text as laid out now: its longest paragraphs and their neighbours. Runs in the page. */
function reading(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && !el.closest("[data-distill-hide]"); };
    const paras = Array.from(document.querySelectorAll("p, li, td")).filter((p) => visible(p) && (p.textContent ?? "").trim().length >= 120 && !p.closest("nav, footer, header"));
    const longest = [...paras].sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length).slice(0, 6);
    const g = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    const one = (p: Element) => {
      // The element carrying most of its own text sets the font.
      const by = new Map<Element, number>();
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.parentElement && (n.textContent ?? "").trim()) by.set(n.parentElement, (by.get(n.parentElement) ?? 0) + (n.textContent ?? "").length);
      const carrier = Array.from(by).sort((a, b) => b[1] - a[1])[0]?.[0] ?? p;
      const cs = getComputedStyle(carrier);
      const size = parseFloat(cs.fontSize);
      const sample = (p.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const avg = g.measureText(sample).width / sample.length;
      const ps = getComputedStyle(p);
      const textWidth = p.getBoundingClientRect().width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
      const lh = cs.lineHeight === "normal" ? 1.2 * size : parseFloat(cs.lineHeight);
      const next = p.nextElementSibling;
      const gap = next && next.localName === p.localName && visible(next) ? next.getBoundingClientRect().top - p.getBoundingClientRect().bottom : null;
      return { tag: p.localName, size, chars: Math.round(textWidth / avg), lineHeight: Math.round((lh / size) * 100) / 100, gapPx: gap === null ? null : Math.round(gap), gapEm: gap === null ? null : Math.round((gap / size) * 100) / 100 };
    };
    const rows = longest.map(one);
    const med = (xs: number[]) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] as number : null; };
    return {
      paragraphs: rows,
      median: { chars: med(rows.map((r) => r.chars)), lineHeight: med(rows.map((r) => r.lineHeight)), gapEm: med(rows.map((r) => r.gapEm ?? NaN)), size: med(rows.map((r) => r.size)) },
      removed: Array.from(document.querySelectorAll("[data-distill-hide]")).map((e) => `${e.getAttribute("data-distill-hide")}:${e.localName}`).sort(),
      typeset: document.querySelectorAll("[data-distill-comfort-type]").length,
      comfort: document.querySelectorAll("[data-distill-comfort]").length,
      media: {
        fit: document.querySelectorAll('[data-distill-media~="fit"]').length,
        shape: document.querySelectorAll('[data-distill-media~="shape"]').length,
        empty: document.querySelectorAll('[data-distill-media~="empty"]').length,
        more: document.querySelectorAll('[data-distill-media~="more"]').length,
        galleries: Array.from(document.querySelectorAll("[data-distill-gallery-open]")).map((b) => b.textContent),
        captions: document.querySelectorAll("[data-distill-media-caption]").length,
        lazy: document.querySelectorAll("[data-distill-lazy]").length,
      },
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

const countShifts = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __shift: number; __shiftObs?: PerformanceObserver };
  w.__shift = 0;
  w.__shiftObs?.disconnect();
  w.__shiftObs = new PerformanceObserver((list) => {
    for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__shift += e.value;
  });
  w.__shiftObs.observe({ type: "layout-shift", buffered: false });
});
const shifts = (page: Page) => page.evaluate(() => Math.round((window as unknown as { __shift: number }).__shift * 10000) / 10000);

/** Scrolls to the first main-text paragraph (r5-05) or the first large picture of the column (r5-06). */
const scrollTo = (page: Page, what: "text" | "picture") => page.evaluate((w) => {
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && !el.closest("[data-distill-hide]"); };
  let el: Element | undefined;
  if (w === "picture") el = Array.from(document.querySelectorAll("img")).find((i) => visible(i) && i.getBoundingClientRect().width >= 200 && !i.closest("header, nav, footer"));
  el ??= Array.from(document.querySelectorAll("p")).find((p) => visible(p) && (p.textContent ?? "").trim().length >= 120);
  if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 140), behavior: "instant" });
  return !!el;
}, what);

async function shot(page: Page, name: string) {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
}

function extensionCopy(dir: string | null): string {
  if (!dir) return prepareExtension(true, false);
  const ext = mkdtempSync(join(tmpdir(), "distill-e2e-ext-"));
  cpSync(dir, ext, { recursive: true });
  const file = join(ext, "manifest.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  manifest.host_permissions = ["<all_urls>"];
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  return ext;
}

const results: Record<string, Record<string, unknown>> = {};
test.afterAll(() => {
  mkdirSync(PROBE_OUT, { recursive: true });
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(results, null, 2));
});

for (const site of SITES) {
  test(`typeset-media probe: ${site.id}`, async () => {
    test.setTimeout(BUILDS.length * 150_000);
    results[site.id] = {};
    for (const [label, dir] of BUILDS) {
      const ext = extensionCopy(dir);
      const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
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
          results[site.id] = { skipped: resp instanceof Error ? resp.message.split("\n")[0] : `HTTP ${resp?.status()}` };
          return;
        }
        await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
        await page.waitForTimeout(site.settleMs ?? 3000);
        const tabId = await worker.evaluate(async (u) => {
          const tabs = await chrome.tabs.query({});
          return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
        }, page.url());
        await countShifts(page);
        const t0 = Date.now();
        await startCaption(worker, tabId as number);
        const frame: Frame = await captionFrame(page);
        const status = await firstSight(frame);
        const sightMs = Date.now() - t0;
        const clsClean = await shifts(page);
        await countShifts(page);
        await page.waitForTimeout(3000);
        const clsIdle = await shifts(page);
        // A slow scroll through the page: lazy pictures arrive.
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < Math.min(height, 12_000); y += 600) {
          await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
          await page.waitForTimeout(250);
        }
        const clsAfter = await shifts(page);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await settled(page);
        const desktop = await reading(page);
        const name = SHOTS[site.id];
        if (name) {
          if (await scrollTo(page, "text")) await page.waitForTimeout(300);
          await shot(page, `r5-05-${name}-${label}`);
          if (await scrollTo(page, "picture")) await page.waitForTimeout(300);
          await shot(page, `r5-06-${name}-${label}`);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(800);
        await settled(page);
        const phone = await reading(page);
        if (name) {
          if (await scrollTo(page, "text")) await page.waitForTimeout(300);
          await shot(page, `r5-05-${name}-${label}-390`);
          if (await scrollTo(page, "picture")) await page.waitForTimeout(300);
          await shot(page, `r5-06-${name}-${label}-390`);
        }
        // Original: the page's own text, for the comparison.
        await page.setViewportSize({ width: 1440, height: 900 });
        await frame.getByTestId("cap-original").click();
        await frame.getByTestId("cap-back").waitFor();
        await page.waitForTimeout(300);
        const original = await reading(page);
        (results[site.id] as Record<string, unknown>)[label] = { status, sightMs, cls: { clean: clsClean, idle: clsIdle, afterWithScroll: clsAfter }, desktop, phone, original: original.median, errors };
      } finally {
        await context.close();
        rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
        rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  });
}
