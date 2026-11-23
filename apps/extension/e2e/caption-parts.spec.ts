// Spark round 5, in real Chromium on demo pages:
// - r5-02 More in parts: each section in its part, parts with nothing in them have no tab, More opens on the part with
//   the most to say, the person's choice is kept per site on the device, and the tabs are proper ARIA tabs (arrows,
//   Home, End).
// - r5-03 the first line: a short sentence plus chips, each chip opens More on its part, chips that do not fit fold
//   into "+n", and no status text is ever cut (no ellipsis, no overflow) at 1440 and 390 px.
// - r5-08 the strip on a phone: More is a bottom sheet (half, full, closed) that a finger drags (touch emulation), the
//   keyboard works it through buttons, every control is at least 44 x 44 px, and the row keeps More and Original.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Frame, Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { expect, OUT, test, type Distill } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string, whole = false) => {
  mkdirSync(EVIDENCE, { recursive: true });
  if (whole) await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 85, animations: "disabled" });
  else await page.locator("distill-caption").screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 85, animations: "disabled" });
};

async function open(distill: Distill, name: string, view = { width: 1280, height: 900 }) {
  await distill.worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
  const tab = await distill.openTab(name);
  await tab.page.setViewportSize(view);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  return { ...tab, frame };
}

const tabs = (frame: Frame) => frame.getByRole("tab").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")?.replace("cap-tab-", "")));
const selected = (frame: Frame) => frame.locator('[role="tab"][aria-selected="true"]').getAttribute("data-testid").then((t) => t?.replace("cap-tab-", ""));

/** The first line, measured: nothing in it is cut (no ellipsis, nothing past its box or the row's). */
async function lineUncut(frame: Frame) {
  return frame.evaluate(() => {
    const line = document.querySelector<HTMLElement>("[data-testid=cap-line]");
    const row = document.querySelector<HTMLElement>("[data-testid=cap-row]");
    if (!line || !row) return { ok: false, why: "no line" };
    const lr = line.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const bad: string[] = [];
    if (line.scrollWidth > line.clientWidth + 1) bad.push(`line overflows ${line.scrollWidth} > ${line.clientWidth}`);
    if (lr.right > rr.right + 1 || lr.left < rr.left - 1) bad.push("line outside the row");
    for (const el of Array.from(line.querySelectorAll<HTMLElement>(".fl-sentence, .fact"))) {
      const r = el.getBoundingClientRect();
      if (r.right > lr.right + 1) bad.push(`${el.textContent} past the line's end`);
      const cs = getComputedStyle(el);
      if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth) bad.push(`${el.textContent} ellipsed`);
      if (el.scrollWidth > el.clientWidth + 1) bad.push(`${el.textContent} cut inside`);
    }
    // The row itself: every control and chip wholly inside the strip.
    for (const el of Array.from(row.querySelectorAll<HTMLElement>("button, .chip"))) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > innerWidth + 1 || r.left < -1)) bad.push(`${el.textContent} off screen`);
    }
    return { ok: bad.length === 0, why: bad.join("; "), sentence: line.querySelector(".fl-sentence")?.textContent ?? "", chips: Array.from(line.querySelectorAll(".fact")).map((c) => c.textContent) };
  });
}

/** Controls smaller than 44 x 44 px to touch (a switch's touch target is its label). */
function smallTargets(frame: Frame) {
  return frame.evaluate(() => {
    const out: string[] = [];
    const seen = new Set<Element>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role=tab], [tabindex='0']"))) {
      const target = el.closest("label") ?? el;
      if (seen.has(target)) continue;
      seen.add(target);
      const r = target.getBoundingClientRect();
      const cs = getComputedStyle(target);
      if (!r.width || !r.height || cs.visibility === "hidden" || target.closest("[hidden], .fl-measure, .vh")) continue;
      if (target.closest(".more") && (r.bottom < 0 || r.top > innerHeight)) continue; // scrolled out of the sheet: measured when scrolled to
      if (r.width < 43.5 || r.height < 43.5) out.push(`${target.getAttribute("data-testid") ?? target.localName}: ${(target.textContent ?? "").trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}

const hostHeight = (page: Page) => page.evaluate(() => Math.round(document.querySelector("distill-caption")?.getBoundingClientRect().height ?? 0));

// ---- r5-02 ----------------------------------------------------------------------------------------------------------

test("more in parts: each section in its part, only parts with something, opens on Check on an article with claims", async ({ distill }) => {
  const { page, frame } = await open(distill, "caption-parts");
  await expect(frame.getByTestId("cap-status")).toContainText("claims to check", { timeout: 15_000 });
  await shot(page, "r5-02-demo-before-open");
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-tabs")).toBeVisible();
  expect(await selected(frame)).toBe("check");
  await expect(frame.getByTestId("cap-part-check").getByTestId("cap-claims")).toBeVisible();
  await expect(frame.getByTestId("cap-part-check").getByTestId("cap-checks")).toBeVisible();
  // The other parts are there, hidden until their tab is chosen; each holds its own sections.
  for (const [part, ids] of Object.entries({
    page: ["cap-gist", "cap-byline"], settings: ["cap-comfort-section", "cap-consent-section", "cap-calm", "cap-terms-section", "cap-dark-section"],
    removed: ["cap-removed", "cap-close", "cap-model"],
  })) {
    for (const id of ids) await expect(frame.getByTestId(`cap-part-${part}`).getByTestId(id)).toBeAttached();
    await expect(frame.getByTestId(`cap-part-${part}`)).toBeHidden();
  }
  // An article: Do holds only its tours (no form, no contacts, nothing asked of the reader).
  await expect.poll(() => tabs(frame)).toEqual(["page", "do", "check", "settings", "removed"]);
  await expect(frame.getByTestId("cap-part-do").getByTestId("cap-tours")).toBeAttached();
  await expect(frame.getByTestId("cap-part-do").locator("section")).toHaveCount(1);
  await shot(page, "r5-02-demo-check");
  await frame.getByTestId("cap-tab-page").click();
  await expect(frame.getByTestId("cap-gist")).toBeVisible();
  await expect(frame.getByTestId("cap-claims")).toBeHidden();
  await shot(page, "r5-02-demo-page");
  await frame.getByTestId("cap-tab-removed").click();
  await expect(frame.getByTestId("cap-removed-item").first()).toBeVisible();
  await expect(frame.getByTestId("cap-close")).toBeVisible();
  await shot(page, "r5-02-demo-removed");
});

test("more in parts: a form that asks things of the reader opens on Do; a page with neither opens on This page", async ({ distill }) => {
  const letter = await open(distill, "caption-hlaseni-zavad");
  await letter.frame.getByTestId("cap-more-btn").click();
  await expect(letter.frame.getByTestId("cap-tabs")).toBeVisible();
  await expect.poll(() => selected(letter.frame)).toBe("do");
  await expect(letter.frame.getByTestId("cap-actions")).toBeVisible();
  await expect(letter.frame.getByTestId("cap-form")).toBeVisible();
  await letter.page.close();

  const shop = await open(distill, "caption-shop-en");
  await shop.frame.getByTestId("cap-more-btn").click();
  await expect.poll(() => selected(shop.frame)).toBe("page");
  await expect(shop.frame.getByTestId("cap-product")).toBeVisible();
  expect(await tabs(shop.frame)).not.toContain("check");
});

test("more in parts: proper tabs - arrows, Home and End move and focus; the choice is kept per site on the device", async ({ distill }) => {
  const { page, frame, id, url } = await open(distill, "caption-parts");
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByRole("tablist")).toHaveAttribute("aria-label", "Parts of More");
  const first = await selected(frame);
  const tab = frame.locator('[role="tab"][aria-selected="true"]');
  await expect(tab).toHaveAttribute("tabindex", "0");
  await expect(frame.locator('[role="tab"][aria-selected="false"]').first()).toHaveAttribute("tabindex", "-1");
  const panelId = await tab.getAttribute("aria-controls");
  await expect(frame.locator(`#${panelId}`)).toHaveAttribute("role", "tabpanel");
  await expect(frame.locator(`#${panelId}`)).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id")) ?? "");
  await tab.focus();
  await page.keyboard.press("End");
  await expect(frame.getByTestId("cap-tab-removed")).toHaveAttribute("aria-selected", "true");
  await expect(frame.getByTestId("cap-tab-removed")).toBeFocused();
  await page.keyboard.press("ArrowRight"); // wraps
  await expect(frame.getByTestId("cap-tab-page")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(frame.getByTestId("cap-tab-removed")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(frame.getByTestId("cap-tab-page")).toBeFocused();
  expect(first).toBe("check");

  // The person chooses Settings: kept for this site, on the device only.
  await settled(page); // the part just shown may have grown the strip
  await frame.getByTestId("cap-tab-settings").click();
  await expect(frame.getByTestId("cap-comfort-section")).toBeVisible();
  const origin = new URL(url).origin;
  await expect.poll(() => distill.worker.evaluate(async () => (await chrome.storage.local.get("distill:moreParts"))["distill:moreParts"])).toEqual({ [origin]: "settings" });
  // Shut and opened again: Settings.
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-more-btn").click();
  await expect.poll(() => selected(frame)).toBe("settings");
  // A new load of the site: Settings again, though the page would open on Check.
  await page.reload();
  expect(await startCaption(distill.worker, id)).toBe(true);
  const again = await captionFrame(page);
  await firstSight(again);
  await again.getByTestId("cap-more-btn").click();
  await expect.poll(() => selected(again)).toBe("settings");
});

// ---- r5-03 ----------------------------------------------------------------------------------------------------------

test("first line: a sentence plus chips, each chip opens More on its part; the full text stays for screen readers", async ({ distill }) => {
  const { page, frame } = await open(distill, "caption-parts", { width: 1440, height: 900 });
  await expect(frame.getByTestId("cap-status")).toContainText("claims to check", { timeout: 15_000 });
  const status = (await frame.getByTestId("cap-status").textContent()) ?? "";
  await expect(frame.getByTestId("cap-status")).toHaveAttribute("role", "status");
  await expect(frame.getByTestId("cap-line")).toHaveAttribute("title", status);
  await expect(frame.getByTestId("cap-sentence")).toHaveText("Page cleaned");
  // Every fact as a chip, in order; on the 992 px strip with Plain, More and Original the last ones fold into "+n".
  const facts = frame.getByTestId("cap-fact");
  const all = ["7 removed", "6 claims", "published 3 years ago", "cookies rejected", "paused 1 video"];
  await expect(frame.getByTestId("cap-fact-more")).toBeVisible();
  const shown = await facts.allTextContents();
  const folded = ((await frame.getByTestId("cap-fact-more").getAttribute("title")) ?? "").split(", ");
  expect([...shown, ...folded]).toEqual(all);
  expect(shown.length).toBeGreaterThanOrEqual(2);
  await expect(frame.getByTestId("cap-fact-more")).toHaveText(`+${folded.length}`);
  // The AI chip stays where it was, after the line.
  await expect(frame.getByTestId("cap-chip")).toBeVisible();
  expect(await lineUncut(frame)).toMatchObject({ ok: true });
  await shot(page, "r5-03-demo-1440");

  // Each chip opens More on its part; "+n" opens it on the first folded chip's part.
  const WHERE: Record<string, [string, string]> = { removed: ["removed", "cap-removed"], claims: ["check", "cap-claims"], date: ["page", "cap-byline"],
    cookies: ["settings", "cap-consent-section"], videos: ["settings", "cap-calm"] };
  const ids = await facts.evaluateAll((els) => els.map((e) => e.getAttribute("data-fact") ?? ""));
  const firstFolded = ["removed", "claims", "date", "cookies", "videos"][ids.length] ?? "";
  for (const fact of [...ids, "+n"]) {
    const [part, section] = WHERE[fact === "+n" ? firstFolded : fact] ?? ["", ""];
    await (fact === "+n" ? frame.getByTestId("cap-fact-more") : frame.locator(`[data-testid=cap-fact][data-fact=${fact}]`)).click();
    await expect(frame.getByTestId("cap-more"), `chip ${fact}`).toBeVisible();
    await expect(frame.getByTestId(`cap-tab-${part}`), `chip ${fact}`).toHaveAttribute("aria-selected", "true");
    await expect(frame.getByTestId(section)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(frame.getByTestId("cap-more")).toHaveCount(0);
    await settled(page); // the frame back to one row before the next chip is clicked
  }
});

test("first line: chips that do not fit fold into +n, the sentence shortens first, nothing is ever cut (1440 to 320 px)", async ({ distill }) => {
  const { page, frame } = await open(distill, "caption-parts", { width: 1440, height: 900 });
  await expect(frame.getByTestId("cap-status")).toContainText("claims to check", { timeout: 15_000 });
  const seen: { width: number; sentence: string; chips: (string | null)[] }[] = [];
  for (const width of [1440, 1024, 800, 640, 560, 480, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250);
    const m = await lineUncut(frame);
    expect(m.why, `at ${width} px`).toBe("");
    seen.push({ width, sentence: m.sentence ?? "", chips: m.chips ?? [] });
    if (width === 390) await shot(page, "r5-03-demo-390");
  }
  const at = (w: number) => seen.find((s) => s.width === w);
  expect(at(1440)?.sentence).toBe("Page cleaned");
  expect(at(320)?.sentence).toBe("Cleaned");
  // Narrow: some chips folded into one "+n" chip, which opens More.
  const narrow = at(320)?.chips ?? [];
  expect(narrow.some((c) => /^\+\d$/.test(c ?? ""))).toBe(true);
  await frame.getByTestId("cap-fact-more").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
});

// ---- r5-08 ----------------------------------------------------------------------------------------------------------

async function touchDrag(cdp: CDPSession, x: number, from: number, to: number) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: from + ((to - from) * i) / steps }] });
    await new Promise((r) => setTimeout(r, 30));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("phone: More is a bottom sheet - half, full by button and by finger, closed by dragging down; 44 px targets", async ({ distill }) => {
  const view = { width: 390, height: 844 };
  const { page, frame } = await open(distill, "caption-parts", view);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await expect(frame.getByTestId("cap-status")).toContainText("claims to check", { timeout: 15_000 });
  // The row keeps More and Original; Translate, Plain, the form check and video skip live in the sheet.
  await expect(frame.getByTestId("cap-row").getByRole("button", { name: /^(More|Original)/ })).toHaveCount(2);
  await expect(frame.getByTestId("cap-row").getByTestId("cap-plain")).toHaveCount(0);
  expect(await smallTargets(frame), "the row at 390 px").toEqual([]);
  expect((await lineUncut(frame)).why).toBe("");
  await shot(page, "r5-08-demo-row", true);

  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "half");
  await expect.poll(() => hostHeight(page)).toBe(Math.round(view.height * 0.5));
  await expect(frame.getByTestId("cap-sheet-grip")).toBeVisible();
  await expect(frame.getByTestId("cap-sheet-acts").getByTestId("cap-plain")).toBeVisible();
  expect(await smallTargets(frame), "the half sheet").toEqual([]);
  await shot(page, "r5-08-demo-half", true);

  // Keyboard: the size button makes it full, the grip answers ArrowDown.
  await frame.getByTestId("cap-sheet-size").click();
  await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "full");
  await expect.poll(() => hostHeight(page)).toBe(Math.round(view.height * 0.92));
  expect(await smallTargets(frame), "the full sheet").toEqual([]);
  await shot(page, "r5-08-demo-full", true);
  await frame.getByTestId("cap-sheet-grip").focus();
  await page.keyboard.press("ArrowDown");
  await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "half");

  // A finger: up from the grip to near the top -> full; then down to the bottom -> closed.
  const grip = async () => {
    const b = await page.locator("distill-caption").boundingBox();
    const g = await frame.getByTestId("cap-sheet-grip").boundingBox();
    if (!b || !g) throw new Error("no grip");
    return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  };
  await settled(page);
  let g = await grip();
  await touchDrag(cdp, g.x, g.y, 40);
  await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "full");
  await expect.poll(() => hostHeight(page)).toBe(Math.round(view.height * 0.92));
  await settled(page);
  g = await grip();
  await touchDrag(cdp, g.x, g.y, view.height - 30);
  await expect(frame.getByTestId("cap-more")).toHaveCount(0);
  await expect.poll(() => hostHeight(page)).toBeLessThan(view.height * 0.2);
  // Opened again: half; the Close button shuts it and focus goes back to More.
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "half");
  await frame.getByTestId("cap-sheet-close").click();
  await expect(frame.getByTestId("cap-more")).toHaveCount(0);
  await expect(frame.getByTestId("cap-more-btn")).toBeFocused();
});

test("phone: reduced motion - the sheet changes size without easing; desktop keeps More above the row, no sheet", async ({ distill }) => {
  const tab = await distill.openTab("caption-parts");
  await tab.page.emulateMedia({ reducedMotion: "reduce" });
  await tab.page.setViewportSize({ width: 390, height: 844 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toHaveAttribute("data-sheet", "half");
  await expect.poll(() => tab.page.evaluate(() => (document.querySelector("distill-caption") as HTMLElement).style.transition)).toBe("none");
  await frame.getByTestId("cap-sheet-size").click();
  // No easing: the full height at once.
  await expect.poll(() => hostHeight(tab.page), { timeout: 300 }).toBe(Math.round(844 * 0.92));

  await frame.getByTestId("cap-sheet-close").click();
  await tab.page.setViewportSize({ width: 1280, height: 900 });
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).not.toHaveAttribute("data-sheet", /./);
  await expect(frame.getByTestId("cap-sheet-grip")).toBeHidden();
  expect(await hostHeight(tab.page)).toBeLessThanOrEqual(Math.round(900 * 0.45));
});
