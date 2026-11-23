// Spark round 3 probe (r3-01): the main text that claims, the gist, plain words and the link notes read, and what Clean
// takes away around it, on real news sites. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/maintext      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it; the default is Deník and Aktuálně.)
// No model is needed: the main text is read on the page (distill:caption:mainText, the same message the frame sends).
// Measured: the main text's first blocks (the first must be the article's first paragraph, never the headline, a photo
// credit or a promo box), what is still on screen after Clean that is only an ad label (REKLAMA) or a "follow us on
// Google" promo, and what Clean took away. Output: e2e/out/live/probes/maintext/<site>/*.png and metrics.json, and JPGs
// for the spark board in E2E_EVIDENCE_DIR.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "maintext");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r3";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["news-denik", "news-aktualne"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const DESKTOP = { width: 1440, height: 900 };
const short = (id: string) => id.replace(/^news-/, "");

async function shot(page: Page, dir: string, name: string, evidence?: string) {
  await page.screenshot({ path: join(dir, `${name}.png`) });
  if (!evidence) return;
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${evidence}.jpg`), type: "jpeg", quality: 80 });
  } catch { /* the evidence folder is a convenience of the owner's machine */ }
}

/** What is on screen now that is only an ad label, or a "follow us on Google (News)" promo. Rendered text, so a label
 *  drawn by CSS (::before { content: "REKLAMA" }) counts too. */
const leftovers = (page: Page) => page.evaluate(() => {
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const label = /^(reklama|advertisement|inzerce)$/i;
  const google = /(google\s*(news|zpr[aá]v)|v\s+google\s+na[sš]e\s+[čc]l[aá]nky|sledujte\s+n[aá]s\s+na\s+google)/i;
  const out: { what: string; text: string; tag: string; cls: string; h: number }[] = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (el.closest("distill-caption, [data-distill-hide]")) continue;
    const text = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
    const before = getComputedStyle(el, "::before").content.replace(/^["']|["']$/g, "");
    const after = getComputedStyle(el, "::after").content.replace(/^["']|["']$/g, "");
    const own = text || `${before}${after}`.trim();
    const kind = label.test(own) || (!text && (label.test(before) || label.test(after))) ? "adLabel" : google.test(text) && text.length < 200 ? "googlePromo" : "";
    if (!kind || !shown(el)) continue;
    if (Array.from(el.children).some((c) => ((c as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim() === text && text)) continue; // the innermost only
    out.push({ what: kind, text: own.slice(0, 80), tag: el.tagName.toLowerCase(), cls: String(el.getAttribute("class") ?? "").slice(0, 80), h: Math.round(el.getBoundingClientRect().height) });
  }
  return out;
});

test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as unknown);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
});

for (const site of SITES) {
  test(`main text probe: ${site.id}`, async () => {
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
      // The article's first screen: the headline at the top.
      const toHeadline = () => page.evaluate(() => {
        const h = document.querySelector("h1");
        if (h) scrollTo(0, Math.max(0, h.getBoundingClientRect().top + scrollY - 80));
      });
      await toHeadline();
      await page.waitForTimeout(800);
      m.leftoversBefore = await leftovers(page);
      await shot(page, dir, "before", `r3-01-${short(site.id)}-before`);
      if (process.env.E2E_DUMP_HTML) writeFileSync(join(dir, "page.html"), await page.content());

      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");
      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);
      await page.waitForTimeout(1500);
      m.status = await frame.getByTestId("cap-status").textContent();

      const blocks = await worker.evaluate(async (id) => {
        const res = await chrome.tabs.sendMessage(id, { type: "distill:caption:mainText" }, { frameId: 0 }) as { ok: boolean; data?: { id: string; text: string }[] };
        return res?.ok ? res.data ?? [] : [];
      }, tabId);
      m.mainTextBlocks = blocks.length;
      m.mainTextFirst = blocks.slice(0, 6).map((b) => b.text.slice(0, 160));
      m.mainTextAll = blocks.map((b) => b.text.slice(0, 100));
      m.headline = await page.evaluate(() => (document.querySelector("h1")?.textContent ?? "").replace(/\s+/g, " ").trim());
      m.removed = await page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-hide]"))
        .filter((el) => !el.parentElement?.closest("[data-distill-hide]"))
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".")} :: ${((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 70)}`));
      await toHeadline();
      await page.waitForTimeout(600);
      m.leftoversAfter = await leftovers(page);
      await shot(page, dir, "after", `r3-01-${short(site.id)}-after`);

      expect(await startCaption(worker, tabId)).toBe(false);
      m.hiddenAfterClose = await page.locator("[data-distill-hide]").count();
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.hiddenAfterClose).toBe(0);
  });
}
