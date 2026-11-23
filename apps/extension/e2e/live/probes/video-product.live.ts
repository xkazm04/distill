// Spark round 4 probe: video chapters and sponsor parts (r4-06) and a product page's facts (r4-07) on real sites. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/video-product      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it.) Video sites: the description's text as the page side reads it (saved as
// description.txt, the engine's unit-test fixtures come from here), the chapters More lists, a chapter click moving the
// player, a screenshot with More open. Product: what readProduct reads on the two small-business sites (they are not
// shops: the honest answer may be "not a product page"). No model is needed: both cards are patterns only.
// Output: e2e/out/live/probes/video-product/<site>/ and JPGs in E2E_EVIDENCE_DIR (r4-06-<site>.jpg, r4-07-<site>.jpg).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Frame, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "video-product");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r4";
// Neither cooking video of sites.json lists chapters in its description (checked 2026-11-23): one more real video that
// does, so the chapter list and seeking are seen on YouTube too. Not in sites.json: only this probe needs it.
const EXTRA: Site[] = [{ id: "video-chapters", useCase: "video", url: "https://www.youtube.com/watch?v=f0KK_4AaqLQ", lang: "en",
  why: "A tech video whose description lists 10 chapters.", cookies: [{ name: "SOCS", value: "CAI", domain: ".youtube.com" }], settleMs: 5000 }];
const ALL = [...(JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[]), ...EXTRA];
const DEFAULT = ["video-pohlreich", "video-kubicek-gulas", "video-chapters", "company-pujcovna-smid", "company-dymacek"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const EVIDENCE_NAME: Record<string, string> = {
  "video-pohlreich": "r4-06-pohlreich", "video-kubicek-gulas": "r4-06-kubicek", "video-chapters": "r4-06-chapters-live",
  "company-pujcovna-smid": "r4-07-pujcovna-smid", "company-dymacek": "r4-07-dymacek",
};

async function shot(page: Page, dir: string, name: string, evidence?: string) {
  await page.screenshot({ path: join(dir, `${name}.png`) });
  if (!evidence) return;
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${evidence}.jpg`), type: "jpeg", quality: 80 });
  } catch { /* the evidence folder is a convenience of the owner's machine */ }
}

/** The main video's time, from the page. */
const videoTime = (page: Page) => page.evaluate(() => {
  const v = document.querySelector<HTMLVideoElement>("#movie_player video, video");
  return v ? { t: v.currentTime, d: v.duration, ad: !!v.closest(".ad-showing") } : null;
});

/** The description as caption/video.ts reads it (the same places, the same line rules). */
const description = (page: Page) => page.evaluate(() => {
  // The whole description the page was served with (YouTube's DOM holds only its first lines).
  const id = /[?&]v=([\w-]{6,})/.exec(location.href)?.[1];
  for (const s of Array.from(document.querySelectorAll("script:not([src])"))) {
    const t = s.textContent ?? "";
    if (!t.includes("ytInitialPlayerResponse")) continue;
    const vid = /"videoDetails":\{[^}]*?"videoId":"([\w-]+)"/.exec(t)?.[1];
    const m = /"shortDescription":("(?:[^"\\]|\\.)*")/.exec(t);
    if (vid === id && m) return String(JSON.parse(m[1] as string));
  }
  const sels = ["ytd-watch-metadata ytd-text-inline-expander", "#description-inline-expander", "ytd-watch-metadata #description", "#description"];
  const lines = (el: Element): string => {
    const out: string[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) { out.push(n.nodeValue ?? ""); return; }
      if (n.nodeType !== 1) return;
      const e = n as Element;
      if (/^(?:script|style|noscript|template)$/.test(e.localName)) return;
      if (e.localName === "br") { out.push("\n"); return; }
      const block = /^(?:p|div|li|dt|dd|h[1-6]|tr|section|article|blockquote|pre|ul|ol|table)$/.test(e.localName);
      if (block) out.push("\n");
      for (const c of Array.from(e.childNodes)) walk(c);
      if (block) out.push("\n");
    };
    walk(el);
    return out.join("").replace(/\n{3,}/g, "\n\n");
  };
  let best = "";
  for (const s of sels) for (const el of Array.from(document.querySelectorAll(s)).slice(0, 4)) { const t = lines(el); if (t.length > best.length) best = t; }
  return best;
});

async function openMore(frame: Frame) {
  if ((await frame.getByTestId("cap-more-btn").getAttribute("aria-expanded")) !== "true") await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-more").waitFor();
}

test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as unknown);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
});

for (const site of SITES) {
  test(`video and product probe: ${site.id}`, async () => {
    const dir = join(PROBE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: { width: 1440, height: 900 }, locale: "cs-CZ",
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required"],
    });
    const m: Record<string, unknown> = { site: site.id, url: site.url, at: new Date().toISOString() };
    const extErrors: string[] = [];
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
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

      if (site.useCase === "video") {
        const text = await description(page);
        writeFileSync(join(dir, "description.txt"), text);
        m.descriptionChars = text.length;
        // The strip reads the chapters on its own (polled); More lists them.
        await openMore(frame);
        const list = frame.getByTestId("cap-chapter");
        await list.first().waitFor({ timeout: 20_000 }).catch(() => undefined);
        m.chapters = await list.evaluateAll((els) => els.map((e) => ({ start: Number(e.getAttribute("data-start")), text: e.textContent, sponsor: e.hasAttribute("data-sponsor") })));
        m.videoBefore = await videoTime(page);
        const n = await list.count();
        if (n >= 2) {
          // A chapter in the middle: the player moves there, and the mark follows.
          const pick = list.nth(Math.min(2, n - 1));
          const start = Number(await pick.getAttribute("data-start"));
          await pick.locator("button").click();
          await page.waitForTimeout(1500);
          m.seekTo = start;
          m.videoAfter = await videoTime(page);
          m.markedAfterSeek = await frame.locator("[data-testid=cap-chapter][aria-current=true]").getAttribute("data-start").catch(() => null);
        }
        m.skipShown = await frame.getByTestId("cap-video-skip").count();
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(300);
        await shot(page, dir, "chapters", EVIDENCE_NAME[site.id]);
      } else {
        await openMore(frame);
        await page.waitForTimeout(1500);
        const card = frame.getByTestId("cap-product");
        m.productCard = await card.count();
        m.productName = (await frame.getByTestId("cap-product-name").count()) ? await frame.getByTestId("cap-product-name").textContent() : null;
        m.facts = await frame.getByTestId("cap-product-fact").evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute("data-kind"), from: e.getAttribute("data-from"), text: e.textContent })));
        // What the engine would read, straight from the page side (the same message the strip sends).
        await shot(page, dir, "more", EVIDENCE_NAME[site.id]);
      }
      m.extErrors = extErrors;
      expect(await startCaption(worker, tabId)).toBe(false);
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
