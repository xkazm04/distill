// Spark round 5, r5-01 on the web as it is: a picture of each of the 9 live sites after Clean, compared with the
// approved one in visual.live.ts-snapshots/ at a LOOSE threshold, plus a structure check of the strip. The sites change
// daily (the headline, the photo, the count of what was removed), so the picture masks what changes by itself (every
// picture, video and embed on the page, and the strip's status line) and allows a large share of changed pixels: it
// catches a broken look (the strip missing, covered or unstyled, the page blank, a layout gone wide), not a new
// headline. The structure check is exact: the strip's row holds its parts, in Distill's fonts and theme roles, on top.
//
// Opt-in twice over: never in `npm run e2e` (it is under live/) and not in a plain `npm run e2e:live` either. Run it:
//   npx playwright test -c e2e/playwright.live.config.ts visual            (after npm run build:e2e)
//   E2E_LIVE_SITES=news-denik,form-praslavice npx playwright test -c e2e/playwright.live.config.ts visual
// Approve today's web: add --update-snapshots, then review the pictures in git (e2e/README.md, "Pictures").
// A site that does not answer is skipped. The gallery of every approved picture: e2e/out/visual/index.html.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Frame, type Page } from "playwright/test";
import { BAR, captionFrame, firstSight, settled, startCaption } from "../caption";
import { LAUNCH, prepareExtension } from "../harness";
import { writeGallery } from "../visual";
import type { Site } from "./caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const ALL = JSON.parse(readFileSync(join(here, "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = only.length ? ALL.filter((s) => only.includes(s.id) || only.includes(s.useCase)) : ALL;
const DESKTOP = { width: 1440, height: 900 };
const NOW = new Date("2026-11-23T10:00:00+01:00");
/** Loose: a share of changed pixels a new headline and new teasers stay under, a broken page does not. */
const LOOSE = { maxDiffPixelRatio: Number(process.env.E2E_VISUAL_RATIO ?? 0.25), threshold: 0.3 } as const;

// Only when asked: playwright.live.config.ts leaves this file out unless it is named (visual) or E2E_VISUAL=1.
test.afterAll(() => writeGallery());

/** The strip's structure: what its first line holds and how it is drawn. Runs in the strip's frame. */
function structure(frame: Frame) {
  return frame.evaluate(() => {
    const row = document.querySelector("[data-testid=cap-row]");
    const cs = (sel: string) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
    const status = cs("[data-testid=cap-status]");
    const more = cs("[data-testid=cap-more-btn]");
    return {
      parts: Array.from(row?.children ?? []).map((c) => c.getAttribute("data-testid") ?? c.localName).filter((p) => p !== "span"),
      font: status?.fontFamily ?? "",
      buttonFont: more?.fontFamily ?? "",
      /** The strip's background is a theme role (a CSS variable applyBinding set), not a colour the page leaked in. */
      bound: Array.from(document.documentElement.style).filter((p) => p.startsWith("--")).length,
    };
  });
}

async function still(page: Page, frame: Frame) {
  await frame.evaluate(() => document.fonts.ready.then(() => true));
  const line = () => frame.getByTestId("cap-row").textContent();
  let last = await line();
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const now = await line();
    if (now === last) break;
    last = now;
  }
  await settled(page);
  await page.mouse.move(1, 1);
}

for (const site of SITES) {
  test(`live picture: ${site.id}`, async () => {
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-visual-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: DESKTOP, deviceScaleFactor: 1, locale: "cs-CZ",
      reducedMotion: "reduce", colorScheme: "light",
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      if (site.cookies?.length) await context.addCookies(site.cookies.map((c) => ({ path: "/", ...c })));
      await context.clock.setFixedTime(NOW);
      const page = await context.newPage();
      for (const p of context.pages()) if (p !== page) await p.close();
      const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
      if (resp instanceof Error || !resp || resp.status() >= 400) {
        test.skip(true, `${site.id} is not reachable: ${resp instanceof Error ? resp.message.split("\n")[0] : `HTTP ${resp?.status()}`}`);
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
      await firstSight(frame);
      await still(page, frame);
      await page.evaluate(() => scrollTo(0, 0));
      await settled(page);

      // The structure, exact: the row's parts in order, Distill's fonts, the theme bound, the strip on top and small.
      const s = await structure(frame);
      expect(s.parts.slice(0, 2), `the strip's first line on ${site.id}`).toEqual(["img", "cap-status"]);
      expect(s.parts.slice(-2)).toEqual(["cap-more-btn", "cap-original"]);
      expect(s.font).toContain("Atkinson Hyperlegible Next");
      expect(s.buttonFont).toContain("Atkinson Hyperlegible Next");
      expect(s.bound, "theme roles bound on the strip (applyBinding)").toBeGreaterThan(5);
      const box = await page.locator("distill-caption").boundingBox();
      expect(box && box.width * box.height / (DESKTOP.width * DESKTOP.height)).toBeLessThanOrEqual(BAR.shareDesktop);
      const onTop = await page.evaluate(() => {
        const host = document.querySelector("distill-caption");
        const r = host?.getBoundingClientRect();
        return !!r && [0.1, 0.5, 0.9].every((f) => document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2) === host);
      });
      expect(onTop, "nothing covers the strip").toBe(true);

      // The picture, loose: what changes by itself masked.
      await expect(page).toHaveScreenshot(`live-${site.id}.png`, {
        ...LOOSE, animations: "disabled", caret: "hide", scale: "css",
        mask: [page.locator("img, picture, video, iframe:not([src*='caption.html']), canvas, svg"), frame.getByTestId("cap-status"), frame.getByTestId("cap-chip")],
      });
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
