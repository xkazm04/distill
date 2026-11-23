// Spark round 3, r3-08: ask this page, on the device only, in real Chromium with the e2e build's stand-in model (it
// answers with the sentence of the main text that shares the most words with the question, else with nothing). What is
// checked is the mechanism: the answer, where it ran, Show me's highlight on the page's own sentence, the refusal
// "This page does not say", that the question is kept nowhere, that Close takes the highlight away, and that with no
// model (or on a site that blocks the model in frames) the box says why and offers nothing to send.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { captionFrame, showPart, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

/** Screenshots for the spark board, outside the repo on purpose. */
const EVIDENCE = process.env.E2E_EVIDENCE_DIR ?? "C:\\Users\\kazda\\kiro\\distill\\.spark\\Spark\\evidence\\r3";

async function fakeModel(worker: Worker, opts: { fail?: string; source?: "on_device" | "in_cloud" } = {}) {
  await worker.evaluate(async (o) => { await chrome.storage.session.set({ "distill:e2e:fakeAi": o }); }, opts);
}

const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `caption-ask-${name}.png`) });
  try {
    mkdirSync(EVIDENCE, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 82 });
  } catch { /* the evidence folder is a convenience of the owner's machine */ }
};

const shown = (page: Page) => page.evaluate(() => {
  const h = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get("distill-show");
  const range = h ? Array.from(h)[0] : null;
  if (!range) return null;
  const box = range.getBoundingClientRect();
  return { text: range.toString(), top: box.top, bottom: box.bottom, h: innerHeight };
});

async function openMore(frame: Frame, part?: string) {
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  // r5-02: More is in parts; the section asked for is in its part.
  if (part) await showPart(frame, part);
}

async function ask(frame: Frame, question: string) {
  await showPart(frame, "cap-ask-input"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-input").fill(question);
  await showPart(frame, "cap-ask-go"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-go").click();
}

const SATURDAY = "On Saturdays the library opens at 10 in the morning and closes at 2 in the afternoon.";

test("ask: an answer from the page, on this device, with Show me on its sentence; an unanswerable question is refused", async ({ distill }) => {
  const tab = await distill.openTab("caption-ask");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 760 });
  await fakeModel(distill.worker);
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await openMore(frame, "cap-ask");

  const box = frame.getByTestId("cap-ask");
  await expect(box).toHaveAttribute("data-phase", "idle");
  await expect(frame.getByTestId("cap-ask-go")).toBeDisabled();
  await expect(box).toContainText("Your question is never sent to the cloud");

  await ask(frame, "When does the library open on Saturdays?");
  const answer = frame.getByTestId("cap-ask-answer");
  await expect(answer).toBeVisible({ timeout: 10_000 });
  await expect(frame.getByTestId("cap-ask-text")).toHaveText(`[ASK] ${SATURDAY}`);
  const where = frame.getByTestId("cap-ask-where");
  await expect(where).toHaveText("On this device");
  await expect(where).toHaveAttribute("data-src", "on_device");

  // Show me: the page scrolls to the sentence and highlights exactly it, above the strip.
  await showPart(frame, "cap-ask-show"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-show").click();
  await expect.poll(async () => (await shown(page))?.text).toBe(SATURDAY);
  const s = await shown(page);
  expect(s && s.top >= 0 && s.bottom <= s.h * 0.55).toBe(true);
  await page.waitForTimeout(400);
  await shot(page, "r3-08-ask");

  // The question is a typed value: it is kept in no storage the extension has.
  const stored = await distill.worker.evaluate(async () => JSON.stringify([
    await chrome.storage.local.get(null), await chrome.storage.session.get(null), await chrome.storage.sync.get(null)]));
  expect(stored).not.toContain("Saturdays?");
  expect(stored).not.toContain("When does the library");

  // A question the page does not answer: refused, nothing invented.
  await ask(frame, "Who won the football final yesterday?");
  const refused = frame.getByTestId("cap-ask-refused");
  await expect(refused).toBeVisible({ timeout: 10_000 });
  await expect(refused).toContainText("This page does not say.");
  await expect(refused).toHaveAttribute("data-why", "no-answer");
  await expect(frame.getByTestId("cap-ask-answer")).toHaveCount(0);
  await page.waitForTimeout(2600); // Show me's highlight goes
  await shot(page, "r3-08-refused");

  // Close takes everything away: no highlight, no strip.
  await showPart(frame, "cap-ask-input"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-input").fill("When does the library open on Saturdays?");
  await showPart(frame, "cap-ask-go"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-go").click();
  await showPart(frame, "cap-ask-show"); // r5-02: its part of More
  await frame.getByTestId("cap-ask-show").click();
  await expect.poll(async () => (await shown(page))?.text).toBe(SATURDAY);
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect.poll(() => shown(page)).toBeNull();
});

test("ask: a model that answers with nothing is refused as 'This page does not say'", async ({ distill }) => {
  // The stand-in answers with nothing (an answer the door refuses is covered by packages/engine/test/ask.test.ts).
  const tab = await distill.openTab("caption-ask");
  await fakeModel(distill.worker, { fail: "empty:askPage" });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await openMore(frame, "cap-ask");
  await ask(frame, "When does the library open on Saturdays?");
  await expect(frame.getByTestId("cap-ask-refused")).toContainText("This page does not say.", { timeout: 10_000 });
});

test("ask: with no model on this device the box says why and offers nothing to send", async ({ distill }) => {
  // No stand-in model: the e2e build has no AI at all.
  const tab = await distill.openTab("caption-ask");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await openMore(frame, "cap-ask");
  const box = frame.getByTestId("cap-ask");
  await expect(box).toHaveAttribute("data-phase", "unavailable");
  await expect(frame.getByTestId("cap-ask-unavailable")).toContainText("never sent");
  await expect(frame.getByTestId("cap-ask-input")).toHaveCount(0);
  await expect(frame.getByTestId("cap-ask-go")).toHaveCount(0);
});

test("ask: a site that blocks the model in frames gets no question box, and nothing goes to the offscreen document", async ({ distill }) => {
  await fakeModel(distill.worker);
  const tab = await distill.openTab("caption-translate-blocked");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await openMore(frame, "cap-ask");
  await expect(frame.getByTestId("cap-ask-unavailable")).toHaveAttribute("data-why", "blocked");
  await expect(frame.getByTestId("cap-ask-unavailable")).toContainText("never sent to the cloud");
  await expect(frame.getByTestId("cap-ask-input")).toHaveCount(0);
});
