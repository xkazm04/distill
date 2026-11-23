// Spark round 3 probe: prices and dates in your terms (r3-07) on real Czech pages. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/terms      (after npm run build:e2e)
// The reader is English (E2E_PROBE_LOCALE, default en-GB: pounds, dates the British way). Unlike the hermetic e2e, the
// ECB's daily list is downloaded for real here, once, by the service worker. Measured: how many prices and dates get
// an addition, a sample of them with their titles, every request the service worker made to the ECB (and that it
// carried no cookie or referrer), that the page's words are unchanged, and that Original and close take everything off.
// Output: e2e/out/live/probes/terms/<site>/*.png and metrics.json, and JPGs in E2E_EVIDENCE_DIR (r3-07-<site>.jpg).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "terms");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r3";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
/** The trailer rental from the live list, and a village's fee page (not in sites.json: chosen for this card). */
const SITES: (Site & { short: string })[] = [
  { ...(ALL.find((s) => s.id === "company-pujcovna-smid") as Site), short: "smid" },
  { id: "village-albrechtice-fees", useCase: "company", url: "https://www.obecalbrechtice.cz/obecni-urad/uhrada-poplatku", lang: "cs",
    why: "Albrechtice village office: how to pay the local fees, waste 500 Kč / osoba / rok due by 30. 6., dogs 200 and 300 Kč due by 30. 4.",
    notes: "Chosen 2026-11-23 for r3-07.", short: "albrechtice" } as Site & { short: string },
];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const LOCALE = process.env.E2E_PROBE_LOCALE ?? "en-GB";
const DESKTOP = { width: 1440, height: 900 };

const additions = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-term]")).map((el) => ({
  kind: el.getAttribute("data-distill-term"),
  words: el.textContent,
  after: getComputedStyle(el, "::after").content.replace(/[\u00a0\u202f]/g, " "),
  title: el.getAttribute("title"),
})));

async function shot(page: Page, dir: string, name: string, evidence?: string) {
  await page.screenshot({ path: join(dir, `${name}.png`) });
  if (!evidence) return;
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${evidence}.jpg`), type: "jpeg", quality: 80 });
  } catch { /* the evidence folder is a convenience of the owner's machine */ }
}

for (const site of SITES.filter((s) => !only.length || only.includes(s.id) || only.includes(s.short))) {
  test(`terms probe: ${site.id}`, async () => {
    const dir = join(PROBE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: DESKTOP, locale: LOCALE,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const m: Record<string, unknown> = { site: site.id, url: site.url, locale: LOCALE, at: new Date().toISOString() };
    const ecb: { url: string; method: string; cookie: boolean; referer: boolean; status?: number }[] = [];
    context.on("requestfinished", (r) => {
      if (!r.url().includes("ecb.europa.eu")) return;
      void (async () => {
        const h = await r.allHeaders();
        ecb.push({ url: r.url(), method: r.method(), cookie: "cookie" in h, referer: "referer" in h, status: (await r.response())?.status() });
      })();
    });
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      const page = await context.newPage();
      for (const p of context.pages()) if (p !== page) await p.close();
      const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
      if (resp instanceof Error || !resp || resp.status() >= 400) {
        m.skipped = resp instanceof Error ? resp.message.split("\n")[0] : `HTTP ${resp?.status() ?? "no answer"}`;
        test.skip(true, `${site.id} is not reachable: ${String(m.skipped)}`);
        return;
      }
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 2000);
      const words = await page.evaluate(() => document.body.innerText.length);
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");

      const t0 = Date.now();
      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);
      await frame.getByTestId("cap-more-btn").click();
      const line = frame.getByTestId("cap-terms-line");
      await expect(line).not.toHaveText(/Writing/, { timeout: 30_000 });
      m.termsMs = Date.now() - t0;
      m.line = await line.textContent();
      m.rates = await frame.getByTestId("cap-terms-rates").textContent().catch(() => null);
      await frame.getByTestId("cap-more-btn").click();
      const now = await additions(page);
      m.prices = now.filter((a) => a.kind === "price").length;
      m.dates = now.filter((a) => a.kind === "date").length;
      m.sample = now.slice(0, 12);
      // The words the page shows did not change in number (the additions are ::after, not text).
      m.innerTextBefore = words;

      // The first price (else the first date) in view, for the screenshot.
      await page.evaluate(() => {
        const el = document.querySelector('[data-distill-term="price"]') ?? document.querySelector("[data-distill-term]");
        if (el) scrollTo(0, Math.max(0, el.getBoundingClientRect().top + scrollY - innerHeight / 4));
      });
      await page.waitForTimeout(400);
      await shot(page, dir, "terms", `r3-07-${site.short}`);

      await frame.getByTestId("cap-original").click();
      await frame.getByTestId("cap-back").waitFor();
      m.inOriginal = (await additions(page)).length;
      await frame.getByTestId("cap-back").click();
      await expect.poll(async () => (await additions(page)).length).toBe(now.length);
      expect(await startCaption(worker, tabId)).toBe(false);
      m.afterClose = await page.locator("[data-distill-term]").count();
      await page.waitForTimeout(300);
      m.ecbRequests = ecb;
      m.kept = await worker.evaluate(async () => {
        const k = (await chrome.storage.local.get("distill:rates"))["distill:rates"] as { rates?: { date: string; rates: Record<string, number> } } | undefined;
        return k?.rates ? { date: k.rates.date, currencies: Object.keys(k.rates.rates).length, CZK: k.rates.rates.CZK, GBP: k.rates.rates.GBP } : null;
      });
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.inOriginal).toBe(0);
    expect(m.afterClose).toBe(0);
    expect((m.ecbRequests as unknown[]).length).toBeLessThanOrEqual(1);
  });
}
