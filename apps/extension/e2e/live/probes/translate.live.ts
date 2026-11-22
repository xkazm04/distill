// Translate in place (#10) on real sites: the numbers caption.live.ts does not collect yet. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/translate      (after npm run build:e2e)
// The e2e build has no model, so the dev fake model answers (each block "[EN] " + its words): what is measured is the
// mechanism on a real page - which blocks go, how fast, that the page's own words come back exactly, that forms are
// never touched - and the risk spike: whether the caption frame may use the Prompt API on that site at all (and when it
// may not, that the offscreen document ran it: data-via). Then the page is made to change as a person would make it
// (scroll to its end; YouTube: "...more" on the description) and what Translate did with the new text is counted.
// Output: e2e/out/live/probes/translate/<site>/*.png and metrics.json, and one metrics.json for all sites.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Frame, type Page, type Worker } from "playwright/test";
import { baseline, captionFrame, firstSight, measure, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "translate");
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["news-aktualne", "company-dymacek", "form-praslavice"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const DESKTOP = { width: 1440, height: 900 };
const TYPED = "E2E-probe 4711";

/** Every element that could be a block, marked with its index, with its markup and words before Distill. Page side. */
function snapshot(page: Page) {
  return page.evaluate(() => {
    // Blocks, and boxes of text with no block inside (a lead in a div); never a whole layout box (its markup is the page).
    const leaf = (el: Element) => !el.querySelector("p, div, section, article, ul, ol, dl, table, figure, blockquote, header, footer, nav, aside, form, h1, h2, h3, h4, h5, h6");
    const els = Array.from(document.body.querySelectorAll("p, li, dt, dd, td, th, caption, figcaption, blockquote, h1, h2, h3, h4, h5, h6, summary, legend, div, section"))
      .filter((el) => !/^(div|section)$/.test(el.localName) || leaf(el));
    return els.map((el, i) => { el.setAttribute("data-e2e-i", String(i)); return { html: el.innerHTML, text: el.textContent ?? "" }; });
  });
}

/** For each translated block (or each block that was): its markup and words now, by index. */
function now(page: Page, which: string) {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((el) => ({
    i: Number(el.getAttribute("data-e2e-i") ?? -1), html: el.innerHTML, text: el.textContent ?? "", lang: el.getAttribute("lang"),
  })), which);
}

const strip = (html: string) => html.replace(/\s(data-distill-[a-z-]+|data-e2e-[a-z0-9-]+)(="[^"]*")?/g, "").replace(/ style=""/g, "");

/** Words inside the page's forms and what their fields hold. */
function formsNow(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("form")).map((f) => ({
    text: f.textContent ?? "",
    values: Array.from(f.querySelectorAll("input, textarea, select")).map((c) => (c as HTMLInputElement).value),
  })));
}

async function finalStatus(frame: Frame, timeout = 60_000): Promise<string> {
  const chip = frame.getByTestId("cap-chip");
  await expect(chip).not.toHaveAttribute("data-translate", "translating", { timeout });
  return (await frame.getByTestId("cap-status").textContent()) ?? "";
}

/** Makes the page change as a person would, then counts the blocks translated before and after, what the frame heard,
 *  and the blocks the chip reports. A screenshot shows the new text. */
async function laterText(page: Page, frame: Frame, worker: Worker, dir: string): Promise<Record<string, unknown>> {
  const count = () => page.locator("[data-distill-translated]").count();
  const heard = () => worker.evaluate(() => ((globalThis as { __moreText?: { count: number }[] }).__moreText ?? []).map((x) => x.count));
  const out: Record<string, unknown> = { translatedBefore: await count(), blocksBefore: await frame.getByTestId("cap-chip").getAttribute("data-blocks") };
  await page.evaluate(() => document.querySelectorAll("[data-distill-translated]").forEach((el, i) => { el.setAttribute("data-e2e-was", String(i)); (el as HTMLElement).dataset.e2eText = el.textContent ?? ""; }));
  const triggers: string[] = [];
  // YouTube's description: "...more" expands it in place (its text is replaced by the full one).
  const expand = page.locator("#description-inline-expander #expand, ytd-text-inline-expander #expand").first();
  if (await expand.isVisible().catch(() => false)) {
    await expand.click().catch(() => undefined);
    triggers.push("description ...more");
    await page.waitForTimeout(500);
    await page.locator("#description-inline-expander").first().scrollIntoViewIfNeeded().catch(() => undefined);
  }
  // Scroll to the end and back, slowly: lazy sections and "load more" content come in.
  const steps = await page.evaluate(() => Math.min(30, Math.ceil(document.documentElement.scrollHeight / innerHeight)));
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(250); }
  triggers.push(`scrolled ${steps} screens`);
  await page.waitForTimeout(6000); // the page settles, Translate looks and the stand-in model answers
  out.triggers = triggers;
  out.translatedAfter = await count();
  out.blocksAfter = await frame.getByTestId("cap-chip").getAttribute("data-blocks");
  out.moreText = await heard();
  // No loop: with the page left alone, nothing more is heard.
  const settled = (await heard()).length;
  await page.waitForTimeout(4000);
  out.moreTextAfterQuiet = (await heard()).length - settled;
  out.blocksAfterQuiet = await frame.getByTestId("cap-chip").getAttribute("data-blocks");
  // Over a longer quiet spell too: a loop would keep counting up, a page that keeps loading comes to rest.
  await page.waitForTimeout(10_000);
  out.moreTextAfter14s = (await heard()).length - settled;
  out.blocksAfter14s = await frame.getByTestId("cap-chip").getAttribute("data-blocks");
  await page.waitForTimeout(30_000);
  out.moreTextAfter44s = (await heard()).length - settled;
  out.blocksAfter44s = await frame.getByTestId("cap-chip").getAttribute("data-blocks");
  out.translatedOnPageAfter44s = await count();
  out.rewrittenByPage = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("[data-e2e-was]")).filter((el) => el.textContent !== el.dataset.e2eText).slice(0, 8).map((el) =>
    `${el.localName}.${String(el.className).slice(0, 30)}: was "${(el.dataset.e2eText ?? "").trim().slice(0, 50)}" now "${(el.textContent ?? "").trim().slice(0, 50)}"`));
  out.newBlocksSample = await page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-translated]:not([data-e2e-was])")).slice(0, 8).map((el) =>
    `${el.closest("article") ? "in <article>" : "outside <article>"} ${el.localName}.${String(el.className).slice(0, 30)}: ${(el.textContent ?? "").trim().slice(0, 60)}`));
  const firstNew = await page.evaluate(() => {
    const t = document.querySelector("#description-inline-expander [data-distill-translated], ytd-text-inline-expander [data-distill-translated]")
      ?? Array.from(document.querySelectorAll("[data-distill-translated]")).at(-1);
    if (!t) return null;
    t.scrollIntoView({ block: "center" });
    return (t.textContent ?? "").slice(0, 160);
  });
  out.sample = firstNew;
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, "later.png") });
  return out;
}

test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as unknown);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
});

for (const site of SITES) {
  test(`translate probe: ${site.id}`, async () => {
    const dir = join(PROBE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    // The reader reads English (the live run's cs-CZ locale would make a Czech page the reader's own language).
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: DESKTOP, locale: "en-US",
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const m: Record<string, unknown> = { site: site.id, url: site.url, at: new Date().toISOString() };
    const extErrors: string[] = [];
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      await worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
      // What the page side tells the frame about text added later (a count, never the words) reaches the worker too.
      await worker.evaluate(() => {
        const g = globalThis as { __moreText?: unknown[] };
        g.__moreText = [];
        chrome.runtime.onMessage.addListener((msg: { type?: string }) => { if (msg?.type === "distill:caption:moreText") g.__moreText?.push(msg); });
      });
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
      m.permissionsPolicy = resp.headers()["permissions-policy"] ?? null;
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 3000);
      const base = await baseline(page);
      const before = await snapshot(page);
      // A value in the page's form, as a person would have typed it (never submitted).
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
      const t0 = Date.now();
      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);
      m.firstSightMs = Date.now() - t0;
      // The risk spike, on this site: may the caption frame use the Prompt API here?
      m.frame = await frame.evaluate(() => ({
        languageModel: typeof (globalThis as { LanguageModel?: unknown }).LanguageModel,
        policyAllows: (document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy?.allowsFeature("language-model") ?? null,
      }));
      const chip = frame.getByTestId("cap-chip");
      m.status = await finalStatus(frame);
      m.translatedMs = Date.now() - t0;
      m.phase = await chip.getAttribute("data-translate");
      m.blocks = await chip.getAttribute("data-blocks");
      m.dropped = Number((await chip.getAttribute("data-dropped")) ?? 0);
      m.chip = { text: await chip.textContent(), src: await chip.getAttribute("data-src"), via: await chip.getAttribute("data-via") };
      const translated = await now(page, "[data-distill-translated]");
      m.translatedOnPage = translated.length;
      m.translatedWithLang = translated.filter((t) => t.lang).length;
      const links = await page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-translated] a[href]")).map((a) => (a.textContent ?? "").trim().length > 0));
      m.linksInTranslated = links.length;
      m.linksWithWords = links.filter(Boolean).length;
      m.desktop = await measure(page, base);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(dir, "translated.png") });
      const top = await page.evaluate(() => {
        const t = document.querySelector("[data-distill-translated]");
        if (!t) return null;
        t.scrollIntoView({ block: "center" });
        return (t.textContent ?? "").slice(0, 160);
      });
      m.firstTranslatedBlock = top;
      if (top) { await page.waitForTimeout(300); await page.screenshot({ path: join(dir, "translated-block.png") }); }

      // Text the page adds later: only while a translation is on the page.
      if (m.phase === "done") m.later = await laterText(page, frame, worker, dir);

      // The form: never touched.
      const formsAfter = await formsNow(page);
      m.formsUntouched = JSON.stringify(formsAfter) === JSON.stringify(formsBefore);
      m.typedValueSent = translated.some((t) => t.text.includes(TYPED));

      const same = (rows: { i: number; html: string; text: string }[]) =>
        rows.filter((r) => r.i >= 0 && before[r.i] && strip(r.html) === strip(before[r.i]?.html ?? "") && r.text === before[r.i]?.text).length;
      const sel = translated.map((t) => `[data-e2e-i="${t.i}"]`).join(",") || "#none";
      if (await frame.getByTestId("cap-keep-source").count()) {
        await frame.getByTestId("cap-keep-source").click();
        await expect(frame.getByTestId("cap-keep-source")).toHaveText(/^Show /);
        const back = await now(page, sel);
        m.keepSourceRestored = `${same(back)}/${back.length}`;
        await page.screenshot({ path: join(dir, "keep-source.png") });
        await frame.getByTestId("cap-keep-source").click();
        await frame.getByTestId("cap-original").click();
        await frame.getByTestId("cap-back").waitFor();
        const orig = await now(page, sel);
        m.originalRestored = `${same(orig)}/${orig.length}`;
        await frame.getByTestId("cap-back").click();
      }
      expect(await startCaption(worker, tabId)).toBe(false);
      const closed = await now(page, sel);
      m.closeRestored = `${same(closed)}/${closed.length}`;
      m.marksLeft = await page.locator("[data-distill-translated]").count();
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
  });
}
