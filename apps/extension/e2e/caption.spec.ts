// The caption on the demo pages: the strip on the page itself (docs/caption.md, slice 1). Hermetic, like the rest of
// this folder; the same measurements run on real sites in live/ (npm run e2e:live).
import { BAR, baseline, captionFrame, firstSight, measure, settled, shownAgain, showPart, startCaption, stripFont } from "./caption";
import { expect, test } from "./harness";

test("caption: the icon cleans the article in place, says what it did, and everything comes back", async ({ distill }) => {
  const tab = await distill.openTab("article");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  const base = await baseline(tab.page);

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  // First sight: one line saying what Distill did, where it ran, More and Original. No next step is suggested: tours
  // start only when the person asks for one.
  expect(await firstSight(frame)).toMatch(/^Removed 6 distractions(?: · 1 thing to do)?$/);
  // r3-09: the article asks riders to send comments until 15 January: one thing to do.
  await expect(frame.getByTestId("cap-status")).toHaveText("Removed 6 distractions · 1 thing to do");
  await expect(frame.getByTestId("cap-chip")).toHaveText("No AI used");
  await expect(frame.getByTestId("cap-row").locator(":scope > button")).toHaveCount(2); // More, Original
  // r5-03: what the eye reads: a sentence and the facts as chips (each opens its part of More).
  await expect(frame.getByTestId("cap-sentence")).toHaveText("Page cleaned");
  await expect(frame.getByTestId("cap-fact")).toHaveText(["6 removed", "1 to do"]);
  expect(await stripFont(frame)).toContain("Atkinson Hyperlegible Next");

  // The cookie banner, menu, ads and footer are gone; the article is all there.
  await expect(tab.page.locator(".banner")).toBeHidden();
  await expect(tab.page.locator("nav")).toBeHidden();
  await expect(tab.page.locator("footer")).toBeHidden();
  await expect(tab.page.locator("article")).toBeVisible();
  const m = await measure(tab.page, base);
  expect(m.strip.share).toBeLessThanOrEqual(BAR.shareDesktop);
  expect(m.strip.onTop, `covered by ${m.strip.blockedBy.join(", ")}`).toBe(true);
  expect(m.contentKept).toBe(1);
  expect(m.h1Kept).toBe(true);
  expect(m.overflow).toBe(false);
  expect(m.removed).toBe(6);

  // More: the strip grows upward with what was removed; one item comes back.
  await frame.getByTestId("cap-more-btn").click();
  await showPart(frame, "cap-removed-item"); // r5-02: its part of More
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  await expect(frame.getByTestId("cap-removed-item")).toHaveCount(6);
  await expect(frame.getByTestId("cap-model")).toHaveAttribute("data-state", /^(available|downloadable|downloading|unavailable)$/);
  await showPart(frame, "cap-removed"); // r5-02: What was removed
  await frame.getByRole("button", { name: "Show Cookie notice again" }).click();
  await expect(tab.page.locator(".banner")).toBeVisible();
  await expect(frame.getByTestId("cap-status")).toHaveText("Removed 6 distractions · 1 back · 1 thing to do");
  await settled(tab.page);
  const grown = await tab.page.locator("distill-caption").boundingBox();
  expect(grown?.height ?? 0).toBeGreaterThan(m.strip.height);
  await frame.locator("body").press("Escape");
  await expect(frame.getByTestId("cap-more")).toBeHidden();

  // Original: everything as the site made it; Back to Distill hides it all again.
  await frame.getByTestId("cap-original").click();
  await expect(frame.getByTestId("cap-back")).toBeVisible();
  expect(await shownAgain(tab.page)).toBe(1);
  await frame.getByTestId("cap-back").click();
  await expect(tab.page.locator("nav")).toBeHidden();
  await expect(tab.page.locator(".banner")).toBeVisible(); // brought back by the person, so it stays

  // A second click on the icon takes Distill off the page, leaving nothing behind.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(tab.page.locator("distill-caption")).toHaveCount(0);
  expect(await tab.page.evaluate(() => document.querySelectorAll("[data-distill-hide], [data-distill-spacer], style[data-distill]").length)).toBe(0);
  await expect(tab.page.locator("nav")).toBeVisible();
});

test("caption: a Czech form keeps its form, and the strip offers only the form's next empty field", async ({ distill }) => {
  const tab = await distill.openTab("form");
  await tab.page.setViewportSize({ width: 390, height: 844 });
  const base = await baseline(tab.page);
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  expect(await firstSight(frame)).toBe("Nothing to remove · Page in Czech");
  // Ready to send? (#9, round 1): the form's progress and its next empty field are the one thing added. No tour or
  // other next step is suggested (owner decision 3).
  // r5-08: on a phone the row keeps More and Original, and the form's next field waits first in the sheet.
  await expect(frame.getByTestId("cap-row").locator(":scope > button")).toHaveCount(2); // More, Original
  await expect(tab.page.locator("#jmeno")).toBeVisible();
  const m = await measure(tab.page, base);
  expect(m.strip.share).toBeLessThanOrEqual(BAR.sharePhone);
  expect(m.strip.onTop).toBe(true);
  expect(m.overflow).toBe(false);
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-sheet-acts").getByTestId("cap-form-next")).toBeVisible();
});
