// Plain words in place (r2-04) on real sites. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/plain      (after npm run build:e2e)
// The e2e build has no model, so the stand-in model answers (each block "[PLAIN] " + its words): what is measured is the
// mechanism on a real page - which blocks are rewritten, that the facts door lets the stand-in's rewrites through (they
// keep every word), that forms are never touched, and that As written, Original and close bring back every word
// exactly. The reader reads Czech here (locale cs-CZ), so Translate does not start and Plain rewrites the page's words.
// Output: e2e/out/live/probes/plain/<site>/*.png and metrics.json, one metrics.json for all sites, and a JPG per site in
// the spark evidence folder.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { baseline, captionFrame, firstSight, measure, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "plain");
const EVIDENCE = "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r2";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["news-aktualne", "form-praslavice"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const DESKTOP = { width: 1440, height: 900 };
const TYPED = "E2E-probe 4711";

/** Every element that could be a block, marked with its index, with its markup and words before Distill. Page side. */
function snapshot(page: Page) {
  return page.evaluate(() => {
    const leaf = (el: Element) => !el.querySelector("p, div, section, article, ul, ol, dl, table, figure, blockquote, header, footer, nav, aside, form, h1, h2, h3, h4, h5, h6");
    const els = Array.from(document.body.querySelectorAll("p, li, dt, dd, td, th, caption, figcaption, blockquote, h1, h2, h3, h4, h5, h6, summary, legend, div, section"))
      .filter((el) => !/^(div|section)$/.test(el.localName) || leaf(el));
    return els.map((el, i) => { el.setAttribute("data-e2e-i", String(i)); return { html: el.innerHTML, text: el.textContent ?? "" }; });
  });
}

const now = (page: Page, sel: string) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((el) => ({
  i: Number(el.getAttribute("data-e2e-i") ?? -1), html: el.innerHTML, text: el.textContent ?? "",
})), sel);

const strip = (html: string) => html.replace(/\s(data-distill-[a-z-]+|data-e2e-[a-z0-9-]+)(="[^"]*")?/g, "").replace(/ style=""/g, "");

const formsNow = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll("form")).map((f) => ({
  text: f.textContent ?? "",
  values: Array.from(f.querySelectorAll("input, textarea, select")).map((c) => (c as HTMLInputElement).value),
})));

test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as unknown);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
});

for (const site of SITES) {
  test(`plain probe: ${site.id}`, async () => {
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
    const extErrors: string[] = [];
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      await worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
      if (site.cookies?.length) await context.addCookies(site.cookies.map((c) => ({ path: "/", ...c })));
      const page = await context.newPage();
      for (const p of context.pages()) if (p !== page) await p.close();
      page.on("console", (msg) => {
        const where = msg.location().url;
        if (msg.type() === "error" && (where.startsWith("chrome-extension://") || msg.text().includes("chrome-extension://"))) extErrors.push(`${msg.text()} (${where})`);
      });
      const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
      if (resp instanceof Error || !resp || resp.status() >= 400) {
        m.skipped = resp instanceof Error ? resp.message.split("\n")[0] : `HTTP ${resp?.status() ?? "no answer"}`;
        test.skip(true, `${site.id} is not reachable: ${String(m.skipped)}`);
        return;
      }
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 3000);
      const base = await baseline(page);
      const before = await snapshot(page);
      m.typedInto = await page.evaluate((v) => {
        const f = Array.from(document.querySelectorAll("form textarea, form input[type=text]")).find((el) => (el as HTMLElement).offsetParent !== null) as HTMLInputElement | undefined;
        if (!f) return null;
        f.value = v;
        return f.name || f.id || f.localName;
      }, TYPED);
      const formsBefore = await formsNow(page);

      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");
      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);
      const chip = frame.getByTestId("cap-chip");
      const plain = frame.getByTestId("cap-plain");
      await plain.waitFor({ timeout: 15_000 });
      await expect(page.locator("[data-distill-plain]")).toHaveCount(0); // never by itself

      const t0 = Date.now();
      await plain.click();
      await expect(chip).not.toHaveAttribute("data-plain", "working", { timeout: 60_000 });
      await expect(chip).toHaveAttribute("data-plain", /^(on|failed)$/);
      m.plainMs = Date.now() - t0;
      m.phase = await chip.getAttribute("data-plain");
      m.status = await frame.getByTestId("cap-status").textContent();
      m.blocks = await chip.getAttribute("data-plain-blocks");
      m.lost = Number((await chip.getAttribute("data-plain-lost")) ?? 0);
      m.dropped = Number((await chip.getAttribute("data-plain-dropped")) ?? 0);
      m.chip = { text: await chip.textContent(), src: await chip.getAttribute("data-src"), title: await chip.getAttribute("title") };
      const rewritten = await now(page, "[data-distill-plain]");
      m.plainOnPage = rewritten.length;
      m.allMarked = rewritten.every((r) => r.text.trimStart().startsWith("[PLAIN]"));
      m.samples = rewritten.slice(0, 4).map((r) => r.text.trim().slice(0, 120));
      const links = await page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-plain] a[href]")).map((a) => (a.textContent ?? "").trim().length > 0));
      m.linksInRewritten = links.length;
      m.linksWithWords = links.filter(Boolean).length;
      m.desktop = await measure(page, base);
      await page.screenshot({ path: join(dir, "plain.png") });
      await page.evaluate(() => document.querySelector("[data-distill-plain]")?.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(dir, "plain-block.png") });
      try {
        mkdirSync(EVIDENCE, { recursive: true });
        await page.screenshot({ path: join(EVIDENCE, `r2-04-${site.id.replace(/^[a-z]+-/, "")}.jpg`), type: "jpeg", quality: 80 });
      } catch { /* no evidence folder on this machine */ }

      const same = (rows: { i: number; html: string; text: string }[]) =>
        rows.filter((r) => r.i >= 0 && before[r.i] && strip(r.html) === strip(before[r.i]?.html ?? "") && r.text === before[r.i]?.text).length;
      const sel = rewritten.map((t) => `[data-e2e-i="${t.i}"]`).join(",") || "#none";
      if (m.phase === "on") {
        await plain.click(); // As written
        await expect(plain).toHaveText("Plain");
        const back = await now(page, sel);
        m.asWrittenRestored = `${same(back)}/${back.length}`;
        await plain.click(); // Plain again: the same rewrites, no new call
        await expect(chip).toHaveAttribute("data-plain", "on", { timeout: 30_000 });
        m.againOnPage = await page.locator("[data-distill-plain]").count();
        await frame.getByTestId("cap-original").click();
        await frame.getByTestId("cap-back").waitFor();
        const orig = await now(page, sel);
        m.originalRestored = `${same(orig)}/${orig.length}`;
        await frame.getByTestId("cap-back").click();
      }
      m.formsUntouched = JSON.stringify(await formsNow(page)) === JSON.stringify(formsBefore);
      m.typedValueSent = rewritten.some((t) => t.text.includes(TYPED));
      expect(await startCaption(worker, tabId)).toBe(false);
      const closed = await now(page, sel);
      m.closeRestored = `${same(closed)}/${closed.length}`;
      m.marksLeft = await page.locator("[data-distill-plain], [data-distill-translated]").count();
      m.extErrors = extErrors;
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.formsUntouched).toBe(true);
    expect(m.typedValueSent).toBe(false);
    expect(m.marksLeft).toBe(0);
    if (m.phase === "on") {
      const all = (v: unknown) => { const [a, b] = String(v).split("/"); return a === b; };
      expect(all(m.asWrittenRestored)).toBe(true);
      expect(all(m.originalRestored)).toBe(true);
      expect(all(m.closeRestored)).toBe(true);
    }
  });
}
