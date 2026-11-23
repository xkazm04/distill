// Check a claim on the web (r2-02) on an English article, in real Chromium. The e2e build has no Firebase: the stand-in
// model answers checkClaim with "supported", and its stand-in search results are two https pages (one listed twice)
// and one plain-http page, so the door and the links are exercised. What is checked: asked once before anything is
// sent; after yes the top three are checked by themselves; a fourth on a click; the switch in More stops the
// automatic part; what would have been sent is the sentence, the title and the address, never the form or the query.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const QUESTION = "Checking facts sends sentences of this page to Google. Check facts?";

/** caption/frame/Translate.tsx E2E_FAKE_AI_KEY: the stand-in model's switch, read by the e2e build only. */
async function fakeModel(worker: Worker, opts: { fail?: string; source?: "on_device" | "in_cloud"; delayMs?: number } = {}) {
  await worker.evaluate(async (o) => { await chrome.storage.session.set({ "distill:e2e:fakeAi": o }); }, opts);
}
/** The prompts the stand-in grounded run was handed (ClaimCheck.tsx, e2e build only). */
const sentPrompts = (worker: Worker) =>
  worker.evaluate(async () => ((await chrome.storage.session.get("distill:e2e:sent"))["distill:e2e:sent"] as string[] | undefined) ?? []);
const stored = (worker: Worker) => worker.evaluate(async () => (await chrome.storage.local.get("distill:checks"))["distill:checks"]);

/** Scrolls More so `testId` (the nth one) is at its top, then lets the scroll settle. */
async function showInMore(frame: Frame, testId: string, nth = 0) {
  await frame.getByTestId(testId).nth(nth).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await frame.page().waitForTimeout(300);
}

const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `r2-02-${name}.jpg`), type: "jpeg", quality: 85 });
};

async function openArticle(distill: { openTab(n: string): Promise<{ page: Page; id: number; url: string }>; worker: Worker }, fake: Parameters<typeof fakeModel>[1] = {}) {
  const tab = await distill.openTab("caption-check");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  // What the person types into the page's form must never reach a prompt.
  await tab.page.fill("#name", "Zqxvlenka Wbrtnovsky");
  await tab.page.fill("#letter", "ZQX-letter-4711 the bridge is too expensive");
  await fakeModel(distill.worker, { source: "in_cloud", ...fake });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  return { tab, frame };
}

async function openMore(frame: Frame) {
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
}

const check = (frame: Frame, i: number) => frame.getByTestId("cap-claim").nth(i).getByTestId("cap-check");

test("check: asked once, then the top three are checked by themselves with sources; a fourth on a click; nothing of the form is sent", async ({ distill }) => {
  const { tab, frame } = await openArticle(distill, { delayMs: 400 });
  await openMore(frame);
  const claims = frame.getByTestId("cap-claim");
  await expect(claims).toHaveCount(6);

  // Asked once, before anything is sent.
  const controls = frame.getByTestId("cap-checks");
  await expect(controls).toContainText(QUESTION);
  await expect(controls.getByRole("button", { name: "Check facts" })).toBeVisible();
  await expect(controls.getByRole("button", { name: "Not now" })).toBeVisible();
  await page_wait(tab.page, 600);
  expect(await sentPrompts(distill.worker)).toEqual([]);
  await expect(frame.getByTestId("cap-chip")).toHaveText("No AI used");
  await showInMore(frame, "cap-checks");
  await shot(tab.page, "consent");

  // Yes: the first three are checked by themselves, one after the other; the rest wait for a click.
  await controls.getByTestId("cap-check-agree").click();
  await expect(check(frame, 0)).toHaveAttribute("data-state", /checking|done/);
  for (let i = 0; i < 3; i++) await expect(check(frame, i)).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  for (const i of [3, 4, 5]) await expect(check(frame, i).getByTestId("cap-check-btn")).toBeVisible();
  expect(await stored(distill.worker)).toEqual({ consent: "yes", auto: true });
  await expect(frame.getByTestId("cap-checks-count")).toHaveText("Checked 3 of 6 claims in the cloud.");
  // The strip's chip no longer says "No AI used": sentences went to the cloud.
  await expect(frame.getByTestId("cap-chip")).toHaveText("In the cloud");
  await expect(frame.getByTestId("cap-chip")).toHaveAttribute("title", /^3 claims checked on the web in the cloud/);

  // A verdict: the word (with its shape), where it ran from the run's answer, the reason, the service's sources.
  const first = check(frame, 0);
  await expect(first.getByTestId("cap-check-verdict")).toHaveText(/Supported/);
  await expect(first.getByTestId("cap-check-where")).toHaveText("In the cloud");
  await expect(first.getByTestId("cap-check-where")).toHaveAttribute("data-src", "in_cloud");
  await expect(first.getByTestId("cap-check-where")).toHaveAttribute("title", /only this sentence, the page's title and its address are sent/);
  await expect(first.getByTestId("cap-check-reason")).toHaveText("(stand-in model) Other sources say the same.");
  const links = first.getByTestId("cap-check-source");
  await expect(links).toHaveCount(2); // the repeat listed once; the http page refused
  await expect(links.nth(0)).toHaveText("Example News: the figures checked");
  await expect(links.nth(0)).toHaveAttribute("href", "https://example.com/fact-check");
  await expect(links.nth(1)).toHaveAttribute("href", "https://example.org/wiki/claim");
  for (const a of await links.all()) {
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", /noopener/);
  }
  await expect(first.getByTestId("cap-check-dropped")).toHaveText("Distill left out 1 part of the answer it could not trust.");
  await showInMore(frame, "cap-claim", 0);
  await shot(tab.page, "verdicts");

  // A fourth claim on a click: Check -> Checking... -> its verdict.
  await check(frame, 3).getByTestId("cap-check-btn").click();
  await expect(check(frame, 3)).toContainText("Checking...");
  await expect(check(frame, 3)).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  await expect(check(frame, 4).getByTestId("cap-check-btn")).toBeVisible();

  // What was sent: per check the claim, the title and the address without its query; no form, no other text.
  const prompts = await sentPrompts(distill.worker);
  expect(prompts).toHaveLength(4);
  const texts = await claims.locator(".claim-text").allTextContents();
  const path = new URL(tab.url).pathname;
  prompts.forEach((p, n) => {
    const i = n < 3 ? n : 3;
    expect(p).toContain(texts[i]!);
    for (const [j, other] of texts.entries()) if (j !== i) expect(p).not.toContain(other);
    expect(p).toContain('source-title="River town opens its new bridge - Example Valley News"');
    expect(p).toContain(`source-url=${JSON.stringify(new URL(tab.url).origin + path)}>`);
    expect(p).not.toContain("?t=");
    for (const secret of ["Zqxvlenka", "Wbrtnovsky", "ZQX", "too expensive", "Write to the editor", "Subscribe"]) expect(p).not.toContain(secret);
  });
  // Nothing is changed on the page by a check, and the form keeps what was typed.
  await expect(tab.page.locator("#name")).toHaveValue("Zqxvlenka Wbrtnovsky");
});

test("check: Not now sends nothing; after yes with the switch off nothing starts by itself, Check all checks every claim", async ({ distill }) => {
  const one = await openArticle(distill);
  await openMore(one.frame);
  await one.frame.getByTestId("cap-check-notnow").click();
  await expect(one.frame.getByTestId("cap-check-consent")).toHaveCount(0);
  await expect(one.frame.getByTestId("cap-checks")).toContainText("Nothing is checked on the web unless you press Check.");
  await page_wait(one.tab.page, 600);
  expect(await sentPrompts(distill.worker)).toEqual([]);
  expect(await stored(distill.worker)).toMatchObject({ consent: "no" });

  // A Check asks again, in its own row; yes checks that claim, then the top three by themselves.
  await check(one.frame, 4).getByTestId("cap-check-btn").click();
  await expect(check(one.frame, 4).getByTestId("cap-check-consent")).toContainText(QUESTION);
  await check(one.frame, 4).getByTestId("cap-check-agree").click();
  for (const i of [4, 0, 1, 2]) await expect(check(one.frame, i)).toHaveAttribute("data-state", "done", { timeout: 10_000 });

  // The switch in More stops the automatic part, and it is stored on the device.
  const auto = one.frame.getByTestId("cap-check-auto");
  await expect(auto).toBeChecked();
  await auto.uncheck();
  expect(await stored(distill.worker)).toEqual({ consent: "yes", auto: false });

  // The next page: no question, nothing starts by itself.
  const sentBefore = (await sentPrompts(distill.worker)).length;
  const two = await openArticle(distill);
  await openMore(two.frame);
  await expect(two.frame.getByTestId("cap-claim")).toHaveCount(6);
  await expect(two.frame.getByTestId("cap-check-consent")).toHaveCount(0);
  await expect(two.frame.getByTestId("cap-check-auto")).not.toBeChecked();
  await page_wait(two.tab.page, 800);
  expect((await sentPrompts(distill.worker)).length).toBe(sentBefore);
  for (let i = 0; i < 6; i++) await expect(check(two.frame, i)).toHaveAttribute("data-state", "none");
  await showInMore(two.frame, "cap-checks");
  await shot(two.tab.page, "switch-off");

  await two.frame.getByTestId("cap-check-all").click();
  for (let i = 0; i < 6; i++) await expect(check(two.frame, i)).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  await expect(two.frame.getByTestId("cap-check-all")).toBeDisabled();
  expect((await sentPrompts(distill.worker)).length).toBe(sentBefore + 6);
});

test("check: a busy service is said in plain words with Try again", async ({ distill }) => {
  await distill.worker.evaluate(async () => { await chrome.storage.local.set({ "distill:checks": { consent: "yes", auto: false } }); });
  const { tab, frame } = await openArticle(distill, { fail: "busy:checkClaim" });
  await openMore(frame);
  await check(frame, 1).getByTestId("cap-check-btn").click();
  await expect(check(frame, 1)).toHaveAttribute("data-state", "failed", { timeout: 10_000 });
  await expect(check(frame, 1)).toContainText("Not checked: The AI is busy right now.");
  await expect(check(frame, 1).getByTestId("cap-check-retry")).toBeVisible();
  await showInMore(frame, "cap-claim", 1);
  await shot(tab.page, "failed");

  // The service is back: Try again checks it.
  await fakeModel(distill.worker, { source: "in_cloud" });
  await check(frame, 1).getByTestId("cap-check-retry").click();
  await expect(check(frame, 1)).toHaveAttribute("data-state", "done", { timeout: 10_000 });
  await expect(check(frame, 1).getByTestId("cap-check-verdict")).toHaveText(/Supported/);
});

/** A short wait, to show that nothing happens by itself (no request can be awaited when none should be made). */
function page_wait(page: Page, ms: number) {
  return page.waitForTimeout(ms);
}
