// Spark round 4 probe: tours started by hand (r4-08) on the real sites. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/tours      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it; all nine by default.) The e2e build's stand-in model answers the gist and the claims
// (it keeps the first six candidates; the gist is the first sentence of the first three blocks), so "Just the facts"
// can be offered on an article; the other two tours use no model. Per site: whether any tour starts by itself (it must
// not), which tours More offers and with how many steps, then each tour run step by step to the end - the strip's line
// and the words highlighted on the page at each step, and whether the step was found - and Esc, Original and close
// taking the highlight off.
// Output: e2e/out/live/probes/tours/<site>/metrics.json, one table for all sites (table.txt and the console), and JPGs
// in E2E_EVIDENCE_DIR: r4-08-aktualne-facts.jpg, r4-08-smid-call.jpg, r4-08-<village>-before.jpg.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Frame, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "tours");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? join(OUT, "evidence");
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : true));
const DESKTOP = { width: 1440, height: 900 };
/** Which tour's screenshot each site gives (sites.json id -> tour id); the step shot is the one with the most words. */
const SHOTS: Record<string, string> = {
  "news-aktualne": "facts", "company-pujcovna-smid": "call", "form-stahlavy": "before", "form-praslavice": "before",
};
const short = (id: string) => id.replace(/^[a-z]+-/, "").replace(/^pujcovna-/, "");

/** The tour's highlight now: its words, or the outlined place, or nothing. */
const shown = (page: Page) => page.evaluate(() => {
  const h = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get("distill-tour");
  const words = h ? Array.from(h).map((r) => r.toString().replace(/\s+/g, " ").trim()).join("|") : null;
  const outlined = document.querySelectorAll("[data-distill-tour]").length;
  let inView: boolean | null = null;
  const r = h ? Array.from(h)[0]?.getBoundingClientRect() : document.querySelector("[data-distill-tour]")?.getBoundingClientRect();
  if (r) inView = r.top >= 0 && r.bottom <= innerHeight * 0.75;
  return { words, outlined, inView };
});

interface StepSeen { line: string; words: string | null; outlined: number; inView: boolean | null }

async function openMore(frame: Frame) {
  if (await frame.getByTestId("cap-more").count()) return;
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-more").waitFor();
}

test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as Record<string, unknown>);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
  const lines = all.map((m) => {
    const runs = (m.runs ?? {}) as Record<string, StepSeen[]>;
    return [
      `## ${String(m.site)}${m.skipped ? ` (skipped: ${String(m.skipped)})` : ""}`,
      `  started by itself: ${String(m.startedByItself)} | offered: ${JSON.stringify(m.offered ?? [])} | status: ${String(m.status ?? "")}`,
      ...Object.entries(runs).flatMap(([id, steps]) => [
        `  ${id}: ${steps.length} steps, highlighted ${steps.filter((s) => s.words).length}, outlined ${steps.filter((s) => !s.words && s.outlined).length}, in view ${steps.filter((s) => s.inView).length}`,
        ...steps.map((s) => `    ${s.line.slice(0, 110)}\n      -> ${s.words ? `"${s.words.slice(0, 110)}"` : s.outlined ? "(place outlined)" : "(nothing on the page)"}`),
      ]),
      `  after Esc: ${JSON.stringify(m.afterEsc)} | Original: ${JSON.stringify(m.inOriginal)} | close: ${JSON.stringify(m.afterClose)}`,
    ].join("\n");
  });
  const table = lines.join("\n\n");
  writeFileSync(join(PROBE_OUT, "table.txt"), table);
  console.log(`\n${table}\n`);
});

for (const site of SITES) {
  test(`tours probe: ${site.id}`, async () => {
    test.setTimeout(180_000);
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
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");

      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);
      // The gist and the claims (stand-in model), byline and things to do have time to come in; nothing may start.
      await page.waitForTimeout(4000);
      m.status = (await frame.getByTestId("cap-status").textContent()) ?? "";
      m.startedByItself = (await frame.getByTestId("cap-tour-status").count()) > 0 || (await shown(page)).words !== null;

      await openMore(frame);
      await page.waitForTimeout(800);
      const offered = await frame.getByTestId("cap-tour").evaluateAll((els) => els.map((e) => ({
        id: e.getAttribute("data-tour"), what: (e.textContent ?? "").replace(/\s+/g, " ").trim(),
      })));
      m.offered = offered;
      const runs: Record<string, StepSeen[]> = {};
      for (const t of offered) {
        if (!t.id) continue;
        await openMore(frame);
        await page.evaluate(() => scrollTo(0, 0));
        await frame.getByTestId(`cap-tour-start-${t.id}`).click();
        const status = frame.getByTestId("cap-tour-status");
        await status.waitFor();
        const steps: StepSeen[] = [];
        let best = { n: -1, len: -1 };
        for (let i = 0; i < 30; i++) {
          await page.waitForTimeout(900); // the smooth scroll, and a step that answers late
          const line = (await status.getAttribute("title")) ?? "";
          const s = await shown(page);
          steps.push({ line, ...s });
          if (SHOTS[site.id] === t.id && (s.words?.length ?? 0) > best.len && s.inView) {
            best = { n: i, len: s.words?.length ?? 0 };
            await page.screenshot({ path: join(dir, `${t.id}.png`) });
            try { mkdirSync(EVIDENCE, { recursive: true }); await page.screenshot({ path: join(EVIDENCE, `r4-08-${short(site.id)}-${t.id === "call" ? "call" : t.id === "facts" ? "facts" : "before"}.jpg`), type: "jpeg", quality: 80 }); } catch { /* convenience */ }
          }
          const next = frame.getByTestId("cap-tour-next");
          if ((await next.textContent())?.trim() === "Done") break;
          await next.click();
        }
        runs[t.id] = steps;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        m.afterEsc = { line: await status.count(), ...(await shown(page)) };
      }
      m.runs = runs;

      // Original during a tour, then close during a tour.
      if (offered[0]?.id) {
        await openMore(frame);
        await frame.getByTestId(`cap-tour-start-${offered[0].id}`).click();
        await page.waitForTimeout(600);
        await frame.getByTestId("cap-original").click();
        await frame.getByTestId("cap-back").waitFor();
        await page.waitForTimeout(300);
        m.inOriginal = await shown(page);
        await frame.getByTestId("cap-back").click();
        await page.waitForTimeout(300);
        await openMore(frame);
        await frame.getByTestId(`cap-tour-start-${offered[0].id}`).click();
        await page.waitForTimeout(600);
      }
      expect(await startCaption(worker, tabId)).toBe(false);
      await page.waitForTimeout(300);
      m.afterClose = { ...(await shown(page)), style: await page.locator("#distill-tour-style").count() };
      m.extErrors = extErrors;
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.startedByItself).toBe(false);
    const close = m.afterClose as { words: string | null; outlined: number; style: number } | undefined;
    if (close) expect([close.words, close.outlined, close.style]).toEqual([null, 0, 0]);
    if (m.inOriginal) expect((m.inOriginal as { words: string | null }).words).toBeNull();
  });
}
