// The caption on real sites: does what the R2-B prototype did on its made-up pages hold on the web as it is? Each site
// in sites.json is opened in a real Chromium with the e2e build of the extension, the caption is started as the
// toolbar click starts it, and the result is measured against the prototype's quality bar (../caption.ts, BAR).
// Output per site in e2e/out/live/<id>/ (screenshots, a video, metrics.json) and one e2e/out/live/report.html.
// See README.md here.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { BAR, baseline, captionFrame, firstSight, measure, settled, shownAgain, startCaption, stripFont, type Measure } from "../caption";
import { LAUNCH, OUT, prepareExtension } from "../harness";
import { writeReport, type Check, type SiteResult } from "./report";

const here = dirname(fileURLToPath(import.meta.url));
const LIVE_OUT = join(OUT, "live");

export interface Site {
  id: string;
  useCase: "news" | "form" | "video" | "company";
  url: string;
  lang: string;
  why: string;
  notes?: string;
  /** Cookies to set before the visit (a consent choice the site needs before it shows the page at all). */
  cookies?: { name: string; value: string; domain: string; path?: string }[];
  /** How long to wait after load for late pop-ups and cookie walls (ms). Default 3000. */
  settleMs?: number;
}

const ALL = JSON.parse(readFileSync(join(here, "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = only.length ? ALL.filter((s) => only.includes(s.id) || only.includes(s.useCase)) : ALL;

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** The verdict of one number against the bar: fail over the hard limit, warn over the soft one. */
function check(name: string, value: number | boolean | string, ok: boolean, warn = false, limit = ""): Check {
  return { name, value: String(value), limit, verdict: ok ? (warn ? "warn" : "pass") : "fail" };
}
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function checksOf(r: { firstMs: number; desktop: Measure; phone: Measure; originalBack: number; font: string; extErrors: string[] }): Check[] {
  const d = r.desktop;
  return [
    check("Distill's share of the window, 1440x900", pct(d.strip.share), d.strip.share <= BAR.shareDesktop, false, `<= ${pct(BAR.shareDesktop)}`),
    check("Distill's share of the window, 390x844", pct(r.phone.strip.share), r.phone.strip.share <= BAR.sharePhone, false, `<= ${pct(BAR.sharePhone)}`),
    check("Strip on top of the page (1440)", d.strip.onTop || d.strip.blockedBy.join(", "), d.strip.onTop, false, "nothing covers it"),
    check("Strip on top of the page (390)", r.phone.strip.onTop || r.phone.strip.blockedBy.join(", "), r.phone.strip.onTop, false, "nothing covers it"),
    check("Click to first sight", `${r.firstMs} ms`, r.firstMs <= BAR.firstSightMs, r.firstMs > BAR.firstSightWarnMs, `<= ${BAR.firstSightWarnMs} ms (fail > ${BAR.firstSightMs})`),
    check("Main text still on screen", pct(d.contentKept), d.contentKept >= BAR.contentKept, d.contentKept < BAR.contentKeptWarn, `>= ${pct(BAR.contentKeptWarn)} (fail < ${pct(BAR.contentKept)})`),
    check("Headline still on screen", d.h1Kept, d.h1Kept, false, "yes"),
    check("Main picture or video still on screen", d.mediaKept, d.mediaKept, false, "yes"),
    check("No sideways scroll added (1440 / 390)", `${d.overflow ? "added" : "none"} / ${r.phone.overflow ? "added" : "none"}`, !d.overflow && !r.phone.overflow, false, "none"),
    check("Distractions removed", d.removed, true, d.removed === 0, ">= 1"),
    check("Big overlays left (cookie walls, pop-ups)", d.overlaysLeft.join(", ") || 0, true, d.overlaysLeft.length > 0, "0"),
    check("Page scrolls", d.scrolls === null ? "short page" : d.scrolls, d.scrolls !== false, false, "yes"),
    check("Original brings everything back", pct(r.originalBack), r.originalBack >= BAR.originalBack, r.originalBack < 1, `100% (fail < ${pct(BAR.originalBack)})`),
    check("Strip in Distill's own font", r.font.split(",")[0] ?? "", r.font.includes("Atkinson Hyperlegible Next"), false, "Atkinson Hyperlegible Next"),
    check("Errors from Distill in the console", r.extErrors.length, r.extErrors.length === 0, false, "0"),
  ];
}

// Each site on its own: one site below the bar must not stop the others (afterAll then writes the report from disk).

test.afterAll(() => {
  if (!existsSync(LIVE_OUT)) return;
  const results = readdirSync(LIVE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(LIVE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(LIVE_OUT, d.name, "metrics.json"), "utf8")) as SiteResult);
  const order = new Map(ALL.map((s, i) => [s.id, i]));
  results.sort((a, b) => (order.get(a.site.id) ?? 99) - (order.get(b.site.id) ?? 99));
  writeReport(join(LIVE_OUT, "report.html"), results);
});

for (const site of SITES) {
  test(`${site.useCase}: ${site.id}`, async () => {
    const dir = join(LIVE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const videoDir = join(dir, "video");
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-live-profile-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel,
      headless: LAUNCH.headless,
      viewport: DESKTOP,
      locale: "cs-CZ",
      recordVideo: { dir: videoDir, size: DESKTOP },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const extErrors: string[] = [];
    const result: SiteResult = { site, at: new Date().toISOString(), status: "skipped", checks: [], shots: [] };
    let page: Page | null = null;
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      worker.on("console", (m) => { if (m.type() === "error") extErrors.push(`[worker] ${m.text()}`); });
      if (site.cookies?.length) await context.addCookies(site.cookies.map((c) => ({ path: "/", ...c })));

      page = await context.newPage();
      for (const p of context.pages()) if (p !== page) await p.close();
      page.on("console", (m) => {
        const where = m.location().url;
        if (m.type() === "error" && (where.startsWith("chrome-extension://") || m.text().includes("chrome-extension://"))) extErrors.push(`[page] ${m.text()} (${where})`);
      });
      page.on("pageerror", (e) => { if ((e.stack ?? "").includes("chrome-extension://")) extErrors.push(`[page] uncaught: ${e.message}`); });

      const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
      if (resp instanceof Error || !resp || resp.status() >= 400) {
        result.reason = resp instanceof Error ? resp.message.split("\n")[0] : `HTTP ${resp?.status() ?? "no answer"}`;
        writeFileSync(join(dir, "metrics.json"), JSON.stringify(result, null, 2));
        test.skip(true, `${site.id} is not reachable: ${result.reason}`);
        return;
      }
      result.finalUrl = page.url();
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 3000);
      const shot = async (name: string) => {
        await (page as Page).screenshot({ path: join(dir, `${name}.png`) });
        result.shots.push(`${name}.png`);
      };
      await shot("start");
      const base = await baseline(page);

      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");

      const t0 = Date.now();
      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      result.firstSight = await firstSight(frame);
      const firstMs = Date.now() - t0;
      await page.waitForTimeout(500); // the fade and the slide-in settle
      await shot("first");
      const desktop = await measure(page, base);

      await frame.getByTestId("cap-more-btn").click();
      await page.waitForTimeout(300);
      await shot("more");
      await frame.getByTestId("cap-more-btn").click();

      await frame.getByTestId("cap-original").click();
      await frame.getByTestId("cap-back").waitFor();
      await page.waitForTimeout(200);
      const originalBack = await shownAgain(page);
      await shot("original");
      await frame.getByTestId("cap-back").click();
      const font = await stripFont(frame);

      // The phone width: the page's own scroll width there (Original on), then Distill's version.
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(600);
      await frame.getByTestId("cap-original").click();
      await frame.getByTestId("cap-back").waitFor();
      const phoneBase = { ...base, scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth), innerWidth: PHONE.width };
      await frame.getByTestId("cap-back").click();
      await settled(page);
      const phone = await measure(page, phoneBase);
      await shot("first-390");

      result.metrics = { firstMs, desktop, phone, originalBack, font, baseline: base };
      result.checks = checksOf({ firstMs, desktop, phone, originalBack, font, extErrors });
      result.extErrors = extErrors;
      result.status = result.checks.some((c) => c.verdict === "fail") ? "fail" : result.checks.some((c) => c.verdict === "warn") ? "warn" : "pass";
    } catch (e) {
      if (result.status === "skipped" && result.reason) throw e; // test.skip: the site was not reachable
      result.status = "fail";
      result.reason = e instanceof Error ? e.message.split("\n")[0] : String(e);
      if (page && !page.isClosed()) await page.screenshot({ path: join(dir, "error.png") }).then(() => result.shots.push("error.png"), () => undefined);
      throw e;
    } finally {
      const video = page?.video();
      await context.close();
      if (video) {
        const from = await video.path().catch(() => null);
        if (from && existsSync(from)) { renameSync(from, join(dir, "run.webm")); result.video = "run.webm"; }
      }
      rmSync(videoDir, { recursive: true, force: true });
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(result, null, 2));
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    const failed = result.checks.filter((c) => c.verdict === "fail");
    expect(failed, `below the bar on ${site.id} (see e2e/out/live/report.html):\n${failed.map((c) => `${c.name}: ${c.value} (want ${c.limit})`).join("\n")}`).toEqual([]);
  });
}
