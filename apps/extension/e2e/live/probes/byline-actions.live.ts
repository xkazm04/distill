// Spark round 3 probe: who wrote this and when (r3-05) and what this page asks of you (r3-09) on the real sites. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/byline-actions      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it; all nine by default.) No model is involved in either card. Per site it reads, before
// Distill starts, what the page itself states (its JSON-LD dates, its meta tags, the first dates written near the
// headline), then what the strip says and what More lists: the byline rows and every action with its kind, words and
// quote, and how many highlights are on the page. Original and close must take the highlights off.
// Output: e2e/out/live/probes/byline-actions/<site>/metrics.json, one table for all sites (table.txt and the console),
// and JPGs in E2E_EVIDENCE_DIR: r3-05-aktualne.jpg, r3-09-<site>.jpg.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "byline-actions");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? join(OUT, "evidence");
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : true));
const DESKTOP = { width: 1440, height: 900 };
/** The sites the r3-09 screenshots are for (sites.json ids). */
const ACTION_SHOTS = new Set(["form-stahlavy", "form-praslavice", "company-dymacek", "company-pujcovna-smid"]);

const short = (id: string) => id.replace(/^[a-z]+-/, "");

const highlights = (page: Page) => page.evaluate(() => {
  const reg = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
  const h = reg?.get("distill-action");
  return { ranges: h ? h.size : 0, show: reg?.has("distill-action-show") ?? false };
});

/** What the page itself states, read without Distill: JSON-LD and meta dates, and dates written near the headline. */
const pageSays = (page: Page) => page.evaluate(() => {
  const ld: { type: string; published?: string; modified?: string; author?: string }[] = [];
  const walk = (v: unknown, d: number) => {
    if (!v || typeof v !== "object" || d > 6) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, d + 1)); return; }
    const o = v as Record<string, unknown>;
    if (o.datePublished || o.dateModified) {
      const a = o.author as { name?: string } | { name?: string }[] | string | undefined;
      ld.push({ type: String(o["@type"]), published: o.datePublished as string, modified: o.dateModified as string,
        author: Array.isArray(a) ? a.map((x) => x?.name).join(", ") : typeof a === "string" ? a : a?.name });
    }
    for (const x of Object.values(o)) walk(x, d + 1);
  };
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) { try { walk(JSON.parse(s.textContent ?? ""), 0); } catch { /* skip */ } }
  const meta = (k: string) => document.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.getAttribute("content") ?? undefined;
  const h1 = document.querySelector("h1");
  const near = ((h1?.closest("article, main, body") ?? document.body) as HTMLElement | null)?.innerText ?? "";
  const from = h1 ? Math.max(0, near.indexOf(h1.innerText)) : 0;
  const shown = (near.slice(from, from + 1500).match(/\d{1,2}\.\s?\d{1,2}\.\s?\d{4}(?:\s+\d{1,2}:\d{2})?|\d{1,2}\.\s+\p{L}+\s+\d{4}|(?:aktualizováno|publikováno)[^\n]{0,40}/giu) ?? []).slice(0, 4);
  return {
    ld, metaPublished: meta("article:published_time"), metaModified: meta("article:modified_time"), siteName: meta("og:site_name"),
    metaAuthor: meta("author"), datesNearHeadline: shown,
  };
});

test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as Record<string, unknown>);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
  const lines = all.map((m) => {
    const b = (m.byline ?? {}) as Record<string, string>;
    const acts = (m.actions ?? []) as { kind: string; text: string }[];
    return [
      `## ${String(m.site)}${m.skipped ? ` (skipped: ${String(m.skipped)})` : ""}`,
      `  page says: ${JSON.stringify(m.pageSays)}`,
      `  Distill:   from=${b.from ?? "-"} | ${(b.rows ?? "") || "(no rows)"} | strip part: ${String(m.bylinePart ?? "-")}`,
      `  actions:   ${acts.length} (highlights ${String(m.highlights)}), status: ${String(m.status ?? "")}`,
      ...acts.map((a, i) => `    a${i} ${a.kind}: ${a.text}`),
    ].join("\n");
  });
  const table = lines.join("\n\n");
  writeFileSync(join(PROBE_OUT, "table.txt"), table);
  console.log(`\n${table}\n`);
});

for (const site of SITES) {
  test(`byline and actions probe: ${site.id}`, async () => {
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
      m.pageSays = await pageSays(page);
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");

      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);
      await page.waitForTimeout(2500);
      const status = (await frame.getByTestId("cap-status").textContent()) ?? "";
      m.status = status;
      m.bylinePart = /Published [^·]+/.exec(status)?.[0]?.trim() ?? null;
      m.actionsPart = /\d+ things? to do/.exec(status)?.[0] ?? null;
      m.highlights = (await highlights(page)).ranges;

      await frame.getByTestId("cap-more-btn").click();
      await frame.getByTestId("cap-more").waitFor();
      const byline = frame.getByTestId("cap-byline");
      await byline.waitFor({ timeout: 10_000 });
      m.byline = {
        from: await byline.getAttribute("data-from"),
        rows: (await byline.locator(".byline-rows > div").allTextContents()).join(" | "),
        noDate: await frame.getByTestId("cap-byline-nodate").count() > 0,
      };
      const rows = frame.getByTestId("cap-action");
      const n = await rows.count();
      const actions: { kind: string | null; text: string; quote: string; href: string | null }[] = [];
      for (let i = 0; i < n; i++) {
        const r = rows.nth(i);
        actions.push({
          kind: await r.getAttribute("data-kind"),
          text: (await r.getByTestId("cap-action-text").textContent()) ?? "",
          quote: (await r.getByTestId("cap-action-quote").count()) ? ((await r.getByTestId("cap-action-quote").textContent()) ?? "").slice(0, 200) : "",
          href: (await r.locator("a").count()) ? await r.locator("a").first().getAttribute("href") : null,
        });
      }
      m.actions = actions;

      if (site.id === "news-aktualne") {
        await byline.evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(dir, "byline.png") });
        try { mkdirSync(EVIDENCE, { recursive: true }); await page.screenshot({ path: join(EVIDENCE, "r3-05-aktualne.jpg"), type: "jpeg", quality: 80 }); } catch { /* convenience */ }
      }
      if (ACTION_SHOTS.has(site.id) || n > 0) {
        // The page at the first highlight (Show me on the first item), the list in More beside it.
        if (n > 0) {
          await page.evaluate(() => scrollTo(0, 0));
          await rows.first().getByTestId("cap-action-show").click();
          await page.waitForTimeout(900);
          m.showMe = await highlights(page);
          await frame.getByTestId("cap-actions").evaluate((el) => el.scrollIntoView({ block: "start" }));
          await page.waitForTimeout(300);
        }
        await page.screenshot({ path: join(dir, "actions.png") });
        if (ACTION_SHOTS.has(site.id)) {
          try { mkdirSync(EVIDENCE, { recursive: true }); await page.screenshot({ path: join(EVIDENCE, `r3-09-${short(site.id)}.jpg`), type: "jpeg", quality: 80 }); } catch { /* convenience */ }
        }
      }

      await frame.getByTestId("cap-original").click();
      await frame.getByTestId("cap-back").waitFor();
      await page.waitForTimeout(400);
      m.highlightsInOriginal = (await highlights(page)).ranges;
      await frame.getByTestId("cap-back").click();
      await page.waitForTimeout(400);
      m.highlightsAfterBack = (await highlights(page)).ranges;
      expect(await startCaption(worker, tabId)).toBe(false);
      await page.waitForTimeout(300);
      m.highlightsAfterClose = (await highlights(page)).ranges;
      m.attrsAfterClose = await page.locator("[data-distill-action], #distill-actions-style").count();
      m.extErrors = extErrors;
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.highlightsInOriginal).toBe(0);
    expect(m.highlightsAfterClose).toBe(0);
    expect(m.attrsAfterClose).toBe(0);
  });
}
