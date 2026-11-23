// Spark round 2 probe: claims to check (r2-01) and the gist first (r2-10) on real news sites. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/claims      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it; E2E_PROBE_LOCALE=en-US makes the reader English, so Translate runs first.)
// The e2e build has no model, so the stand-in model answers (it keeps the first six candidates; the gist is the first
// sentence of the first three blocks): what is measured is the mechanism on a real page - how many candidate sentences
// the engine finds in the main text, how many claims are kept and found again on the page as marks, that Show me
// scrolls to one, that Original and close take the marks off, and how many gist points pass the door.
// Output: e2e/out/live/probes/claims/<site>/*.png and metrics.json, one metrics.json for all sites, and JPGs for the
// spark board in E2E_EVIDENCE_DIR (default: the owner's .spark folder).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "claims");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r2";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["news-denik", "news-aktualne"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const LOCALE = process.env.E2E_PROBE_LOCALE ?? "cs-CZ";
const DESKTOP = { width: 1440, height: 900 };

/** The claim marks now: the ranges of the page's CSS highlight registry (shared by every world of the document). */
const marks = (page: Page) => page.evaluate(() => {
  const reg = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
  const h = reg?.get("distill-claim");
  return { ranges: h ? h.size : 0, texts: h ? Array.from(h).map((r) => r.toString().slice(0, 140)) : [], show: reg?.has("distill-show") ?? false };
});

const short = (id: string) => id.replace(/^news-/, "");

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
  test(`claims probe: ${site.id}`, async () => {
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

      const t0 = Date.now();
      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);
      const chip = frame.getByTestId("cap-chip");
      // Claims are found once Clean (and Translate, where it runs) is done; the chip carries the counts, no text.
      await expect(chip).not.toHaveAttribute("data-claims-phase", /^(idle|finding)$/, { timeout: 60_000 });
      await expect(chip).not.toHaveAttribute("data-gist-phase", /^(idle|finding)$/, { timeout: 30_000 });
      m.claimsMs = Date.now() - t0;
      m.status = await frame.getByTestId("cap-status").textContent();
      m.claimsPhase = await chip.getAttribute("data-claims-phase");
      const [kept, candidates] = ((await chip.getAttribute("data-claims")) ?? "0/0").split("/").map(Number);
      m.candidates = candidates;
      m.kept = kept;
      m.markedByPage = Number((await chip.getAttribute("data-claims-marked")) ?? 0);
      m.chip = { text: await chip.textContent(), src: await chip.getAttribute("data-src"), tasks: await chip.getAttribute("data-tasks") };
      const now = await marks(page);
      m.marksOnPage = now.ranges;
      m.claims = now.texts;
      m.markedBlocks = await page.locator("[data-distill-claim]").count();
      m.gistPhase = await chip.getAttribute("data-gist-phase");
      m.gistPoints = Number((await chip.getAttribute("data-gist")) ?? 0);

      // The first mark in view, for the screenshot.
      const firstMark = await page.evaluate(() => {
        const h = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get("distill-claim");
        const r = h ? Array.from(h)[0] : null;
        if (!r) return null;
        const box = r.getBoundingClientRect();
        scrollTo(0, Math.max(0, box.top + scrollY - innerHeight / 3));
        return r.toString().slice(0, 140);
      });
      m.firstMark = firstMark;
      await page.waitForTimeout(400);
      await shot(page, dir, "claims", `r2-01-${short(site.id)}`);

      // More: the gist first, then the claims; Show me on the last claim scrolls the page to it.
      await frame.getByTestId("cap-more-btn").click();
      await frame.getByTestId("cap-more").waitFor();
      m.gistTexts = await frame.getByTestId("cap-gist-point").allTextContents();
      m.claimRows = await frame.getByTestId("cap-claim").count();
      await page.evaluate(() => scrollTo(0, 0));
      if (m.gistPoints) {
        await frame.getByTestId("cap-gist-show").first().click();
        await page.waitForTimeout(800);
        m.gistShowMe = { highlighted: (await marks(page)).show, scrollY: await page.evaluate(() => scrollY) };
        await frame.getByTestId("cap-more").evaluate((el) => el.scrollTo(0, 0));
        await page.waitForTimeout(200);
        await shot(page, dir, "gist", `r2-10-${short(site.id)}`);
      }
      if (m.claimRows) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(2600);
        await frame.getByTestId("cap-claim-show").last().click();
        await page.waitForTimeout(800);
        m.claimShowMe = { highlighted: (await marks(page)).show, scrollY: await page.evaluate(() => scrollY) };
        await shot(page, dir, "claim-show-me");
      }

      // Original takes the marks off; Back puts them back; close removes everything.
      await frame.getByTestId("cap-original").click();
      await frame.getByTestId("cap-back").waitFor();
      await page.waitForTimeout(400);
      m.marksInOriginal = (await marks(page)).ranges;
      await frame.getByTestId("cap-back").click();
      await page.waitForTimeout(400);
      m.marksAfterBack = (await marks(page)).ranges;
      expect(await startCaption(worker, tabId)).toBe(false);
      m.marksAfterClose = (await marks(page)).ranges;
      m.attrsAfterClose = await page.locator("[data-distill-claim]").count();
      m.extErrors = extErrors;
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.marksInOriginal).toBe(0);
    expect(m.marksAfterClose).toBe(0);
    expect(m.attrsAfterClose).toBe(0);
  });
}
