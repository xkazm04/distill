// Spark round 5 probe (r5-04, r5-09): More on real pages, every section pictured, light and dark. Run with
//   E2E_PROBES=1 E2E_KIT_PHASE=before|after npx playwright test -c e2e/playwright.live.config.ts kit   (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it; default Přáslavice and Aktuálně.) The stand-in model answers the AI sections. With
// E2E_KIT_SLOW=1 it answers slowly, to picture the waiting placeholders on a real page.
// Output: JPGs in E2E_EVIDENCE_DIR named r5-04-live-<site>-<section>-<phase>-<scheme>.jpg, and the sections seen per
// site in e2e/out/live/probes/kit/<site>/metrics.json.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Frame } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "kit");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? join(OUT, "evidence");
const PHASE = process.env.E2E_KIT_PHASE ?? "after";
const SLOW = process.env.E2E_KIT_SLOW === "1";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["form-praslavice", "news-aktualne"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const VIEW = { width: 1280, height: 1100 };
const short = (id: string) => id.replace(/^(news|form|company|video)-/, "");

const SECTIONS = ["cap-gist", "cap-ask", "cap-product", "cap-video", "cap-tours", "cap-byline", "cap-actions", "cap-checks", "cap-claims",
  "cap-contact", "cap-form", "cap-comfort-section", "cap-calm", "cap-tables-section", "cap-terms-section", "cap-dark-section",
  "cap-consent-section", "cap-remember"];

async function picture(frame: Frame, testid: string, name: string): Promise<boolean> {
  const el = frame.getByTestId(testid).first();
  if (!(await el.count()) || !(await el.isVisible())) return false;
  await el.scrollIntoViewIfNeeded();
  mkdirSync(EVIDENCE, { recursive: true });
  await el.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 85, animations: "disabled" });
  return true;
}

for (const site of SITES) {
  for (const scheme of ["light", "dark"] as const) {
    test(`kit probe: ${site.id}, ${scheme}`, async () => {
      const dir = join(PROBE_OUT, `${site.id}-${scheme}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const ext = prepareExtension(true, false);
      const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
      const context = await chromium.launchPersistentContext(profile, {
        channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: VIEW, locale: "en-GB", colorScheme: scheme, reducedMotion: "reduce",
        args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
      });
      const m: Record<string, unknown> = { site: site.id, scheme, phase: PHASE, at: new Date().toISOString() };
      try {
        const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
          ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
        await worker.evaluate(async (slow) => { await chrome.storage.session.set({ "distill:e2e:fakeAi": slow ? { delayMs: 8000 } : {} }); }, SLOW);
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
        m.firstSight = await firstSight(frame, 30_000);
        await frame.getByTestId("cap-more-btn").click();
        await frame.getByTestId("cap-more").waitFor();
        if (!SLOW) await page.waitForTimeout(4000); // the AI sections and the contacts answer
        else await page.waitForTimeout(1500);
        const tag = SLOW ? `${PHASE}-slow` : PHASE;
        mkdirSync(EVIDENCE, { recursive: true });
        await page.locator("distill-caption").screenshot({ path: join(EVIDENCE, `r5-04-live-${short(site.id)}-strip-${tag}-${scheme}.jpg`), type: "jpeg", quality: 85, animations: "disabled" });
        const seen: string[] = [];
        for (const id of SECTIONS) {
          if (await picture(frame, id, `r5-04-live-${short(site.id)}-${id.replace(/^cap-|-section$/g, "")}-${tag}-${scheme}`)) seen.push(id);
        }
        m.sections = seen;
        m.waiting = await frame.locator(".k-wait").count();
        m.failed = await frame.locator(".k-failed").count();
        m.icons = await frame.locator("svg.k-icon").count();
      } finally {
        writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
        await context.close();
        rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
        rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  }
}
