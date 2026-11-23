// Spark round 5, r5-10 loose end 1: the strip docked with More open at 1280 px on a live page (Aktuálně, where Y5 saw
// page text below the strip's row). The probe walks the steps the strip5 probe took (1440, then 390, then 1280 with
// More open) and measures the strip's box against the window and its frame's content against the box. Run with
//   E2E_PROBES=1 E2E_EVIDENCE_DIR=... npx playwright test -c e2e/playwright.live.config.ts dock   (after npm run build:e2e)
// E2E_EXT_DIR=<unpacked build> runs another build; E2E_LIVE_SITES=<ids> picks sites (default: Aktuálně, Přáslavice).
// Output: r5-10-<site>-docked.jpg (the window, More open) and e2e/out/live/probes/dock/<site>.json.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Frame, type Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "dock");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? join(OUT, "evidence");
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "news-aktualne,form-praslavice").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => only.includes(s.id) || only.includes(s.useCase));
const short = (id: string) => id.replace(/^(news|form|company|video)-/, "");

function extension(): string {
  const from = process.env.E2E_EXT_DIR;
  if (!from) return prepareExtension(true, false);
  const dir = mkdtempSync(join(tmpdir(), "distill-probe-ext-"));
  cpSync(from, dir, { recursive: true });
  const file = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  manifest.host_permissions = ["<all_urls>"];
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  return dir;
}

/** The strip's box in the window, and the frame's content inside it. */
async function measure(page: Page, frame: Frame) {
  const host = await page.evaluate(() => {
    const h = document.querySelector("distill-caption") as HTMLElement;
    const r = h.getBoundingClientRect();
    const below = document.elementFromPoint(innerWidth / 2, innerHeight - 3);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), win: innerHeight, below: below?.localName ?? null,
      zoom: getComputedStyle(document.documentElement).zoom, bodyZoom: document.body ? getComputedStyle(document.body).zoom : null };
  });
  const inner = await frame.evaluate(() => {
    const cap = document.querySelector(".cap") as HTMLElement | null;
    const row = document.querySelector("[data-testid=cap-row]") as HTMLElement | null;
    const more = document.querySelector(".more") as HTMLElement | null;
    const r = (el: Element | null) => { const b = el?.getBoundingClientRect(); return b ? { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) } : null; };
    return { innerHeight, cap: r(cap), row: r(row), more: r(more), moreMax: more?.style.getPropertyValue("--more-max") ?? null,
      moreScroll: more ? { scroll: more.scrollHeight, client: more.clientHeight } : null };
  });
  return { host, inner, gapBelowRow: inner.row ? inner.innerHeight - inner.row.bottom : null };
}

for (const site of SITES) {
  test(`dock probe: ${site.id}`, async () => {
    mkdirSync(PROBE_OUT, { recursive: true });
    const ext = extension();
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: { width: 1440, height: 900 }, locale: "en-GB", reducedMotion: "reduce",
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const m: Record<string, unknown> = { site: site.id, at: new Date().toISOString() };
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      await worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
      const page = await context.newPage();
      for (const p of context.pages()) if (p !== page) await p.close();
      const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
      if (resp instanceof Error || !resp || resp.status() >= 400) { test.skip(true, `${site.id} is not reachable`); return; }
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 3000);
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("no tab");
      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.status = await firstSight(frame, 30_000);
      await page.waitForTimeout(3500);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.waitForTimeout(400);
        await settled(page).catch(() => undefined);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(300);
      m.shut = await measure(page, frame);
      await frame.getByTestId("cap-more-btn").click();
      await frame.getByTestId("cap-more").waitFor();
      const series: unknown[] = [];
      for (let i = 0; i < 8; i++) { await page.waitForTimeout(300); series.push(await measure(page, frame)); }
      m.series = series;
      await settled(page).catch(() => undefined);
      m.open = await measure(page, frame);
      mkdirSync(EVIDENCE, { recursive: true });
      await page.screenshot({ path: join(EVIDENCE, `r5-10-${short(site.id)}-docked.jpg`), type: "jpeg", quality: 85 });
      const open = m.open as Awaited<ReturnType<typeof measure>>;
      expect(open.host.bottom, "the strip reaches the window's bottom").toBe(open.host.win);
      expect(open.gapBelowRow ?? 99, "no page below the row").toBeLessThanOrEqual(2);
    } finally {
      writeFileSync(join(PROBE_OUT, `${site.id}.json`), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
