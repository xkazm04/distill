// Round 3 probe: a cookie banner answered for you (r3-04) on the real sites that show one. Run with
//   E2E_PROBES=1 npx playwright test -c e2e/playwright.live.config.ts consent      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it.) A fresh profile per site, so the banner is there as on a first visit. Measured:
// - every click on the page while Distill is open (a capture listener in the page records the button's words and id):
//   exactly one press, and never one whose words say yes;
// - what the strip says ("Cookies: rejected") and what More says happened (rejected / hidden / none);
// - the site's own record after a reload without Distill: is the banner back, and the consent cookies as readable
//   (Didomi's didomi_token decoded: purposes enabled / disabled; the IAB euconsent-v2 string's presence; YouTube SOCS).
// Output: e2e/out/live/probes/consent/<site>/*.png and metrics.json, one metrics.json for all sites, JPGs for the spark
// board in E2E_EVIDENCE_DIR (r3-04-<site>.jpg after the press, r3-04-<site>-reload.jpg after the reload).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "consent");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r3";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
/** The sites that show a cookie banner on a first visit (the YouTube recipe with SOCS set has answered it already). */
const DEFAULT = ["demo-article", "news-denik", "news-aktualne", "form-praslavice", "form-stahlavy", "video-pohlreich"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const DESKTOP = { width: 1440, height: 900 };
const short = (id: string) => id.replace(/^(news|form|video|company)-/, "");

/** Consent systems' boxes and YouTube's consent dialog, shown on screen now. */
const BANNERS = "#onetrust-banner-sdk, #didomi-notice, #didomi-popup, .didomi-popup-container, #CybotCookiebotDialog, #qc-cmp2-ui, #usercentrics-root, [id^=sp_message_container], #truste-consent-track, ytd-consent-bump-v2-lightbox, tp-yt-paper-dialog.ytd-consent-bump-v2-lightbox, #cpexSubs_cmp, .cookie-bar, .cookies, #cookies, .cookie-consent, [class*=cookie-banner], [id*=cookie-banner], [class*=cookiebar], [id*=cookiebar]";
const bannerShown = (page: Page) => page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).some((el) => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.width > 50 && r.height > 20 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0;
}), BANNERS);

/** Every click that reaches the page, in the capture phase (the content script's press reaches it too). */
const recordClicks = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __probeClicks?: { words: string; id: string; cls: string }[] };
  if (w.__probeClicks) return;
  w.__probeClicks = [];
  const list = w.__probeClicks;
  const note = (e: Event) => {
    const el = (e.composedPath()[0] ?? e.target) as Element;
    const b = (el.closest?.("button, a, [role=button], input") ?? el) as HTMLElement;
    list.push({ words: (b.innerText || b.getAttribute("aria-label") || "").trim().slice(0, 80), id: b.id ?? "", cls: String(b.className ?? "").slice(0, 80) });
  };
  addEventListener("click", note, true);
  // A same-origin consent frame (Sourcepoint served by the site) gets the same listener.
  for (const f of Array.from(document.querySelectorAll("iframe"))) {
    try { f.contentWindow?.addEventListener("click", note, true); } catch { /* another origin */ }
  }
});
const clicks = (page: Page) => page.evaluate(() => (window as unknown as { __probeClicks?: unknown[] }).__probeClicks ?? null).catch(() => null);

/** The consent cookies as far as they can be read. */
async function consentCookies(context: BrowserContext): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const c of await context.cookies()) {
    if (c.name === "didomi_token") {
      try {
        const t = JSON.parse(Buffer.from(decodeURIComponent(c.value), "base64").toString("utf8")) as Record<string, { enabled?: string[]; disabled?: string[] }>;
        out.didomi_token = {
          purposesEnabled: t.purposes?.enabled ?? [], purposesDisabled: t.purposes?.disabled ?? [],
          vendorsEnabled: (t.vendors?.enabled ?? []).length, vendorsDisabled: (t.vendors?.disabled ?? []).length,
          liPurposesEnabled: (t.purposes_li?.enabled ?? []).length,
        };
      } catch { out.didomi_token = `unreadable (${c.value.length} chars)`; }
    } else if (/^(euconsent-v2|eupubconsent-v2|OptanonConsent|OptanonAlertBoxClosed|CookieConsent|SOCS|CONSENT|usercentrics|cmplz_|cookieyes|cc_cookie|cookie_consent|cookies?_?(accepted|consent|policy)|gdpr)/i.test(c.name)) {
      out[c.name] = c.value.length > 80 ? `${c.value.slice(0, 40)}... (${c.value.length} chars)` : c.value;
    }
  }
  return out;
}

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

const ACCEPT_WORDS = /(?<!\p{L})(accept|agree|allow all|souhlasím|přijmout|povolit vše|rozumím|ok)(?!\p{L})/iu;

for (const site of SITES) {
  test(`consent probe: ${site.id}`, async () => {
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
      await worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
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
      m.bannerBefore = await bannerShown(page);
      m.cookiesBefore = await consentCookies(context);
      await shot(page, dir, "before");
      await recordClicks(page);
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");

      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);
      // A banner can come late (Didomi on Deník 6-12 s): Stay clean answers it then.
      const status = frame.getByTestId("cap-status");
      await expect(status).toContainText("Cookies: rejected", { timeout: 15_000 }).catch(() => undefined);
      m.status = await status.textContent();
      m.clicks = await clicks(page);
      await frame.getByTestId("cap-more-btn").click();
      m.outcome = await frame.getByTestId("cap-consent-note").getAttribute("data-outcome").catch(() => null);
      await frame.getByTestId("cap-more-btn").click();
      await page.waitForTimeout(1500);
      m.cookiesAfterPress = await consentCookies(context);
      await shot(page, dir, "pressed", `r3-04-${short(site.id)}`);
      expect(await startCaption(worker, tabId)).toBe(false);

      // The site's own record: reload without Distill.
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 3000);
      m.bannerAfterReload = await bannerShown(page);
      m.cookiesAfterReload = await consentCookies(context);
      await shot(page, dir, "reload", `r3-04-${short(site.id)}-reload`);
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    // Never a press whose words say yes, and at most one press.
    const pressed = (m.clicks as { words: string }[] | null) ?? [];
    expect(pressed.filter((c) => ACCEPT_WORDS.test(c.words) && !/(do not|nesouhlas|odmítn|bez souhlasu|nezbytn|necessary|reject)/i.test(c.words))).toEqual([]);
    expect(pressed.length).toBeLessThanOrEqual(1);
    if (m.outcome === "rejected") expect(m.bannerAfterReload).toBe(false);
  });
}
