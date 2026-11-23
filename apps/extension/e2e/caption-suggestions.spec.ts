// Google's Search Suggestions under a checked claim (r3-02), in real Chromium. The stand-in grounded run returns a
// searchEntryPoint (fake-ai.ts FAKE_ENTRY) that passes the same door as a real answer's; the strip shows it only in a
// sealed-off frame: sandbox="allow-popups allow-popups-to-escape-sandbox" (no scripts, no same origin, no top
// navigation), srcdoc behind its own CSP, links to a new tab. A hostile snippet tries a script, an onerror handler, a
// javascript: link, a top-navigation link and a meta refresh: none of it may change the strip or the page.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Page, Worker } from "playwright/test";
import { captionFrame, firstSight, showPart, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

type Entry = "sample" | "hostile" | "huge" | "none";

async function openChecked(distill: { openTab(n: string): Promise<{ page: Page; id: number; url: string }>; worker: Worker }, entry: Entry) {
  await distill.worker.evaluate(async (e) => {
    await chrome.storage.session.set({ "distill:e2e:fakeAi": { source: "in_cloud", entry: e } });
    await chrome.storage.local.set({ "distill:checks": { consent: "yes", auto: true } });
  }, entry);
  const tab = await distill.openTab("caption-check");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await frame.getByTestId("cap-more-btn").click();
  await showPart(frame, "cap-claim"); // r5-02: its part of More
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  const first = frame.getByTestId("cap-claim").nth(0).getByTestId("cap-check");
  await expect(first).toHaveAttribute("data-state", "done", { timeout: 15_000 });
  return { tab, frame, first };
}

/** What the strip and the page look like, to compare before and after the snippet had its chance. */
async function snapshot(page: Page, frame: Frame) {
  return {
    url: page.url(),
    paragraphs: await page.locator("p").count(),
    title: await page.title(),
    bodyStart: (await page.evaluate(() => document.body.innerText)).slice(0, 200),
    claims: await frame.getByTestId("cap-claim").count(),
    strip: (await frame.locator("body").innerText()).slice(0, 200),
  };
}

test("suggestions: shown under a checked claim in a sandboxed frame; a chip opens Google in a new tab", async ({ distill }) => {
  await distill.context.route("https://www.google.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<title>Google stand-in</title>ok" }));
  const { tab, frame, first } = await openChecked(distill, "sample");
  const box = first.getByTestId("cap-check-suggestions");
  await expect(box).toBeVisible();
  await expect(box).toContainText("Search on Google");
  const el = box.getByTestId("cap-check-suggestions-frame");
  await expect(el).toHaveAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  expect(await el.getAttribute("src")).toBeNull();
  // The strip's own document holds no markup from the answer: the chips exist only inside the frame's document.
  expect(await frame.locator("a.chip, [data-stand-in]").count()).toBe(0);
  const inner = frame.frameLocator('[data-testid="cap-check-suggestions-frame"]').first();
  await expect(inner.locator("a.chip")).toHaveCount(2);
  await expect(inner.locator("a.chip").first()).toHaveText("stand-in search");

  await first.evaluate((n) => n.closest('[data-testid="cap-claim"]')?.scrollIntoView({ block: "start" }));
  await tab.page.waitForTimeout(400);
  mkdirSync(OUT, { recursive: true });
  await tab.page.screenshot({ path: join(OUT, "r3-02-suggestions.jpg"), type: "jpeg", quality: 85 });

  // A chip opens its search in a NEW tab; the page and the strip stay where they are.
  const before = await snapshot(tab.page, frame);
  const opened = distill.context.waitForEvent("page");
  await inner.locator("a.chip").first().click();
  const popup = await opened;
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://www.google.com/search?q=stand-in+search");
  await popup.close();
  expect(await snapshot(tab.page, frame)).toEqual(before);
});

test("suggestions: a hostile snippet cannot run code, change the strip or the page, or move the tab", async ({ distill }) => {
  const hits: string[] = [];
  await distill.context.route("https://evil.example/**", (r) => { hits.push(r.request().url()); return r.fulfill({ contentType: "text/html", body: "evil" }); });
  await distill.context.route("https://example.com/search-suggestion", (r) => r.fulfill({ contentType: "text/html", body: "<title>ok</title>ok" }));
  const { tab, frame, first } = await openChecked(distill, "hostile");
  const el = first.getByTestId("cap-check-suggestions-frame");
  await expect(el).toHaveAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  const before = await snapshot(tab.page, frame);
  expect(before.bodyStart).not.toBe("x");
  expect(before.strip).not.toBe("x");

  const inner = frame.frameLocator('[data-testid="cap-check-suggestions-frame"]').first();
  await expect(inner.locator("#chip")).toBeVisible();
  // The javascript: link and the top-navigation link do nothing outside the frame.
  await inner.locator("#js").click();
  await inner.locator("#top").click();
  // The meta refresh had its second; the script and the onerror handler had theirs at load.
  await tab.page.waitForTimeout(1_800);
  expect(await snapshot(tab.page, frame)).toEqual(before);
  expect(hits.filter((u) => /\/top$/.test(u))).toEqual([]);
  // The frame's document has an opaque origin and no extension APIs (read with the test's own tools, which the
  // sandbox does not bind): it cannot reach chrome.* or the strip's document.
  const sealed = frame.childFrames().find((f) => f.url() === "about:srcdoc");
  expect(sealed, "the suggestions frame").toBeTruthy();
  expect(await sealed!.evaluate(() => ({
    origin: self.origin,
    ext: typeof (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id,
    parent: (() => { try { return typeof parent.document; } catch { return "blocked"; } })(),
  }))).toEqual({ origin: "null", ext: "undefined", parent: "blocked" });

  // An ordinary link of the snippet still opens in a new tab, and the tab with the page stays.
  const opened = distill.context.waitForEvent("page");
  const chip = frame.frameLocator('[data-testid="cap-check-suggestions-frame"]').first().locator("#chip");
  await chip.click();
  const popup = await opened;
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://example.com/search-suggestion");
  await popup.close();
  expect(await snapshot(tab.page, frame)).toEqual(before);
});

test("suggestions: none in the answer, no frame; one over the size cap is refused and counted", async ({ distill }) => {
  const none = await openChecked(distill, "none");
  await expect(none.first.getByTestId("cap-check-suggestions")).toHaveCount(0);
  await expect(none.first.getByTestId("cap-check-dropped")).toHaveText("Distill left out 1 part of the answer it could not trust.");

  const huge = await openChecked(distill, "huge");
  await expect(huge.first.getByTestId("cap-check-suggestions")).toHaveCount(0);
  // The http source and the refused suggestions.
  await expect(huge.first.getByTestId("cap-check-dropped")).toHaveText("Distill left out 2 parts of the answer it could not trust.");
});
