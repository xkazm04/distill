// Round 1, W3 probe (spark universal-core): on real sites, what the caption finds. #2 the page's language and where it
// came from (its lang attribute or its words), #5 the contact card, #9 the form check and where Next goes. Numbers the
// main live run does not collect yet; run it with
//   npx playwright test -c e2e/playwright.live.config.ts probes/find
// (E2E_LIVE_SITES=<ids> narrows it). Output: e2e/out/live/probes/find/<site>/ (screenshots) and .../find/metrics.json.
// It never types into a form and never submits one: Next only scrolls to a field and focuses it.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectLang } from "@distill/engine";
import { chromium, test, type Frame, type Page, type Worker } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "../../caption";
import { LAUNCH, OUT, prepareExtension } from "../../harness";
import type { CleanReport, ContactItem, FormProgress } from "../../../src/messages";

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_OUT = join(OUT, "live", "probes", "find");
const DEFAULT_SITES = ["company-dymacek", "company-pujcovna-smid", "form-stahlavy", "form-praslavice", "news-denik"];

interface Site { id: string; useCase: string; url: string; lang: string; cookies?: { name: string; value: string; domain: string; path?: string }[]; settleMs?: number }
const ALL = JSON.parse(readFileSync(join(here, "..", "sites.json"), "utf8")) as Site[];
const only = (process.env.E2E_LIVE_SITES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SITES = ALL.filter((s) => (only.length ? only : DEFAULT_SITES).includes(s.id));

/** A field the page shows, as the probe saw it: never its value, only whether it holds one. */
interface FieldSeen { id: string; name: string; tag: string; type: string; required: boolean; empty: boolean }

interface ProbeResult {
  site: string;
  url: string;
  at: string;
  status: "done" | "skipped" | "failed";
  reason?: string;
  firstSight?: string;
  /** #2: the page's own lang attribute ("" when it has none), and what the caption decided. */
  langAttr?: string;
  lang?: string;
  langFrom?: CleanReport["langFrom"];
  /** The running text detectLang was given (as page.ts builds it), its length and its start. */
  langInput?: { chars: number; sample: string };
  langOfWholePage?: { lang: string; confidence: number };
  /** #5 */
  contacts?: ContactItem[];
  /** #9 */
  form?: FormProgress | null;
  /** #9: where Next went, and the first empty required field before it (what it should have been). */
  next?: { focused: FieldSeen | null; expected: FieldSeen | null; after: FormProgress | null };
  /** #9: robot traps (fields named like website/url/honeypot) and whether each is still empty after Next. */
  traps?: { name: string; empty: boolean }[];
  /** G13: what the side panel reads (distill:getForm, the engine's FormStructure: labels only, never a value): per form
   *  of the page, its field count and the labels it marks required. */
  panelForms?: { fields: number; required: string[] }[];
  shots: string[];
  extErrors: string[];
}

const ask = <T>(worker: Worker, tabId: number, req: Record<string, unknown>): Promise<T> =>
  worker.evaluate(async ([id, r]) => {
    const res = (await chrome.tabs.sendMessage(id as number, r, { frameId: 0 })) as { ok: boolean; data?: unknown; error?: string };
    if (!res?.ok) throw new Error(res?.error ?? "no answer");
    return res.data;
  }, [tabId, req] as const) as Promise<T>;

/** The fields the page shows, in order: required or not, empty or not. Values are never read out. */
function fieldsSeen(page: Page): Promise<FieldSeen[]> {
  return page.evaluate(() => {
    // Required as a person reads the page: the attribute, a "required" class, or the label says so (a star, "povinné").
    const req = (c: HTMLInputElement) => c.required || c.getAttribute("aria-required") === "true" || /(^|\s)required(\s|$)/i.test(c.className)
      || Array.from(c.labels ?? []).some((l) => /\*|povinn/i.test(l.textContent ?? ""));
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width >= 4 && r.height >= 4 && cs.visibility !== "hidden" && cs.display !== "none" && r.right > 0 && r.left < document.documentElement.scrollWidth;
    };
    return Array.from(document.querySelectorAll("input, select, textarea"))
      .filter((el) => !["hidden", "submit", "button", "reset", "image"].includes((el.getAttribute("type") ?? "").toLowerCase()) && shown(el))
      .map((el) => {
        const c = el as HTMLInputElement;
        const empty = c.type === "checkbox" || c.type === "radio" ? !c.checked : c.type === "file" ? !c.files?.length : !c.value;
        return { id: c.id, name: c.name, tag: c.localName, type: c.type, required: req(c), empty };
      });
  });
}

const focusedField = (page: Page): Promise<FieldSeen | null> => page.evaluate(() => {
  const c = document.activeElement as HTMLInputElement | null;
  if (!c || !/^(input|select|textarea)$/.test(c.localName)) return null;
  const empty = c.type === "checkbox" || c.type === "radio" ? !c.checked : !c.value;
  const required = c.required || /(^|\s)required(\s|$)/i.test(c.className) || Array.from(c.labels ?? []).some((l) => /\*|povinn/i.test(l.textContent ?? ""));
  return { id: c.id, name: c.name, tag: c.localName, type: c.type, required, empty };
});

const trapsOf = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll("input, textarea"))
  .filter((el) => /(^|[_\-[\]])(website|url|www|homepage|hp|honeypot|hpot|antispam|spam|bot|trap|nickname|leave[_-]?blank)([_\-[\]]|$)/i.test(`${el.getAttribute("name") ?? ""} ${el.id}`))
  .map((el) => ({ name: el.getAttribute("name") ?? el.id, empty: !(el as HTMLInputElement).value })));

// Each site writes its own metrics.json; afterAll gathers them (a failed site restarts the worker, so nothing is kept
// in memory across sites).
test.afterAll(() => {
  if (!existsSync(PROBE_OUT)) return;
  const all = readdirSync(PROBE_OUT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(PROBE_OUT, d.name, "metrics.json")))
    .map((d) => JSON.parse(readFileSync(join(PROBE_OUT, d.name, "metrics.json"), "utf8")) as ProbeResult);
  writeFileSync(join(PROBE_OUT, "metrics.json"), JSON.stringify(all, null, 2));
});

for (const site of SITES) {
  test(`find probe: ${site.id}`, async () => {
    const dir = join(PROBE_OUT, site.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ext = prepareExtension(true, false);
    const profile = mkdtempSync(join(tmpdir(), "distill-probe-find-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: LAUNCH.channel, headless: LAUNCH.headless, viewport: { width: 1440, height: 900 }, locale: "cs-CZ",
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    const r: ProbeResult = { site: site.id, url: site.url, at: new Date().toISOString(), status: "skipped", shots: [], extErrors: [] };
    try {
      const worker = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
      worker.on("console", (m) => { if (m.type() === "error") r.extErrors.push(`[worker] ${m.text()}`); });
      if (site.cookies?.length) await context.addCookies(site.cookies.map((c) => ({ path: "/", ...c })));
      const page = await context.newPage();
      for (const p of context.pages()) if (p !== page) await p.close();
      page.on("console", (m) => { if (m.type() === "error" && (m.location().url.startsWith("chrome-extension://") || m.text().includes("chrome-extension://"))) r.extErrors.push(`[page] ${m.text()}`); });
      const resp = await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: unknown) => e as Error);
      if (resp instanceof Error || !resp || resp.status() >= 400) {
        r.reason = resp instanceof Error ? resp.message.split("\n")[0] : `HTTP ${resp?.status() ?? "no answer"}`;
        test.skip(true, `${site.id} is not reachable: ${r.reason}`);
        return;
      }
      await page.waitForLoadState("load", { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(site.settleMs ?? 3000);
      const shot = async (name: string) => { await page.screenshot({ path: join(dir, `${name}.png`) }); r.shots.push(join(dir, `${name}.png`)); };

      r.langAttr = await page.evaluate(() => document.documentElement.getAttribute("lang") ?? "");
      const tabId = await worker.evaluate(async (u) => {
        const tabs = await chrome.tabs.query({});
        return (tabs.find((t) => t.url === u) ?? tabs.find((t) => t.active))?.id;
      }, page.url());
      if (typeof tabId !== "number") throw new Error("no tab id");
      await startCaption(worker, tabId);
      const frame: Frame = await captionFrame(page);
      r.firstSight = await firstSight(frame);
      const report = await ask<CleanReport>(worker, tabId, { type: "distill:caption:clean" });
      r.lang = report.lang;
      r.langFrom = report.langFrom;
      // What page.ts hands detectLang: the running text's blocks (kept in this local report only, for tuning).
      const model = await ask<{ blocks: { kind: string; text?: string }[] }>(worker, tabId, { type: "distill:getPage" });
      const body = model.blocks.filter((b) => ["paragraph", "list", "table", "quote", "code"].includes(b.kind)).map((b) => b.text ?? "").join("\n");
      r.langInput = { chars: body.length, sample: body.slice(0, 600) };
      // What detectLang says on the page's whole visible text (title included): the input page.ts could fall back to
      // when the running text is too short to name a language (an old company site is all menu and footer).
      const whole = await page.evaluate(() => `${document.title}\n${document.body?.innerText ?? ""}`);
      r.langOfWholePage = detectLang(whole.slice(0, 20_000));
      await page.waitForTimeout(400);
      await shot("first");

      // #5: the card, and More open with it.
      r.contacts = await ask<ContactItem[]>(worker, tabId, { type: "distill:caption:contact" });
      await frame.getByTestId("cap-more-btn").click();
      await settled(page);
      await page.waitForTimeout(300);
      await shot("more");
      // G6: an address the card found, shown on the page (when it is in a part Distill kept).
      const address = frame.locator('[data-testid="cap-contact-item"][data-kind="address"]').first();
      const showIt = address.getByRole("button", { name: "Show on page" });
      if (await showIt.count()) {
        await showIt.click();
        await settled(page);
        await page.waitForTimeout(500);
        await shot("address-shown");
      }
      await frame.locator("body").press("Escape");
      await settled(page);

      // #9: the counts, then Next (it focuses a field; nothing is typed, nothing is sent).
      r.form = await ask<FormProgress | null>(worker, tabId, { type: "distill:caption:form" });
      if (r.form) {
        // The side panel's reading of the same page: which fields the engine marks required, form by form.
        r.panelForms = [];
        for (let formIndex = 0; formIndex < 6; formIndex++) {
          const s = await ask<{ fields: { label: string; required: boolean }[] }>(worker, tabId, { type: "distill:getForm", formIndex });
          if (!s.fields.length) break;
          r.panelForms.push({ fields: s.fields.length, required: s.fields.filter((f) => f.required).map((f) => f.label) });
        }
        r.traps = await trapsOf(page);
        const fields = await fieldsSeen(page);
        const expected = fields.find((f) => f.required && f.empty) ?? fields.find((f) => f.empty) ?? null;
        await frame.getByTestId("cap-form-next").click();
        await page.waitForTimeout(900); // the smooth scroll
        const focused = await focusedField(page);
        const after = await ask<FormProgress | null>(worker, tabId, { type: "distill:caption:form" });
        r.next = { focused, expected, after };
        await shot("form-next");
        const trapsAfter = await trapsOf(page);
        r.traps = trapsAfter;
      }
      r.status = "done";
    } catch (e) {
      if (r.status === "skipped" && r.reason) throw e;
      r.status = "failed";
      r.reason = e instanceof Error ? e.message.split("\n")[0] : String(e);
      throw e;
    } finally {
      writeFileSync(join(dir, "metrics.json"), JSON.stringify(r, null, 2));
      await context.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ext, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
