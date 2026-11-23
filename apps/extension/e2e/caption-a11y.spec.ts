// Spark round 5, r5-10: accessible everywhere. In real Chromium on demo pages, with axe-core (e2e/axe.ts):
// - the strip inside its frame in every state: the first line; More on each of its parts; a tour running; Original;
//   the phone sheet at half and full; in light and dark. No serious or critical finding.
// - the cleaned demo pages before and after Clean: Distill's changes never add a finding the page did not have (per
//   rule, the elements flagged after Clean are at most those flagged before), and none serious or critical is added.
// The report (every finding, per state and page) goes to e2e/out/axe/report.json, or E2E_AXE_REPORT.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Frame, Page } from "playwright/test";
import { axeFrame, axePage, describe as said, type Finding, perRule, severe, tally } from "./axe";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { type Distill, expect, OUT, test } from "./harness";

const REPORT = process.env.E2E_AXE_REPORT || join(OUT, "axe", "report.json");
/** One file per check (a failed test restarts the worker, and its memory with it); merged into REPORT after each worker. */
const PARTS = join(OUT, "axe", "parts");
type Entry = { kind: "strip"; key: string; found: Finding[] } | { kind: "page"; key: string; before: Finding[]; after: Finding[] };
const keep = (e: Entry) => {
  mkdirSync(PARTS, { recursive: true });
  writeFileSync(join(PARTS, `${e.kind}-${e.key.replace(/[^a-z0-9]+/gi, "-")}.json`), JSON.stringify(e));
};
test.afterAll(() => {
  const entries = existsSync(PARTS) ? readdirSync(PARTS).map((f) => JSON.parse(readFileSync(join(PARTS, f), "utf8")) as Entry) : [];
  const strip = Object.fromEntries(entries.flatMap((e) => e.kind === "strip" ? [[e.key, e.found]] : []));
  const pages = Object.fromEntries(entries.flatMap((e) => e.kind === "page" ? [[e.key, { before: e.before, after: e.after }]] : []));
  const summary = {
    strip: Object.fromEntries(Object.entries(strip).map(([k, v]) => [k, tally(v)])),
    pages: Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, { before: tally(v.before), after: tally(v.after) }])),
  };
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify({ summary, strip, pages }, null, 2));
});

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function open(distill: Distill, name: string, size: { width: number; height: number }, scheme: "light" | "dark") {
  await distill.worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
  const tab = await distill.openTab(name);
  await tab.page.setViewportSize(size);
  await tab.page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  return { page: tab.page, frame };
}

/** Runs axe on the strip as it is now and keeps the result under `state`. */
async function check(page: Page, frame: Frame, state: string) {
  await settled(page).catch(() => undefined);
  const found = await axeFrame(frame);
  keep({ kind: "strip", key: state, found });
  return found;
}

for (const scheme of ["light", "dark"] as const) {
  test(`axe: the strip in every state, desktop, ${scheme}`, async ({ distill }) => {
    const { page, frame } = await open(distill, "caption-parts", DESKTOP, scheme);
    await expect(frame.getByTestId("cap-status")).toContainText("claims to check", { timeout: 15_000 });
    const bad: string[] = [];
    const note = (state: string, f: Finding[]) => { if (severe(f).length) bad.push(`${state}:\n${said(severe(f))}`); };

    note("first line", await check(page, frame, `${scheme} desktop first line`));

    await frame.getByTestId("cap-more-btn").click();
    await expect(frame.getByTestId("cap-more")).toBeVisible();
    await expect(frame.getByTestId("cap-gist")).toHaveAttribute("data-phase", "ready");
    const parts = await frame.getByRole("tab").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
    expect(parts.length).toBeGreaterThanOrEqual(4);
    for (const p of parts) {
      await frame.getByTestId(p).click();
      await expect(frame.getByTestId(p)).toHaveAttribute("aria-selected", "true");
      note(`More, ${p}`, await check(page, frame, `${scheme} desktop More ${p.replace("cap-tab-", "")}`));
    }

    // A tour running (Do part).
    await frame.getByTestId("cap-tab-do").click();
    const start = frame.locator("[data-testid^=cap-tour-start-]").first();
    await expect(start).toBeVisible({ timeout: 15_000 });
    await start.click();
    await expect(frame.getByTestId("cap-tour-status")).toHaveText(/^Step 1 of/);
    note("tour", await check(page, frame, `${scheme} desktop tour`));
    await frame.getByTestId("cap-tour-end").click();
    await expect(frame.getByTestId("cap-tour-status")).toHaveCount(0);

    await frame.getByTestId("cap-original").click();
    await expect(frame.getByTestId("cap-back")).toBeVisible();
    note("Original", await check(page, frame, `${scheme} desktop original`));

    expect(bad, bad.join("\n\n")).toEqual([]);
  });

  test(`axe: the strip on a phone, the sheet half and full, ${scheme}`, async ({ distill }) => {
    const { page, frame } = await open(distill, "caption-parts", PHONE, scheme);
    await expect(frame.getByTestId("cap-status")).toContainText("claims to check", { timeout: 15_000 });
    const bad: string[] = [];
    const note = (state: string, f: Finding[]) => { if (severe(f).length) bad.push(`${state}:\n${said(severe(f))}`); };
    note("phone first line", await check(page, frame, `${scheme} phone first line`));
    await frame.getByTestId("cap-more-btn").click();
    await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "half");
    note("sheet half", await check(page, frame, `${scheme} phone sheet half`));
    await frame.getByTestId("cap-sheet-size").click();
    await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "full");
    note("sheet full", await check(page, frame, `${scheme} phone sheet full`));
    expect(bad, bad.join("\n\n")).toEqual([]);
  });
}

/** The demo pages, read by axe before Distill and after Clean. */
const PAGES = ["article", "caption-claims", "caption-actions", "caption-comfort", "caption-shop", "caption-tables",
  "caption-consent", "caption-reflow", "caption-video", "caption-media", "caption-parts", "caption-links", "caption-terms",
  "caption-dark", "caption-form-cs", "caption-autoservis", "caption-sticky", "caption-a11y"];

for (const name of PAGES) {
  test(`axe: ${name} before and after Clean - nothing Distill did adds a finding`, async ({ distill }) => {
    await distill.worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
    const tab = await distill.openTab(name);
    await tab.page.setViewportSize(DESKTOP);
    await tab.page.emulateMedia({ reducedMotion: "reduce" });
    const before = await axePage(tab.page);
    expect(await startCaption(distill.worker, tab.id)).toBe(true);
    const frame = await captionFrame(tab.page);
    await firstSight(frame);
    await tab.page.waitForTimeout(1500); // what runs after first sight (pictures, link notes, the AI's marks)
    await settled(tab.page);
    const after = await axePage(tab.page);
    keep({ kind: "page", key: name, before, after });
    const was = perRule(before);
    // Not "region" (moderate: content outside landmarks). It names the topmost box with no landmark in it, so a live
    // region Distill adds inside an article (Explain's note, role=status, which axe counts as a region) makes it list
    // the article's children one by one instead of the article once: more elements, the same content.
    const added = after.filter((f) => f.id !== "region" && f.nodes.length > (was[f.id] ?? 0));
    expect(added.map((f) => `${f.impact} ${f.id}: ${was[f.id] ?? 0} -> ${f.nodes.length} (${f.nodes.map((n) => n.target).slice(0, 4).join("; ")})`),
      `Clean added axe findings on ${name}:\n${said(added)}`).toEqual([]);
  });
}
