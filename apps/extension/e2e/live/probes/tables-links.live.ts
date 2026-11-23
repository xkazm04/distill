// Probe for spark round 2: r2-05 Tables you can read and r2-07 Where does this link go, on real sites. For each site
// it records the data tables Distill changed (and what each gets at 1440 and 390), whether the page scrolls sideways,
// and the notes of a few links of the main text. A Czech Wikipedia list (a stable wikitable) is probed too, since the
// sites of sites.json have few data tables; it is in this probe only, not in sites.json.
// Output: e2e/out/live/probes/tables-links/<site>/ (jpg) and e2e/out/live/probes/tables-links/metrics.json.
// Run: npx playwright test -c e2e/playwright.live.config.ts probes/tables-links   (E2E_LIVE_SITES=<ids> picks sites)
// E2E_EVIDENCE_DIR=<folder> also writes r2-05-wiki.jpg there.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(OUT, "live", "probes", "tables-links");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR;
interface Site { id: string; url: string; settleMs?: number; cookies?: { name: string; value: string; domain: string; path?: string }[] }
const WIKI: Site = { id: "wiki-plzen-jih", url: "https://cs.wikipedia.org/wiki/Seznam_obc%C3%AD_v_okrese_Plze%C5%88-jih", settleMs: 1500 };
const ALL = [...JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[], WIKI];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = only.length ? ALL.filter((s) => only.includes(s.id)) : ALL;

/** The tables Distill changed, and the page's sideways scroll. Runs in the page. */
function tablesNow(page: Page) {
  return page.evaluate(() => ({
    tables: Array.from(document.querySelectorAll("table[data-distill-table]")).map((t) => {
      const r = t.getBoundingClientRect();
      const head = t.querySelector("[data-distill-table-head]");
      return {
        id: t.getAttribute("data-distill-table"),
        cols: Math.max(0, ...Array.from((t as HTMLTableElement).rows).slice(0, 5).map((row) => row.cells.length)),
        rows: (t as HTMLTableElement).rows.length,
        head: head?.localName ?? null,
        cards: t.hasAttribute("data-distill-table-cards"),
        wide: t.hasAttribute("data-distill-table-wide"),
        tall: t.hasAttribute("data-distill-table-tall"),
        width: Math.round(r.width), height: Math.round(r.height),
        firstHeader: (head?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      };
    }),
    allTables: document.querySelectorAll("table").length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  }));
}

/** The note on screen, or null. The e2e build opens the note's shadow root. Runs in the page. */
const noteText = (page: Page) => page.evaluate(() => {
  const host = document.querySelector("distill-link-note") as HTMLElement | null;
  if (!host || getComputedStyle(host).visibility !== "visible") return null;
  const box = host.shadowRoot?.querySelector(".note");
  return box ? Array.from(box.children).map((c) => c.textContent).join(" | ") : "";
});

/** Points at up to `max` links of the page that are shown, in order, and records what their notes say. */
async function probeLinks(page: Page, max: number) {
  const links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a, i) => {
    a.setAttribute("data-probe-link", String(i));
    const r = a.getBoundingClientRect();
    const shown = r.width > 4 && r.height > 4 && getComputedStyle(a).visibility !== "hidden";
    return { i, shown, href: (a.getAttribute("href") ?? "").slice(0, 160), text: (a.textContent ?? "").trim().slice(0, 50) };
  }).filter((l) => l.shown && l.text));
  const notes: { href: string; text: string; note: string | null }[] = [];
  let tried = 0;
  for (const l of links) {
    if (notes.filter((n) => n.note).length >= max || tried >= 40) break;
    tried++;
    const loc = page.locator(`[data-probe-link="${l.i}"]`);
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
      await page.mouse.move(2, 2);
      await loc.hover({ timeout: 2000 });
      await page.waitForTimeout(650);
      notes.push({ href: l.href, text: l.text, note: await noteText(page) });
    } catch { /* covered or gone: next */ }
  }
  await page.evaluate(() => document.querySelectorAll("[data-probe-link]").forEach((a) => a.removeAttribute("data-probe-link")));
  return { tried, withNote: notes.filter((n) => n.note).length, notes };
}

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "metrics.json"), JSON.stringify(results, null, 2));
});

for (const site of SITES) {
  test(`tables-links: ${site.id}`, async () => {
    const dir = join(OUT_DIR, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
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
        test.skip(true, `${site.id} not reachable`);
        return;
      }
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 3000);
      const before = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, tables: document.querySelectorAll("table").length }));
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      expect(await startCaption(worker, tabId as number)).toBe(true);
      const frame = await captionFrame(page);
      const status = await firstSight(frame);
      await page.waitForTimeout(500);

      const desktop = await tablesNow(page);
      // The first changed table, scrolled so its middle is at the top: its header should be in view.
      let sticky: unknown = null;
      if (desktop.tables.length) {
        sticky = await page.evaluate(async () => {
          const t = document.querySelector("table[data-distill-table-tall]") ?? document.querySelector("table[data-distill-table]") as Element;
          const top = t.getBoundingClientRect().top + scrollY;
          scrollTo({ top: top + Math.min(600, t.getBoundingClientRect().height / 2), behavior: "instant" });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const head = t.querySelector("[data-distill-table-head]");
          const r = head?.getBoundingClientRect();
          return r ? { headTop: Math.round(r.top), headInView: r.top >= 0 && r.bottom <= innerHeight, tall: t.hasAttribute("data-distill-table-tall") } : null;
        });
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(dir, "tables-1440.jpg"), type: "jpeg", quality: 75 });
        if (EVIDENCE && site.id === WIKI.id) { mkdirSync(EVIDENCE, { recursive: true }); await page.screenshot({ path: join(EVIDENCE, "r2-05-wiki.jpg"), type: "jpeg", quality: 80 }); }
      }
      // The switch line in More.
      await frame.getByTestId("cap-more-btn").click();
      const section = (await frame.getByTestId("cap-tables-section").textContent().catch(() => null)) ?? null;
      await frame.getByTestId("cap-more-btn").click();
      await settled(page);
      await page.evaluate(() => scrollTo(0, 0));

      const links = await probeLinks(page, 4);

      // 390: cards and sideways scroll, against the original page at 390.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await frame.getByTestId("cap-original").click();
      await frame.getByTestId("cap-back").waitFor();
      await page.waitForTimeout(250);
      const phoneOriginal = await page.evaluate(() => document.documentElement.scrollWidth);
      await frame.getByTestId("cap-back").click();
      await page.waitForTimeout(400);
      const phone = await tablesNow(page);
      if (phone.tables.length) {
        await page.evaluate(() => document.querySelector("table[data-distill-table]")?.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(dir, "tables-390.jpg"), type: "jpeg", quality: 75 });
        if (EVIDENCE && site.id === WIKI.id) await page.screenshot({ path: join(EVIDENCE, "r2-05-wiki-390.jpg"), type: "jpeg", quality: 80 });
      }

      results[site.id] = {
        status, url: page.url(),
        tables: desktop.tables.length, allTables: before.tables, switch: section,
        desktop: { ...desktop, addedSidewaysScroll: desktop.scrollWidth > Math.max(before.scrollWidth, 1440) }, sticky,
        phone: { ...phone, addedSidewaysScroll: phone.scrollWidth > Math.max(phoneOriginal, 390) },
        links, errors,
      };
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
