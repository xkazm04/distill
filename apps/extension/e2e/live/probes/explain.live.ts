// Spark round 4 probe: explain this word (r4-05) on a real page. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/explain      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it.) The e2e build has no model, so the stand-in answers ("[EXPLAIN] ..."): what is
// measured is the mechanism on a real page - that a word selected in the main text gets the Explain button, that an
// abbreviation the page spells out somewhere (Aktuálně's tag list: "OSVČ (osoby samostatně výdělečně činné)") is
// answered from the page with no model, that other words go to the (stand-in) model on this device, that Esc closes
// the note and close removes it.
// Output: e2e/out/live/probes/explain/<site>/*.png and metrics.json, and JPGs for the spark board in E2E_EVIDENCE_DIR.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "explain");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r4";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["news-aktualne"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const LOCALE = process.env.E2E_PROBE_LOCALE ?? "cs-CZ";
const DESKTOP = { width: 1440, height: 900 };
/** What to select: an abbreviation (the page may spell it out) and plain words (the model's). */
const PICKS: Record<string, { abbr: string; words: string }> = {
  "news-aktualne": { abbr: "OSVČ", words: "daňového přiznání" },
  "news-denik": { abbr: "ÚP", words: "příspěvek na bydlení" },
};

/** Selects the first `words` in a paragraph of the page (scrolled into view); returns the paragraph's start. */
const select = (page: Page, words: string) => page.evaluate((words) => {
  for (const p of Array.from(document.querySelectorAll("article p, main p, p"))) {
    if ((p as HTMLElement).offsetParent === null) continue;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const at = n.data.indexOf(words);
      if (at < 0) continue;
      (p as HTMLElement).scrollIntoView({ block: "center" });
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + words.length);
      const sel = getSelection() as Selection;
      sel.removeAllRanges();
      sel.addRange(r);
      return (p.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    }
  }
  return null;
}, words);

const noteState = (page: Page) => page.evaluate(() => {
  const box = document.querySelector("distill-explain-note")?.shadowRoot?.querySelector(".note") as HTMLElement | null;
  return box?.dataset.phase ? { phase: box.dataset.phase, source: box.dataset.source ?? null, text: box.textContent ?? "" } : null;
});

async function shot(page: Page, dir: string, name: string, evidence?: string) {
  await page.screenshot({ path: join(dir, `${name}.png`) });
  if (!evidence) return;
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${evidence}.jpg`), type: "jpeg", quality: 80 });
  } catch { /* the evidence folder is a convenience of the owner's machine */ }
}

const short = (id: string) => id.replace(/^news-/, "");

for (const site of SITES) {
  test(`explain probe: ${site.id}`, async () => {
    const dir = join(PROBE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: DESKTOP, locale: LOCALE,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const pick = PICKS[site.id] ?? { abbr: "EU", words: "the" };
    const m: Record<string, unknown> = { site: site.id, url: site.url, locale: LOCALE, at: new Date().toISOString(), pick };
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
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");

      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);

      // 1. The abbreviation: the page's own words explain it, or (not spelled out anywhere) the model does.
      m.abbrParagraph = await select(page, pick.abbr);
      await page.waitForTimeout(600);
      m.abbrOffered = (await noteState(page))?.phase === "offer";
      if (m.abbrOffered) {
        await page.locator("distill-explain-note button", { hasText: "Explain" }).click();
        await expect.poll(async () => (await noteState(page))?.phase, { timeout: 15_000 }).toBe("shown");
        m.abbrNote = await noteState(page);
        await page.waitForTimeout(300);
        await shot(page, dir, "abbr", `r4-05-live-${short(site.id)}-${pick.abbr === "OSVČ" ? "osvc" : "abbr"}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        m.abbrAfterEsc = await noteState(page);
      }

      // 2. Plain words: the stand-in model "on this device".
      m.wordsParagraph = await select(page, pick.words);
      await page.waitForTimeout(600);
      m.wordsOffered = (await noteState(page))?.phase === "offer";
      if (m.wordsOffered) {
        const t0 = Date.now();
        await page.locator("distill-explain-note button", { hasText: "Explain" }).click();
        await expect.poll(async () => (await noteState(page))?.phase, { timeout: 15_000 }).toBe("shown");
        m.wordsMs = Date.now() - t0;
        m.wordsNote = await noteState(page);
        await page.waitForTimeout(300);
        await shot(page, dir, "words", `r4-05-live-${short(site.id)}-model`);
      }

      expect(await startCaption(worker, tabId)).toBe(false);
      m.notesAfterClose = await page.locator("distill-explain-note").count();
      m.extErrors = extErrors;
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.notesAfterClose).toBe(0);
  });
}
