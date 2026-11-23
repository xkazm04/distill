// Spark round 4 probe (r4-01): round 3's loose ends on the real sites. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/loose-ends      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it; all nine by default.) No model is involved. Per site:
// - what Clean removed, by label, and every "Empty space" it took: its size and that it held no text, picture or field;
//   the main text's paragraphs and pictures shown before and after Clean (none may go);
// - the things to do: count, which sit in a part Distill hid, and Show me on the first hidden one (it must open the
//   original and outline or highlight that part);
// - the highlights: how many of the items are highlighted (Půjčovna Šmíd's address over several lines included).
// Output: e2e/out/live/probes/loose-ends/<site>/metrics.json, table.txt, and JPGs in E2E_EVIDENCE_DIR:
// r4-01-stahlavy.jpg, r4-01-praslavice.jpg, r4-01-denik.jpg, r4-01-smid-address.jpg.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "loose-ends");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? join(OUT, "evidence");
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : true));
const DESKTOP = { width: 1440, height: 900 };
const short = (id: string) => id.replace(/^[a-z]+-/, "").replace(/^pujcovna-/, "");

const highlights = (page: Page) => page.evaluate(() => {
  const reg = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
  const h = reg?.get("distill-action");
  const s = reg?.get("distill-action-show");
  return { ranges: h ? h.size : 0, texts: h ? Array.from(h).map((r) => r.toString().replace(/\s+/g, " ").slice(0, 120)) : [],
    show: s ? Array.from(s).map((r) => r.toString().replace(/\s+/g, " ").slice(0, 120)) : [] };
});

/** The paragraphs with text and the pictures the person sees now (not hidden, with a size). */
const shownContent = (page: Page) => page.evaluate(() => {
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden"; };
  return {
    paragraphs: Array.from(document.querySelectorAll("p")).filter((p) => (p.textContent ?? "").trim().length > 40 && shown(p)).map((p) => (p.textContent ?? "").trim().slice(0, 60)),
    pictures: Array.from(document.querySelectorAll("img, picture, video")).filter((e) => shown(e) && e.getBoundingClientRect().width >= 100).length,
  };
});

/** Each element Clean hid as Empty space: its size with the original showing, and whether it holds anything. */
const emptySpaces = (page: Page, ids: string[]) => page.evaluate((ids) => ids.map((id) => {
  const el = document.querySelector(`[data-distill-hide="${id}"]`);
  if (!el) return { id, found: false };
  const html = document.documentElement;
  html.setAttribute("data-distill-original", "");
  const r = el.getBoundingClientRect();
  const visibleText = (el as HTMLElement).innerText.trim();
  html.removeAttribute("data-distill-original");
  return { id, found: true, tag: el.localName, cls: String(el.getAttribute("class") ?? "").slice(0, 80), w: Math.round(r.width), h: Math.round(r.height),
    visibleText: visibleText.slice(0, 80), media: !!el.querySelector("img, picture, video, iframe, canvas, svg, input, select, textarea, button"),
    hiddenInside: el.querySelectorAll("[data-distill-hide]").length };
}), ids);

test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as Record<string, unknown>);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
  const lines = all.map((m) => {
    const acts = (m.actions ?? []) as { kind: string; text: string; hidden: boolean }[];
    const removed = (m.removed ?? []) as string[];
    const before = removed.filter((l) => l !== "Empty space");
    return [
      `## ${String(m.site)}${m.skipped ? ` (skipped: ${String(m.skipped)})` : ""}`,
      `  status: ${String(m.status ?? "")}`,
      `  removed: ${removed.length} (without Empty space: ${before.length}) ${JSON.stringify(removed)}`,
      `  empty spaces: ${JSON.stringify(m.emptySpaces ?? [])}`,
      `  shown before/after Clean: paragraphs ${JSON.stringify(m.paragraphsBefore)} -> ${JSON.stringify(m.paragraphsAfter)}, pictures ${String(m.picturesBefore)} -> ${String(m.picturesAfter)}, lost: ${JSON.stringify(m.lostParagraphs ?? [])}`,
      `  actions: ${acts.length} (in hidden parts ${acts.filter((a) => a.hidden).length}; highlights ${String(m.highlights)}) show me: ${JSON.stringify(m.showMe ?? null)}`,
      ...acts.map((a, i) => `    a${i} ${a.kind}${a.hidden ? " [hidden part]" : ""}: ${a.text}`),
    ].join("\n");
  });
  const table = lines.join("\n\n");
  writeFileSync(join(PROBE_OUT, "table.txt"), table);
  console.log(`\n${table}\n`);
});

for (const site of SITES) {
  test(`loose ends probe: ${site.id}`, async () => {
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
      await page.waitForTimeout(Math.min(site.settleMs ?? 3000, 6000));
      const before = await shownContent(page);
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("The tab could not be found from the service worker.");

      expect(await startCaption(worker, tabId)).toBe(true);
      const frame = await captionFrame(page);
      m.firstSight = await firstSight(frame);
      await page.waitForTimeout(2500);
      m.status = (await frame.getByTestId("cap-status").textContent()) ?? "";
      const after = await shownContent(page);
      m.paragraphsBefore = before.paragraphs.length;
      m.paragraphsAfter = after.paragraphs.length;
      m.picturesBefore = before.pictures;
      m.picturesAfter = after.pictures;

      await frame.getByTestId("cap-more-btn").click();
      await frame.getByTestId("cap-more").waitFor();
      const removedRows = frame.getByTestId("cap-removed-item");
      m.removed = await removedRows.evaluateAll((els) => els.map((e) => e.querySelector("span")?.textContent ?? ""));
      const spaceIds = await page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-hide]")).map((e) => e.getAttribute("data-distill-hide") ?? ""));
      // The ids of the Empty space items: those the report lists last under that label (Clean adds them after its others).
      const labels = m.removed as string[];
      const spaces = labels.map((l, i) => (l === "Empty space" ? i : -1)).filter((i) => i >= 0);
      const ids = spaceIds.filter((id) => spaces.includes(Number(id.slice(1))));
      m.emptySpaces = await emptySpaces(page, ids);
      // The paragraphs an Empty space took (must be none): paragraphs gone that only Clean's spaces would explain.
      const hiddenBySpaces = await page.evaluate((ids) => ids.flatMap((id) => Array.from(document.querySelectorAll(`[data-distill-hide="${id}"] p`)).map((p) => (p.textContent ?? "").trim().slice(0, 60))).filter(Boolean), ids);
      m.lostParagraphs = hiddenBySpaces;

      const rows = frame.getByTestId("cap-action");
      const n = await rows.count();
      const actions: { kind: string | null; text: string; hidden: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        const r = rows.nth(i);
        actions.push({ kind: await r.getAttribute("data-kind"), text: (await r.getByTestId("cap-action-text").textContent()) ?? "", hidden: (await r.getAttribute("data-hidden")) !== null });
      }
      m.actions = actions;
      const h = await highlights(page);
      m.highlights = h.ranges;
      m.highlightTexts = h.texts;

      if (site.id === "news-denik") {
        // After Clean, where the grey bar was: just before "Kdo má na příspěvek nárok".
        await frame.getByTestId("cap-more-btn").click();
        await page.evaluate(() => {
          const h2 = Array.from(document.querySelectorAll("h2")).find((e) => /Kdo má na příspěvek nárok/.test(e.textContent ?? ""));
          if (h2) scrollTo(0, Math.max(0, h2.getBoundingClientRect().top + scrollY - 420));
        });
        await page.waitForTimeout(500);
        m.denikBar = await page.evaluate(() => {
          const box = document.querySelector("article.bg-grey-1, article.rounded-2xl");
          if (!box) return null;
          const r = box.getBoundingClientRect();
          return { hidden: box.hasAttribute("data-distill-hide") || !!box.closest("[data-distill-hide]"), h: Math.round(r.height), label: box.getAttribute("data-distill-hide") };
        });
        await page.screenshot({ path: join(dir, "after-clean.png") });
        try { mkdirSync(EVIDENCE, { recursive: true }); await page.screenshot({ path: join(EVIDENCE, "r4-01-denik.jpg"), type: "jpeg", quality: 80 }); } catch { /* convenience */ }
        await frame.getByTestId("cap-more-btn").click();
      }

      if (site.id === "company-pujcovna-smid") {
        const addr = rows.filter({ hasText: "Address:" }).first();
        if (await addr.count()) {
          await page.evaluate(() => scrollTo(0, 0));
          await addr.getByTestId("cap-action-show").click();
          await page.waitForTimeout(900);
          m.showMe = await highlights(page);
          await page.screenshot({ path: join(dir, "address.png") });
          try { mkdirSync(EVIDENCE, { recursive: true }); await page.screenshot({ path: join(EVIDENCE, "r4-01-smid-address.jpg"), type: "jpeg", quality: 80 }); } catch { /* convenience */ }
        }
      }

      const firstHidden = actions.findIndex((a) => a.hidden);
      if (firstHidden >= 0) {
        await frame.getByTestId("cap-actions").evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(dir, "actions.png") });
        if (site.id.startsWith("form-")) {
          try { mkdirSync(EVIDENCE, { recursive: true }); await page.screenshot({ path: join(EVIDENCE, `r4-01-${short(site.id)}.jpg`), type: "jpeg", quality: 80 }); } catch { /* convenience */ }
        }
        await rows.nth(firstHidden).getByTestId("cap-action-show").click();
        await frame.getByTestId("cap-back").waitFor({ timeout: 5000 });
        await page.waitForTimeout(900);
        m.showMeHidden = {
          original: await page.evaluate(() => document.documentElement.hasAttribute("data-distill-original")),
          show: (await highlights(page)).show,
          outlined: await page.locator("[data-distill-locate]").count(),
        };
        await page.screenshot({ path: join(dir, "show-me-hidden.png") });
        if (site.id.startsWith("form-")) {
          try { await page.screenshot({ path: join(EVIDENCE, `r4-01-${short(site.id)}-show-me.jpg`), type: "jpeg", quality: 80 }); } catch { /* convenience */ }
        }
        await frame.getByTestId("cap-back").click();
        await page.waitForTimeout(400);
      }

      expect(await startCaption(worker, tabId)).toBe(false);
      await page.waitForTimeout(300);
      m.attrsAfterClose = await page.locator("[data-distill-hide], [data-distill-action], #distill-actions-style").count();
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
    expect(m.attrsAfterClose).toBe(0);
    expect(m.lostParagraphs).toEqual([]);
  });
}
