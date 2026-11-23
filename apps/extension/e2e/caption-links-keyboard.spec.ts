// Spark round 3, r3-10 fix 3: a link note can be used with the keyboard alone, on the demo page caption-links.html.
// A link focused with Tab shows its note; Tab moves to the note's Copy button; Enter copies; Esc closes the note and
// focus is back on the link; Shift+Tab from Copy goes back to the link; Tab from Copy goes on to the next link.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");

/** The note's text while it is up, or null. Runs in the page (the e2e build opens the note's shadow root). */
const note = (page: Page) => page.evaluate(() => {
  const host = document.querySelector("distill-link-note") as HTMLElement | null;
  if (!host || getComputedStyle(host).visibility !== "visible") return null;
  return host.shadowRoot?.querySelector(".note")?.textContent ?? "";
});

/** Where the keyboard is: a page element's id, or "copy" when it is on the note's button. */
const focus = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  if (a?.localName === "distill-link-note") {
    const inner = a.shadowRoot?.activeElement as HTMLElement | null;
    return inner?.localName === "button" ? "copy" : "note";
  }
  return a?.id || a?.localName || "";
});

test("caption links by keyboard: Tab shows the note and reaches Copy, Enter copies, Esc closes, focus returns to the link", async ({ distill }) => {
  const tab = await distill.openTab("caption-links");
  const page = tab.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await distill.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: distill.origin });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await page.evaluate(() => navigator.clipboard.writeText(""));

  // A click on the paragraph's first words (no link there) starts the Tab order in the page right before the PDF link.
  const p1 = await page.locator("#p1").boundingBox();
  await page.mouse.click((p1?.x ?? 0) + 5, (p1?.y ?? 0) + 8);
  await page.mouse.move(5, 300);
  for (let i = 0; i < 6 && (await focus(page)) !== "pdf"; i++) await page.keyboard.press("Tab");
  expect(await focus(page)).toBe("pdf");
  await expect.poll(() => note(page)).toBe("127.0.0.1On this sitePDF file");

  // The PDF note has no button: Tab goes straight on to the next link, whose note comes up.
  await page.keyboard.press("Tab");
  expect(await focus(page)).toBe("utm");
  await expect.poll(() => note(page)).toBe("mojedane.czLeaves this siteTracking tags: utm_source, utm_medium, utm_campaignCopy clean link");

  // Tab moves into the note, onto Copy; the note stays up.
  await page.keyboard.press("Tab");
  expect(await focus(page)).toBe("copy");
  expect(await note(page)).toContain("Copy clean link");
  // The button shows it has the keyboard (its focus ring).
  expect(await page.evaluate(() => {
    const b = document.querySelector("distill-link-note")?.shadowRoot?.querySelector("button");
    return b ? b.matches(":focus-visible") && getComputedStyle(b).outlineStyle !== "none" : false;
  })).toBe(true);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, "r3-10-link-note-keyboard.jpg"), type: "jpeg", quality: 80, clip: { x: 0, y: 0, width: 1440, height: 520 } });

  // Shift+Tab goes back to the link, and its note is still there.
  await page.keyboard.press("Shift+Tab");
  expect(await focus(page)).toBe("utm");
  await page.waitForTimeout(300);
  expect(await note(page)).toContain("Copy clean link");

  // Tab to Copy again, Esc: the note goes and the keyboard is back on the link (it does not bring the note back).
  await page.keyboard.press("Tab");
  expect(await focus(page)).toBe("copy");
  await page.keyboard.press("Escape");
  await expect.poll(() => note(page)).toBeNull();
  expect(await focus(page)).toBe("utm");
  await page.waitForTimeout(300);
  expect(await note(page)).toBeNull();

  // Shift+Tab then Tab: back on the link by keyboard, its note shows again. Tab, Enter: the clean link is copied, the
  // note goes after a moment and the keyboard is back on the link, not lost to the page's start.
  await page.keyboard.press("Shift+Tab");
  expect(await focus(page)).toBe("pdf");
  await page.keyboard.press("Tab");
  expect(await focus(page)).toBe("utm");
  await expect.poll(() => note(page)).toContain("Copy clean link");
  await page.keyboard.press("Tab");
  expect(await focus(page)).toBe("copy");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("https://www.mojedane.cz/clanek?id=12");
  await expect.poll(() => note(page)).toContain("Copied");
  await expect.poll(() => note(page)).toBeNull();
  expect(await focus(page)).toBe("utm");

  // Tab from Copy goes on to what follows the link in the page: the next link, with its own note.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  expect(await focus(page)).toBe("utm");
  await expect.poll(() => note(page)).toContain("Copy clean link");
  await page.keyboard.press("Tab");
  expect(await focus(page)).toBe("copy");
  await page.keyboard.press("Tab");
  expect(await focus(page)).toBe("google");
  await expect.poll(() => note(page)).toBe("mvcr.czLeaves this siteGoes through a redirect to mvcr.czCopy clean link");

  // Esc on the link itself closes the note and leaves the keyboard where it is.
  await page.keyboard.press("Escape");
  await expect.poll(() => note(page)).toBeNull();
  expect(await focus(page)).toBe("google");

  // The page never scrolled for any of this.
  expect(await page.evaluate(() => scrollY)).toBe(0);
});
