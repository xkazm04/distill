// Round 3 probe: dark page (r3-06) on the 9 live sites, plus a Wikipedia article under a light and a dark scheme
// (Wikipedia has its own dark mode). Run with
//   E2E_PROBES=1 npx playwright test -c e2e/playwright.live.config.ts dark      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it.) Measured, per site: the main text's contrast before and after (WCAG, on the colours
// really behind each text element; e2e/dark.ts), how many elements were given new colours, whether the page counted as
// dark already, and that off takes every mark and the stylesheet away.
// Output: e2e/out/live/probes/dark/<site>/*.png and metrics.json, one metrics.json for all sites, JPGs for the spark
// board in E2E_EVIDENCE_DIR (r3-06-<site>.jpg).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "../../caption";
import { textContrast } from "../../dark";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "dark");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r3";
const WIKI: Site[] = [
  { id: "wiki-light", useCase: "news", url: "https://cs.wikipedia.org/wiki/Bramborák", lang: "cs", why: "Wikipedia, light scheme", notes: "" } as Site,
  { id: "wiki-dark", useCase: "news", url: "https://cs.wikipedia.org/wiki/Bramborák", lang: "cs", why: "Wikipedia, dark scheme (its own dark mode)", notes: "" } as Site,
];
const ALL = [...(JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[]), ...WIKI];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : true));
const DESKTOP = { width: 1440, height: 900 };
const short = (id: string) => id.replace(/^(news|form|video|company)-/, "");

const marks = (page: Page) => page.evaluate(() => ({
  marked: document.querySelectorAll("[data-distill-dark]").length,
  style: !!document.querySelector('style[data-distill="dark"]'),
  on: document.documentElement.hasAttribute("data-distill-dark-on"),
}));

async function shot(page: Page, dir: string, name: string, evidence?: string) {
  await page.screenshot({ path: join(dir, `${name}.png`) });
  if (!evidence) return;
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${evidence}.jpg`), type: "jpeg", quality: 80 });
  } catch { /* the evidence folder is a convenience of the owner's machine */ }
}

test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as unknown);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
});

for (const site of SITES) {
  test(`dark probe: ${site.id}`, async () => {
    const dir = join(PROBE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    const scheme = site.id === "wiki-dark" ? "dark" : "light";
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: DESKTOP, locale: "cs-CZ", colorScheme: scheme,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const m: Record<string, unknown> = { site: site.id, url: site.url, scheme, at: new Date().toISOString() };
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
      await page.waitForTimeout(1000);
      m.before = await textContrast(page);
      await shot(page, dir, "light");

      await frame.getByTestId("cap-more-btn").click();
      const sw = frame.getByTestId("cap-dark");
      const t0 = Date.now();
      await sw.click();
      await expect(sw).toBeEnabled();
      m.switchMs = Date.now() - t0;
      m.alreadyDark = (await sw.getAttribute("data-already-dark")) === "true";
      m.checked = await sw.isChecked();
      await frame.getByTestId("cap-more-btn").click();
      await settled(page);
      await page.waitForTimeout(600);
      m.marks = await marks(page);
      m.after = await textContrast(page);
      await shot(page, dir, "dark", `r3-06-${short(site.id)}`);

      // Off: every mark and the stylesheet go.
      await frame.getByTestId("cap-more-btn").click();
      await sw.click();
      await expect(sw).not.toBeChecked();
      m.afterOff = await marks(page);
      m.contrastOff = (await textContrast(page)).min;
      expect(await startCaption(worker, tabId)).toBe(false);
      m.afterClose = await marks(page);
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.afterOff).toEqual({ marked: 0, style: false, on: false });
    expect(m.afterClose).toEqual({ marked: 0, style: false, on: false });
  });
}
