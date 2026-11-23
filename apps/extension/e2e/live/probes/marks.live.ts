// Spark round 5 probe: one mark system (r5-07) on real sites. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/marks      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it.) The e2e build's stand-in model answers, so news pages get claims.
// Per site: the quiet marks that came up (claims, things to do) and the wash Distill chose, the colours under the first
// marked block and every mark's contrast there (markContrast), Show me (the active mark) or the ring on a contact,
// Original and close taking every mark off. Deník also with Dark page on: the wash weighed again on the new colours.
// Output: e2e/out/live/probes/marks/<site>/metrics.json, one metrics.json for all sites, and r5-07-<site>.jpg in
// E2E_EVIDENCE_DIR (default: the owner's .spark folder).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Frame, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import { contrastOf, markColours, marksNow } from "../../marks";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "marks");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r5";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["news-aktualne", "company-dymacek", "news-denik"];
/** Sites shot again with Dark page on. */
const DARK_PAGE = new Set(["news-denik"]);
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const DESKTOP = { width: 1440, height: 900 };
const short = (id: string) => id.replace(/^(news|company|form|video)-/, "");

async function shot(page: Page, dir: string, name: string) {
  await page.screenshot({ path: join(dir, `${name}.png`) });
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
  } catch { /* the evidence folder is a convenience of the owner's machine */ }
}

/** Every trace of the marks: highlight names, attributes, style sheets. */
const traces = (page: Page) => page.evaluate(() => {
  const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const names = Array.from(reg?.keys() ?? []).filter((n) => n.startsWith("distill-"));
  const sel = "[data-distill-claim], [data-distill-action], [data-distill-tour], [data-distill-place], "
    + "#distill-claims-style, #distill-actions-style, #distill-tour-style, #distill-place-style";
  return { names, left: document.querySelectorAll(sel).length };
});

/** The first marked block on screen: scrolled into the upper third. Returns its selector, or null. */
async function firstMarked(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector("[data-distill-action]") ?? document.querySelector("[data-distill-claim]");
    if (!el) return null;
    const box = el.getBoundingClientRect();
    scrollTo(0, Math.max(0, box.top + scrollY - innerHeight / 3));
    el.setAttribute("data-r5-probe", "");
    return "[data-r5-probe]";
  });
}

/** Show me on the first thing to do or claim (the active mark); else the ring on the first contact. */
async function showOne(frame: Frame): Promise<string> {
  const action = frame.getByTestId("cap-action-show");
  if (await action.count()) { await action.first().click(); return "action"; }
  const claim = frame.getByTestId("cap-claim-show");
  if (await claim.count()) { await claim.first().click(); return "claim"; }
  const place = frame.getByRole("button", { name: "Show on page" });
  if (await place.count()) { await place.first().click(); return "place"; }
  return "none";
}

test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as unknown);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
});

for (const site of SITES) {
  test(`marks probe: ${site.id}`, async () => {
    test.setTimeout(180_000);
    const dir = join(PROBE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: DESKTOP, locale: "cs-CZ",
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const m: Record<string, unknown> = { site: site.id, url: site.url, at: new Date().toISOString() };
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
      m.firstSight = await firstSight(frame);
      const chip = frame.getByTestId("cap-chip");
      await expect(chip).not.toHaveAttribute("data-claims-phase", /^(idle|finding)$/, { timeout: 60_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      m.status = await frame.getByTestId("cap-status").textContent();
      const quiet = await marksNow(page);
      m.quiet = quiet;

      const at = await firstMarked(page);
      const colours = at ? await markColours(page, at) : await markColours(page, "main p, article p, p");
      m.measuredOn = at ? "a marked block" : "a paragraph (no quiet mark on this page)";
      m.contrast = colours ? contrastOf(colours) : null;
      if (quiet.wash !== null && m.contrast) m.washMatches = quiet.wash === (m.contrast as { wash: number }).wash;

      await frame.getByTestId("cap-more-btn").click();
      await frame.getByTestId("cap-more").waitFor();
      m.keys = await frame.getByTestId("cap-marks-key").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
      await frame.getByTestId("cap-more-btn").click();
      await page.waitForTimeout(300);
      await page.evaluate(() => scrollTo(0, 0));
      await frame.getByTestId("cap-more-btn").click();
      await frame.getByTestId("cap-more").waitFor();
      m.shown = await showOne(frame);
      await page.waitForTimeout(700);
      m.active = await marksNow(page);
      if (m.shown === "place") {
        m.ring = await page.locator("[data-distill-place]").first().evaluate((el) => {
          const cs = getComputedStyle(el);
          return { outline: cs.outlineColor, shadow: cs.boxShadow };
        }).catch(() => null);
      }
      // Close More so the page shows (the active mark stays 2.4 s).
      await frame.getByTestId("cap-more-btn").click();
      await page.waitForTimeout(250);
      await shot(page, dir, `r5-07-${short(site.id)}`);

      if (DARK_PAGE.has(site.id)) {
        await frame.getByTestId("cap-more-btn").click();
        await frame.getByTestId("cap-more").waitFor();
        await frame.getByTestId("cap-dark").click();
        await page.waitForTimeout(1200);
        const dark = at ? await markColours(page, at) : null;
        m.darkPage = { marks: await marksNow(page), contrast: dark ? contrastOf(dark) : null };
        await page.evaluate(() => scrollTo(0, 0));
        await showOne(frame);
        await page.waitForTimeout(700);
        await frame.getByTestId("cap-more-btn").click();
        await page.waitForTimeout(250);
        await shot(page, dir, `r5-07-${short(site.id)}-darkpage`);
      }

      await page.evaluate(() => document.querySelector("[data-r5-probe]")?.removeAttribute("data-r5-probe"));
      await frame.getByTestId("cap-original").click();
      await frame.getByTestId("cap-back").waitFor();
      await page.waitForTimeout(2800);
      m.inOriginal = (await marksNow(page)).ranges;
      await frame.getByTestId("cap-back").click();
      await page.waitForTimeout(500);
      m.afterBack = (await marksNow(page)).ranges;
      expect(await startCaption(worker, tabId)).toBe(false);
      await page.waitForTimeout(300);
      m.afterClose = await traces(page);
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.inOriginal).toEqual({});
    expect(m.afterClose).toEqual({ names: [], left: 0 });
  });
}
