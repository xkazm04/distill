// Probe for round 1, W1 (layout): #1 Fill the hole Clean leaves and #6 Comfortable to read, on real sites. For each
// site it measures the main column and the main text with Distill's view and with the original, at 1440 and 390, and
// saves screenshot pairs. Output: e2e/out/live/probes/layout/<site>/ (png) and e2e/out/live/probes/layout/metrics.json.
// Run: npx playwright test -c e2e/playwright.live.config.ts probes/layout   (E2E_LIVE_SITES=<ids> picks sites)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Frame, type Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";

const here = dirname(fileURLToPath(import.meta.url));
/** PROBE_LABEL names the build under test ("before" / "after"): e2e/out/live/probes/layout/<label>/. Unset: no label. */
const LABEL = process.env.PROBE_LABEL;
const OUT_DIR = join(OUT, "live", "probes", "layout", ...(LABEL ? [LABEL] : []));
interface Site { id: string; url: string; settleMs?: number; cookies?: { name: string; value: string; domain: string; path?: string }[] }
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["demo-article", "news-denik", "news-aktualne", "company-dymacek", "company-pujcovna-smid"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only : DEFAULT).includes(s.id));

/** What the probe reads from the page, in one state (Distill's view or the original). Runs in the page. */
interface Look {
  scrollWidth: number;
  innerWidth: number;
  widened: { box: string; left: number; width: number; room: string }[];
  /** The text Comfort changed, or (when it changed nothing) the page's longest paragraphs. */
  text: { el: string; fontSize: number; lineHeight: string; color: string; contrast: number | null; charsPerLine: number; changes: string; text: string }[];
  comfortBlocks: number;
  /** Comfort's rules, as "id": declarations. */
  rules: string[];
  /** The headline's left edge against the main text's (the longest paragraph's): G8, the headline follows the column. */
  headline: { left: number; textLeft: number; offset: number; follows: string | null; fontSize: number } | null;
}

function look(page: Page): Promise<Look> {
  return page.evaluate(() => {
    const lum = (c: number[]) => { const l = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * l(c[0] as number) + 0.7152 * l(c[1] as number) + 0.0722 * l(c[2] as number); };
    const rgba = (s: string) => { const m = /rgba?\(([^)]*)\)/.exec(s); if (!m) return null; const p = (m[1] as string).split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1]; };
    const bgOf = (el: Element): number[] | null => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== "none") return null;
        const c = rgba(cs.backgroundColor);
        if (c && (c[3] as number) > 0.99) return c;
      }
      return [255, 255, 255, 1];
    };
    const name = (el: Element) => `${el.localName}${el.id ? `#${el.id}` : ""}${el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : ""}`;
    const widened = Array.from(document.querySelectorAll("[data-distill-widen]")).map((el) => {
      const r = el.getBoundingClientRect();
      const p = el.parentElement?.getBoundingClientRect();
      return { box: `${name(el)} (${el.getAttribute("data-distill-widen")})`, left: Math.round(r.left), width: Math.round(r.width), room: p ? `${Math.round(p.left)}-${Math.round(p.right)}` : "" };
    });
    const marked = Array.from(document.querySelectorAll("[data-distill-comfort]"));
    const paras = marked.length ? marked : Array.from(document.querySelectorAll("p")).filter((p) => p.getBoundingClientRect().width > 2)
      .sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length).slice(0, 4);
    const text = paras.slice(0, 12).map((el) => {
      // The element carrying most of the block's own text.
      const by = new Map<Element, number>();
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.parentElement && (n.textContent ?? "").trim()) by.set(n.parentElement, (by.get(n.parentElement) ?? 0) + (n.textContent ?? "").length);
      const carrier = Array.from(by).sort((a, b) => b[1] - a[1])[0]?.[0] ?? el;
      const cs = getComputedStyle(carrier);
      const fg = rgba(cs.color), bg = bgOf(carrier);
      const contrast = fg && bg ? (() => { const a = lum(fg), b = lum(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; })() : null;
      const g = document.createElement("canvas").getContext("2d");
      let avg = parseFloat(cs.fontSize) * 0.5;
      const sample = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (g && sample.length > 20) { g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; avg = g.measureText(sample).width / sample.length; }
      const changes = [el, ...Array.from(el.querySelectorAll("[data-distill-comfort-text]"))]
        .map((c) => [c.getAttribute("data-distill-comfort-text"), c.getAttribute("data-distill-comfort-measure")].filter(Boolean).join("+"))
        .filter(Boolean).join(" ");
      return { el: name(el), fontSize: parseFloat(cs.fontSize), lineHeight: cs.lineHeight, color: cs.color, contrast, charsPerLine: Math.round(el.getBoundingClientRect().width / avg), changes, text: (el.textContent ?? "").trim().slice(0, 60) };
    });
    const rules = document.querySelector('style[data-distill="comfort"]')?.textContent?.split("\n").map((l) => l.replace(/^.*\[data-distill-comfort-(text|measure)=/, "")) ?? [];
    const h1 = Array.from(document.querySelectorAll("h1")).find((h) => { const r = h.getBoundingClientRect(); return r.width > 2 && r.height > 2; });
    const longest = Array.from(document.querySelectorAll("p")).filter((p) => p.getBoundingClientRect().width > 2)
      .sort((a, b) => (b.textContent ?? "").length - (a.textContent ?? "").length)[0];
    const headline = h1 && longest ? (() => {
      const left = Math.round(h1.getBoundingClientRect().left), textLeft = Math.round(longest.getBoundingClientRect().left);
      const mark = h1.closest("[data-distill-widen]");
      return { left, textLeft, offset: left - textLeft, follows: mark?.getAttribute("data-distill-widen") ?? null, fontSize: parseFloat(getComputedStyle(h1).fontSize) };
    })() : null;
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, widened, text, comfortBlocks: marked.length, rules, headline };
  });
}

async function original(frame: Frame, page: Page, on: boolean) {
  await frame.getByTestId(on ? "cap-original" : "cap-back").click();
  await frame.getByTestId(on ? "cap-back" : "cap-original").waitFor();
  await page.waitForTimeout(250);
}

const results: Record<string, unknown> = {};
test.afterAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "metrics.json"), JSON.stringify(results, null, 2));
});

for (const site of SITES) {
  test(`layout: ${site.id}`, async () => {
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
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      expect(await startCaption(worker, tabId as number)).toBe(true);
      const frame = await captionFrame(page);
      const status = await firstSight(frame);
      await page.waitForTimeout(500);

      // 1440: Distill's view, then the original (the page as it was, with Clean's removals back).
      // Bring the first changed part into view (the column top for widening, the first changed text for comfort).
      await page.evaluate(() => {
        const el = document.querySelector("[data-distill-comfort]") ?? document.querySelector("[data-distill-widen]");
        if (el) { const top = el.getBoundingClientRect().top + scrollY - 120; scrollTo({ top: Math.max(0, top), behavior: "instant" }); }
      });
      await page.waitForTimeout(200);
      const after = await look(page);
      await page.screenshot({ path: join(dir, "distill-1440.png") });
      await original(frame, page, true);
      const before = await look(page);
      await page.screenshot({ path: join(dir, "original-1440.png") });
      // The headline over the column (G8), as the original has it and as Distill's view has it.
      await page.evaluate(() => {
        const h1 = Array.from(document.querySelectorAll("h1")).find((h) => h.getBoundingClientRect().height > 2);
        if (h1) scrollTo({ top: Math.max(0, h1.getBoundingClientRect().top + scrollY - 60), behavior: "instant" });
      });
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(dir, "headline-original-1440.png") });
      await original(frame, page, false);
      await page.screenshot({ path: join(dir, "headline-distill-1440.png") });

      // The switch in More, when Comfort changed something: off shows the page's own text, on brings the layer back.
      let comfortSwitch: unknown = null;
      if (after.comfortBlocks > 0) {
        await frame.getByTestId("cap-more-btn").click();
        const box = frame.getByTestId("cap-comfort");
        await box.waitFor();
        const line = await frame.getByTestId("cap-comfort-section").textContent();
        await page.screenshot({ path: join(dir, "more-1440.png") });
        await box.click();
        await page.waitForTimeout(200);
        const off = await look(page);
        await box.click();
        await page.waitForTimeout(200);
        comfortSwitch = { line, offFontSize: off.text[0]?.fontSize, onFontSize: (await look(page)).text[0]?.fontSize };
        await frame.getByTestId("cap-more-btn").click();
      }

      // 390: sideways scroll against the page's own width there.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await original(frame, page, true);
      const phoneBefore = await look(page);
      await original(frame, page, false);
      await settled(page);
      const phone = await look(page);
      await page.screenshot({ path: join(dir, "distill-390.png") });

      results[site.id] = {
        status, url: page.url(),
        widened: after.widened.length, comfort: after.comfortBlocks,
        desktop: { before, after },
        phone: { before: phoneBefore, after: phone, addedSidewaysScroll: phone.scrollWidth > Math.max(phoneBefore.scrollWidth, 390) },
        desktopAddedSidewaysScroll: after.scrollWidth > Math.max(before.scrollWidth, 1440),
        comfortSwitch, errors,
      };
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
