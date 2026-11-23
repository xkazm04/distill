// Spark round 4: tours started by hand (r4-08), in real Chromium with the strip. On the village notice
// (caption-actions.html, no model): "Before you go" and "Call or write" from the things to do, each step's exact words
// highlighted (a CSS highlight over the page's own text, nothing added), Next, Back, Esc, the End key and End, Original
// and close. On the claims demo (caption-claims.html, the e2e build's stand-in model): "Just the facts" steps through the
// gist's points, then the claims. Nothing starts by itself. Real sites: live/probes/tours.live.ts.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { captionFrame, firstSight, showPart, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};

async function fakeModel(worker: Worker) {
  await worker.evaluate(async () => { await chrome.storage.session.set({ "distill:e2e:fakeAi": {} }); });
}

/** The tour's highlight on the page: the words of its one range, or null when there is none. */
const tourWords = (page: Page) => page.evaluate(() => {
  const h = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get("distill-tour");
  return h ? Array.from(h).map((r) => r.toString().replace(/\s+/g, " ").trim()).join("|") : null;
});
// r3-07 (prices and dates in your terms) wraps a date in a span of its own: the page's words are unchanged.
const unwrapTerms = (html: string) => html.replace(/<span data-distill-term="[a-z]+" data-distill-term-add="[^"]*" title="[^"]*">([^<]*)<\/span>/g, "$1");
const article = (page: Page) => page.locator("article").evaluate((el) => el.innerHTML)
  .then((html) => unwrapTerms(html).replace(/\s(data-distill-[a-z-]+)(="[^"]*")?/g, "").replace(/ style=""/g, ""));

const step = (frame: Frame) => frame.getByTestId("cap-tour-status");
async function openMore(frame: Frame, part?: string) {
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  // r5-02: More is in parts; the section asked for is in its part.
  if (part) await showPart(frame, part);
}

test("tours: Before you go and Call or write step through the things to do, highlight each one, Next/Back/Esc/End", async ({ distill }) => {
  const tab = await distill.openTab("caption-actions");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 760 });
  const before = await article(page);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await expect(frame.getByTestId("cap-status")).toHaveText(/7 things to do$/, { timeout: 10_000 });

  // Nothing starts by itself: no tour line, no tour highlight, a while after Clean.
  await page.waitForTimeout(1200);
  await expect(step(frame)).toHaveCount(0);
  expect(await tourWords(page)).toBeNull();

  // More offers the two tours this page has; no facts tour (no model: no gist, no claims).
  await openMore(frame, "cap-tours");
  await expect(frame.getByTestId("cap-tour")).toHaveCount(2);
  expect(await frame.getByTestId("cap-tour").evaluateAll((els) => els.map((e) => e.getAttribute("data-tour")))).toEqual(["call", "before"]);
  await expect(frame.getByTestId("cap-tour-start-facts")).toHaveCount(0);
  await expect(frame.getByTestId("cap-tour").nth(1)).toContainText("4 steps");
  await page.waitForTimeout(400);
  await expect(step(frame)).toHaveCount(0);

  // Before you go: More closes, the first step is highlighted and named, Next has the focus.
  await page.evaluate(() => scrollTo(0, 0));
  await showPart(frame, "cap-tour-start-before"); // r5-02: its part of More
  await frame.getByTestId("cap-tour-start-before").click();
  await expect(frame.getByTestId("cap-more")).toHaveCount(0);
  await expect(step(frame)).toHaveText("Step 1 of 4 · Pay 800 Kč to 123456789/0100 by 31. 3. 2027");
  await expect.poll(() => tourWords(page)).toBe("Poplatek ve výši 800 Kč za osobu uhraďte převodem na účet 123456789/0100, variabilní symbol je číslo popisné, nejpozději do 31. 3. 2027.");
  await expect(frame.getByTestId("cap-tour-next")).toBeFocused();

  // Next by keyboard: the things to bring, then the deadline (scrolled into the upper half, above the strip).
  await page.keyboard.press("Enter");
  await expect(step(frame)).toHaveText("Step 2 of 4 · Bring: občanský průkaz a doklad o zaplacení za loňský rok");
  await expect.poll(() => tourWords(page)).toMatch(/^S sebou si vezměte občanský průkaz/);
  await page.keyboard.press("Enter");
  await expect(step(frame)).toHaveText("Step 3 of 4 · Deadline: By 28. 2. 2027");
  await expect.poll(() => tourWords(page)).toBe("Kdo žádá o osvobození od poplatku, musí žádost podat do 28. 2. 2027.");
  await page.waitForTimeout(700); // the smooth scroll
  const at = await page.evaluate(() => {
    const r = Array.from((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("distill-tour") ?? [])[0]?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom, h: innerHeight } : null;
  });
  expect(at && at.top >= 0 && at.bottom <= at.h * 0.75).toBe(true);
  await shot(page, "r4-08-demo-before");

  // Back: step 2 again, its words highlighted again.
  await frame.getByTestId("cap-tour-back").click();
  await expect(step(frame)).toHaveText(/^Step 2 of 4 · Bring:/);
  await expect.poll(() => tourWords(page)).toMatch(/^S sebou si vezměte/);
  // Back on the first step says it is off and does nothing; it keeps the focus (it is not disabled, so focus stays).
  await frame.getByTestId("cap-tour-back").click();
  await expect(step(frame)).toHaveText(/^Step 1 of 4/);
  await expect(frame.getByTestId("cap-tour-back")).toHaveAttribute("aria-disabled", "true");
  await expect(frame.getByTestId("cap-tour-back")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(step(frame)).toHaveText(/^Step 1 of 4/);

  // The highlight is on the page's own words: no element added, the text as it was.
  expect(await article(page)).toBe(before);

  // Esc ends it: no highlight, the status line back, focus on More.
  await page.keyboard.press("Escape");
  await expect(step(frame)).toHaveCount(0);
  expect(await tourWords(page)).toBeNull();
  await expect(frame.getByTestId("cap-status")).toHaveText(/7 things to do$/);
  await expect(frame.getByTestId("cap-more-btn")).toBeFocused();

  // Call or write: hours, the phone, the e-mail; the last step's Next says Done and ends it.
  await openMore(frame, "cap-tours");
  await showPart(frame, "cap-tour-start-call"); // r5-02: its part of More
  await frame.getByTestId("cap-tour-start-call").click();
  await expect(step(frame)).toHaveText("Step 1 of 3 · Hours: Po, St 8:00 - 17:00");
  await expect.poll(() => tourWords(page)).toBe("Po, St 8:00 - 17:00");
  await frame.getByTestId("cap-tour-next").click();
  await expect(step(frame)).toHaveText("Step 2 of 3 · Call 377 912 345");
  await expect.poll(() => tourWords(page)).toBe("377 912 345");
  await shot(page, "r4-08-demo-call");
  await frame.getByTestId("cap-tour-next").click();
  await expect(step(frame)).toHaveText("Step 3 of 3 · Write to poplatky@lipova-lhota.example");
  await expect.poll(() => tourWords(page)).toBe("poplatky@lipova-lhota.example");
  await expect(frame.getByTestId("cap-tour-next")).toHaveText("Done");
  await frame.getByTestId("cap-tour-next").click();
  await expect(step(frame)).toHaveCount(0);
  expect(await tourWords(page)).toBeNull();

  // The End key ends one too; and End.
  await openMore(frame, "cap-tours");
  await showPart(frame, "cap-tour-start-call"); // r5-02: its part of More
  await frame.getByTestId("cap-tour-start-call").click();
  await expect(step(frame)).toHaveText(/^Step 1 of 3/);
  await page.keyboard.press("End");
  await expect(step(frame)).toHaveCount(0);
  expect(await tourWords(page)).toBeNull();
  await openMore(frame, "cap-tours");
  await showPart(frame, "cap-tour-start-before"); // r5-02: its part of More
  await frame.getByTestId("cap-tour-start-before").click();
  await expect(step(frame)).toHaveText(/^Step 1 of 4/);
  await frame.getByTestId("cap-tour-end").click();
  await expect(step(frame)).toHaveCount(0);
  expect(await tourWords(page)).toBeNull();

  // Original ends a tour that runs: the page as it was, nothing of the tour.
  await openMore(frame, "cap-tours");
  await showPart(frame, "cap-tour-start-before"); // r5-02: its part of More
  await frame.getByTestId("cap-tour-start-before").click();
  await expect.poll(() => tourWords(page)).not.toBeNull();
  await frame.getByTestId("cap-original").click();
  await expect(frame.getByTestId("cap-back")).toBeVisible();
  expect(await tourWords(page)).toBeNull();
  await frame.getByTestId("cap-back").click();
  await expect(step(frame)).toHaveCount(0);
  expect(await tourWords(page)).toBeNull();

  // Close in the middle of a tour: nothing of it is left.
  await openMore(frame, "cap-tours");
  await showPart(frame, "cap-tour-start-call"); // r5-02: its part of More
  await frame.getByTestId("cap-tour-start-call").click();
  await expect.poll(() => tourWords(page)).not.toBeNull();
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await tourWords(page)).toBeNull();
  await expect(page.locator("[data-distill-tour], #distill-tour-style")).toHaveCount(0);
  expect(await article(page)).toBe(before);
});

test("tours: Just the facts steps through the gist's points, then the claims, with the stand-in model", async ({ distill }) => {
  const tab = await distill.openTab("caption-claims");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 760 });
  await fakeModel(distill.worker);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await expect(frame.getByTestId("cap-status")).toHaveText(/6 claims to check$/, { timeout: 15_000 });
  // Nothing starts by itself, though the gist and the claims are in.
  await page.waitForTimeout(1000);
  await expect(step(frame)).toHaveCount(0);
  expect(await tourWords(page)).toBeNull();

  await openMore(frame, "cap-gist");
  await expect(frame.getByTestId("cap-gist")).toHaveAttribute("data-phase", "ready");
  const points = await frame.getByTestId("cap-gist-point").locator(".gist-text").allTextContents();
  expect(points).toHaveLength(3);
  // The claims as the page underlines them, to compare with the tour's steps.
  const claims = await page.evaluate(() => Array.from((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("distill-claim") ?? [], (r) => r.toString().replace(/\s+/g, " ").trim()));
  expect(claims).toHaveLength(6);

  await showPart(frame, "cap-tours"); // r5-02: the tours are in Do
  await expect(frame.getByTestId("cap-tour-start-facts")).toBeVisible();
  await showPart(frame, "cap-tour-start-facts"); // r5-02: its part of More
  await frame.getByTestId("cap-tour-start-facts").click();
  const first = (await step(frame).textContent()) ?? "";
  const total = Number(/^Step 1 of (\d+) · /.exec(first)?.[1]);
  // Three points, then each claim that is not already a point's sentence; no byline on this page.
  expect(total).toBeGreaterThanOrEqual(3 + 1);
  expect(total).toBeLessThanOrEqual(3 + 6);
  await expect(step(frame)).toHaveText(`Step 1 of ${total} · Main point 1: ${points[0]}`);
  await expect.poll(() => tourWords(page)).not.toBeNull();
  const seen: string[] = [(await tourWords(page)) ?? ""];
  for (let i = 2; i <= total; i++) {
    await frame.getByTestId("cap-tour-next").click();
    if (i <= 3) await expect(step(frame)).toHaveText(`Step ${i} of ${total} · Main point ${i}: ${points[i - 1]}`);
    else await expect(step(frame)).toHaveText(new RegExp(`^Step ${i} of ${total} · Claim to check: `));
    await expect.poll(() => tourWords(page)).not.toBe(seen[seen.length - 1]);
    seen.push((await tourWords(page)) ?? "");
    if (i === 4) await shot(page, "r4-08-demo-facts");
  }
  // Every claim step highlighted one of the page's underlined claims, in reading order, none twice.
  const claimSteps = seen.slice(3);
  for (const w of claimSteps) expect(claims).toContain(w);
  expect(new Set(seen).size).toBe(seen.length);
  expect(claimSteps).toEqual(claims.filter((c) => claimSteps.includes(c)));

  await page.keyboard.press("Escape");
  await expect(step(frame)).toHaveCount(0);
  expect(await tourWords(page)).toBeNull();
  // The claims' own marks are untouched by the tour.
  expect(await page.evaluate(() => (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get("distill-claim")?.size)).toBe(6);
});
