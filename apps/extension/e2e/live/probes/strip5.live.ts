// Spark round 5 probe (r5-02, r5-03, r5-08): the strip on the 9 live sites. Run with
//   E2E_PROBES=1 E2E_STRIP_PHASE=before|after npx playwright test -c e2e/playwright.live.config.ts strip5   (after npm run build:e2e)
// E2E_EXT_DIR=<unpacked build> runs another build (the "before" pictures come from master's build); E2E_LIVE_SITES=<ids>
// narrows the sites. The stand-in model answers the AI parts.
// Output, in E2E_EVIDENCE_DIR:
//   r5-03-<site>-<1440|390>-<phase>.jpg   the first line, More shut, at both widths (all 9 sites)
//   r5-02-<site>-<phase>.jpg               More open at 1280 px (Aktuálně, Přáslavice, a YouTube video, Půjčovna Šmíd)
//   r5-08-<site>-half.jpg / -full.jpg      on a phone (390 x 844), the sheet at half and full (the same four; after only)
// and the numbers per site (the line cut or not, the parts and the part More opened on, controls under 44 px) in
// e2e/out/live/probes/strip5/<site>-<phase>/metrics.json.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Frame, type Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "strip5");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? join(OUT, "evidence");
const PHASE = process.env.E2E_STRIP_PHASE ?? "after";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => !only.length || only.includes(s.id) || only.includes(s.useCase));
/** The four kinds of page More and the phone sheet are pictured on. */
const FOUR = ["news-aktualne", "form-praslavice", "video-kubicek-gulas", "company-pujcovna-smid"];
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

const jpg = async (page: Page, name: string, whole = false) => {
  mkdirSync(EVIDENCE, { recursive: true });
  const opts = { path: join(EVIDENCE, `${name}.jpg`), type: "jpeg" as const, quality: 85, animations: "disabled" as const };
  if (whole) await page.screenshot(opts);
  else await page.locator("distill-caption").screenshot(opts);
};

/** The first line: cut anywhere? (an ellipsis, text past its box, a control off screen). Works on both builds. */
const lineCut = (frame: Frame) => frame.evaluate(() => {
  const bad: string[] = [];
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-testid=cap-row] *"));
  for (const el of els) {
    if (el.closest(".fl-measure, .vh")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== "visible") bad.push(`${(el.textContent ?? "").trim().slice(0, 40)}: ${el.scrollWidth}>${el.clientWidth}`);
    if (r.right > innerWidth + 1) bad.push(`${(el.textContent ?? "").trim().slice(0, 40)} off screen`);
  }
  const line = document.querySelector("[data-testid=cap-line]")?.textContent ?? document.querySelector("[data-testid=cap-status]")?.textContent ?? "";
  return { cut: bad, line };
});

const small = (frame: Frame) => frame.evaluate(() => {
  const out: string[] = [];
  const seen = new Set<Element>();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role=tab], [tabindex='0']"))) {
    const t = el.closest("label") ?? el;
    if (seen.has(t)) continue;
    seen.add(t);
    const r = t.getBoundingClientRect();
    if (!r.width || !r.height || t.closest("[hidden], .fl-measure, .vh") || r.bottom < 0 || r.top > innerHeight) continue;
    if (r.width < 43.5 || r.height < 43.5) out.push(`${t.getAttribute("data-testid") ?? t.localName} "${(t.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return { checked: seen.size, small: out };
});

for (const site of SITES) {
  test(`strip5 probe: ${site.id}, ${PHASE}`, async () => {
    const dir = join(PROBE_OUT, `${site.id}-${PHASE}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = extension();
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: { width: 1440, height: 900 }, locale: "en-GB", reducedMotion: "reduce",
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const m: Record<string, unknown> = { site: site.id, phase: PHASE, at: new Date().toISOString() };
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      await worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
      if (site.cookies?.length) await context.addCookies(site.cookies.map((c) => ({ path: "/", ...c })));
      const page = await context.newPage();
      for (const p of context.pages()) if (p !== page) await p.close();
      const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
      if (resp instanceof Error || !resp || resp.status() >= 400) {
        m.skipped = resp instanceof Error ? resp.message.split("\n")[0] : `HTTP ${resp?.status() ?? "no answer"}`;
        test.skip(true, `${site.id} is not reachable: ${String(m.skipped)}`);
        return;
      }
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 3000);
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");
      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.status = await firstSight(frame, 30_000);
      await page.waitForTimeout(3500); // the AI parts, the byline and the things to do answer
      m.statusLater = await frame.getByTestId("cap-status").textContent();

      // r5-03: the first line at 1440 and 390.
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.waitForTimeout(400);
        await settled(page).catch(() => undefined);
        m[`line${width}`] = await lineCut(frame);
        await jpg(page, `r5-03-${short(site.id)}-${width}-${PHASE}`);
      }

      if (FOUR.includes(site.id)) {
        // r5-02: More at 1280.
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForTimeout(300);
        await frame.getByTestId("cap-more-btn").click();
        await frame.getByTestId("cap-more").waitFor();
        await page.waitForTimeout(1200);
        await settled(page).catch(() => undefined);
        m.parts = await frame.getByRole("tab").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid")}${e.getAttribute("aria-selected") === "true" ? "*" : ""}`));
        m.sectionsVisible = await frame.locator("section[data-testid]").evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute("data-testid")));
        await jpg(page, `r5-02-${short(site.id)}-${PHASE}`);
        await frame.getByTestId("cap-more-btn").click();

        // r5-08: the phone sheet (the new build only).
        if (PHASE === "after") {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(400);
          m.rowSmall = await small(frame);
          await frame.getByTestId("cap-more-btn").click();
          await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "half");
          await settled(page).catch(() => undefined);
          m.halfHeight = await page.evaluate(() => Math.round(document.querySelector("distill-caption")?.getBoundingClientRect().height ?? 0));
          m.halfSmall = await small(frame);
          await jpg(page, `r5-08-${short(site.id)}-half`, true);
          await frame.getByTestId("cap-sheet-size").click();
          await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "full");
          await settled(page).catch(() => undefined);
          m.fullHeight = await page.evaluate(() => Math.round(document.querySelector("distill-caption")?.getBoundingClientRect().height ?? 0));
          m.fullSmall = await small(frame);
          await jpg(page, `r5-08-${short(site.id)}-full`, true);
        }
      }
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
