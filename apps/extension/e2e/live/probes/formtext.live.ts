// Spark round 4 probe: a form in your language (r4-04) on the real village fault-report forms. Run with
//   npx playwright test -c e2e/playwright.live.config.ts probes/formtext      (after npm run build:e2e)
// (E2E_LIVE_SITES=<ids> narrows it.) The reader is English (locale en-US), so Translate starts by itself. The e2e build
// has no model: the stand-in answers translateBlocks with "[EN] " + the words and records what each run was handed. What
// is measured on the real page: how many of the form's words went in (text blocks, options, placeholders, buttons), that
// a value typed into a visible field never reached a model, that the fields' values are untouched, and that Keep Czech,
// Original and close bring the forms' markup back exactly. Never submits anything; never types into a hidden field.
// Output: e2e/out/live/probes/formtext/<site>/*.png and metrics.json, and JPGs for the spark board in E2E_EVIDENCE_DIR.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { Site } from "../caption.live";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "formtext");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r4";
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const DEFAULT = ["form-stahlavy", "form-praslavice"];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only.includes(s.id) || only.includes(s.useCase) : DEFAULT.includes(s.id)));
const DESKTOP = { width: 1440, height: 900 };
const TYPED = "Zqxvlenka Probe 4711";

/** Every form's markup, without Distill's marks and Playwright's empty style attributes, and what its fields hold. */
const forms = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll("form")).map((f) => ({
  html: f.outerHTML.replace(/\s(data-distill-[a-z-]+)(="[^"]*")?/g, "").replace(/ style=""/g, ""),
  // What the fields hold (an input button's value is its label, translated on purpose: left out).
  values: Array.from(f.querySelectorAll("input:not([type=submit]):not([type=button]):not([type=reset]), textarea, select")).map((c) => (c as HTMLInputElement).value),
})));

/** Types the probe's value into the first visible, plainly labelled text field of the largest form (never a hidden one:
 *  Přáslavice has a honeypot). Returns its name, or null. */
async function typeInto(page: Page): Promise<string | null> {
  return page.evaluate((typed) => {
    const all = Array.from(document.querySelectorAll("form")).sort((a, b) => b.querySelectorAll("input, select, textarea").length - a.querySelectorAll("input, select, textarea").length);
    for (const f of all) {
      // A textarea first (a description: what a person types most), never a date field.
      const fields = [...Array.from(f.querySelectorAll<HTMLTextAreaElement>("textarea")), ...Array.from(f.querySelectorAll<HTMLInputElement>("input[type=text], input:not([type])"))];
      for (const el of fields) {
        if (/dat|date/i.test(`${el.name} ${el.id} ${el.className}`)) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width < 20 || r.height < 10 || cs.visibility === "hidden" || cs.display === "none" || el.tabIndex < 0 || /hp|honey|website|url|spam/i.test(el.name)) continue;
        el.value = typed;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return el.name || el.id || el.localName;
      }
    }
    return null;
  }, TYPED);
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

for (const site of SITES) {
  test(`formtext probe: ${site.id}`, async () => {
    const dir = join(PROBE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: DESKTOP, locale: "en-US",
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const m: Record<string, unknown> = { site: site.id, url: site.url, at: new Date().toISOString() };
    const extErrors: string[] = [];
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"))
        ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      await worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {}, "distill:e2e:sentTranslate": [] }); });
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
      m.typedInto = await typeInto(page);
      const before = await forms(page);
      m.forms = before.length;
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
      await expect(chip).not.toHaveAttribute("data-translate", /^(idle|translating)$/, { timeout: 60_000 });
      m.translatedMs = Date.now() - t0;
      m.status = await frame.getByTestId("cap-status").textContent();
      m.chip = { text: await chip.textContent(), blocks: await chip.getAttribute("data-blocks"), form: await chip.getAttribute("data-form"), errors: await chip.getAttribute("data-errors") };

      // What went in, by kind.
      m.onPage = await page.evaluate(() => {
        const inForms = (sel: string) => Array.from(document.querySelectorAll(`form ${sel}`));
        const en = (s: string | null) => !!s && s.startsWith("[EN] ");
        return {
          markedElements: document.querySelectorAll("[data-distill-form-translated]").length,
          labels: inForms("label").filter((l) => /\[EN\] /.test(l.textContent ?? "")).length,
          labelsTotal: inForms("label").filter((l) => /\p{L}/u.test(l.textContent ?? "")).length,
          options: inForms("option").filter((o) => en(o.textContent)).length,
          optionsTotal: inForms("option").filter((o) => /\p{L}/u.test(o.textContent ?? "")).length,
          placeholders: inForms("[placeholder]").filter((e) => en(e.getAttribute("placeholder"))).length,
          placeholdersTotal: inForms("[placeholder]").filter((e) => /\p{L}/u.test(e.getAttribute("placeholder") ?? "")).length,
          buttons: inForms("button, input[type=submit], input[type=button]").filter((b) => en(b.textContent?.trim() || b.getAttribute("value"))).length,
          buttonsTotal: inForms("button, input[type=submit], input[type=button]").length,
          pinnedOptionValues: document.querySelectorAll("[data-distill-form-value]").length,
          sample: Array.from(document.querySelectorAll("[data-distill-form-translated]")).slice(0, 12).map((e) => (e.textContent ?? "").trim().slice(0, 80)),
          // What was not translated, and where it is (which form, and the element's own markup, cut).
          missed: [
            ...inForms("label").filter((l) => /\p{L}/u.test(l.textContent ?? "") && !/\[EN\] /.test(l.textContent ?? "")),
            ...inForms("option").filter((o) => /\p{L}/u.test(o.textContent ?? "") && !en(o.textContent)),
            ...inForms("[placeholder]").filter((e) => /\p{L}/u.test(e.getAttribute("placeholder") ?? "") && !en(e.getAttribute("placeholder"))),
            ...inForms("button, input[type=submit], input[type=button]").filter((b) => !en(b.textContent?.trim() || b.getAttribute("value"))),
          ].slice(0, 20).map((e) => {
            const f = e.closest("form");
            const where = !f ? "?" : `${f.id || f.getAttribute("name") || "?"}#${Array.from(document.querySelectorAll("form")).indexOf(f)}`
              + (f.closest("header, nav, footer, aside, [role=search]") ? " (boiler)" : "");
            return { form: where, el: e.outerHTML.slice(0, 160) };
          }),
        };
      });
      const during = await forms(page);
      m.valuesUntouched = JSON.stringify(during.map((f) => f.values)) === JSON.stringify(before.map((f) => f.values));

      // Nothing typed went to a model.
      const sent = await worker.evaluate(async () => ((await chrome.storage.session.get("distill:e2e:sentTranslate"))["distill:e2e:sentTranslate"] as { task: string; blocks: { text: string }[] }[] | undefined) ?? []);
      m.runs = sent.length;
      m.runsByTask = sent.reduce<Record<string, number>>((a, r) => ({ ...a, [r.task]: (a[r.task] ?? 0) + 1 }), {});
      m.typedValueSent = JSON.stringify(sent).includes(TYPED);
      m.formWordsSent = sent.flatMap((r) => r.blocks).length;

      // The form in view, for the board.
      await page.evaluate(() => {
        const f = Array.from(document.querySelectorAll("form")).sort((a, b) => b.querySelectorAll("input, select, textarea").length - a.querySelectorAll("input, select, textarea").length)[0];
        f?.scrollIntoView({ block: "start" });
        window.scrollBy(0, -40);
      });
      await page.waitForTimeout(500);
      await shot(page, dir, "1-translated", `r4-04-${site.id.replace(/^form-/, "")}`);

      // Keep Czech, Original and close: the forms' markup exactly as before.
      await frame.getByTestId("cap-keep-source").click();
      await expect(frame.getByTestId("cap-keep-source")).toHaveText(/^Show /);
      m.keepExact = JSON.stringify((await forms(page)).map((f) => f.html)) === JSON.stringify(before.map((f) => f.html));
      await shot(page, dir, "2-keep-czech");
      await frame.getByTestId("cap-keep-source").click();
      await frame.getByTestId("cap-original").click();
      await expect(frame.getByTestId("cap-back")).toBeVisible();
      m.originalExact = JSON.stringify((await forms(page)).map((f) => f.html)) === JSON.stringify(before.map((f) => f.html));
      await frame.getByTestId("cap-back").click();
      expect(await startCaption(worker, tabId)).toBe(false);
      await expect(page.locator("distill-caption")).toHaveCount(0);
      const after = await forms(page);
      m.closeExact = JSON.stringify(after.map((f) => f.html)) === JSON.stringify(before.map((f) => f.html));
      m.closeValuesUntouched = JSON.stringify(after.map((f) => f.values)) === JSON.stringify(before.map((f) => f.values));
      m.extErrors = extErrors;
      expect(m.typedValueSent).toBe(false);
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(m, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    }
  });
}
