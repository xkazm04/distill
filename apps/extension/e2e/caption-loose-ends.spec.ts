// Spark round 4, r4-01: round 3's loose ends, on the demo page caption-loose-ends.html (a village's fault-report page:
// its phone and e-mail only in a side column Clean hides, an empty grey bar and a "read also" frame between paragraphs,
// an address over several lines, a box that opens by its class). No model. Real sites: live/probes/loose-ends.live.ts
// and live/probes/consent.live.ts (Didomi).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};

const highlights = (page: Page) => page.evaluate(() => {
  const reg = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
  const all = (name: string) => Array.from(reg?.get(name) ?? []).map((r) => r.toString().replace(/\s+/g, " ").trim());
  return { marks: all("distill-action"), show: all("distill-action-show") };
});
const shown = (page: Page, sel: string) => page.locator(sel).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none";
});

test("loose ends: hidden contacts count and Show me opens the original; empty boxes go; a several-line address is highlighted; dark follows a box that opens", async ({ distill }) => {
  const tab = await distill.openTab("caption-loose-ends");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator("#jmeno").fill("Jana Nováková");

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  const status = frame.getByTestId("cap-status");
  // The address and phone in the text, and the phone and e-mail of the side column Clean hid.
  await expect(status).toHaveText(/ · 4 things to do$/, { timeout: 10_000 });

  // 3. The empty grey bar and the frame left of the "read also" box went; every paragraph and the picture stay.
  await expect(page.locator("#side")).toBeHidden();
  for (const sel of ["#bar", "#tip"]) expect(await shown(page, sel), sel).toBe(false);
  for (const sel of ["#p1", "#p2", "#p3", "#photo", "#adresa", "#hlaseni"]) expect(await shown(page, sel), sel).toBe(true);
  await frame.getByTestId("cap-more-btn").click();
  const removed = await frame.getByTestId("cap-removed-item").allTextContents();
  expect(removed.filter((t) => t.startsWith("Empty space"))).toHaveLength(2);
  // The "read also" link brought back comes back in its frame (the Empty space that held it comes back with it).
  await frame.getByRole("button", { name: "Show Related links again" }).click();
  await expect.poll(() => shown(page, "#tip .related")).toBe(true);
  expect(await shown(page, "#bar")).toBe(false);
  await expect(frame.getByTestId("cap-removed-item").filter({ hasText: "Back on the page" })).toHaveCount(2);

  // 1. The things to do: the address and phone on screen first, then the phone and e-mail of the hidden column, marked.
  const rows = frame.getByTestId("cap-action");
  await expect(rows).toHaveCount(4);
  const texts = await frame.getByTestId("cap-action-text").allTextContents();
  expect(texts.slice(0, 2).sort()).toEqual(["Address: Rovná 235, 468 01 Jablonec nad Nisou - Kokonín", "Call 602 106 673"]);
  expect(texts.slice(2)).toEqual(["Call 377 912 345", "Write to podatelna@horni-lhota.example"]);
  expect(await rows.evaluateAll((els) => els.map((e) => e.hasAttribute("data-hidden")))).toEqual([false, false, true, true]);
  await expect(rows.nth(2).getByTestId("cap-action-hidden")).toHaveText("In a part Distill hid. Show me opens the original there.");
  await expect(rows.nth(0).getByTestId("cap-action-hidden")).toHaveCount(0);
  expect(JSON.stringify(texts)).not.toContain("Jana");

  // 5. The address over several lines is highlighted from its first line to its last, not only outlined.
  const h = await highlights(page);
  expect(h.marks).toContain("Rovná 235 Jablonec nad Nisou - Kokonín 468 01");
  await shot(page, "r4-01-loose-ends");

  // Show me on the hidden phone: the original shows, the phone is flashed there; Back to Distill hides the column again.
  await rows.nth(2).getByTestId("cap-action-show").click();
  await expect(frame.getByTestId("cap-back")).toBeVisible();
  await expect.poll(async () => (await highlights(page)).show).toEqual(["377 912 345"]);
  await expect(page.locator("#side")).toBeVisible();
  expect(await page.locator("#side-tel").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
  await shot(page, "r4-01-loose-ends-show-me");
  await frame.getByTestId("cap-back").click();
  await expect(page.locator("#side")).toBeHidden();

  // 2. Dark page, then a box that opens by its class later: darkened too, its text still reads.
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-dark").click();
  await expect(frame.getByTestId("cap-dark")).toBeChecked();
  await frame.getByTestId("cap-more-btn").click();
  await expect(page.locator("#more")).not.toHaveAttribute("data-distill-dark");
  // The page's own button opens the box by its class (run as the page would: a click under the strip's closing More can
  // land on the strip under load).
  await page.evaluate(() => (document.getElementById("more-btn") as HTMLButtonElement).click());
  await expect(page.locator("#more")).toHaveClass(/open/);
  await expect(page.locator("#more")).toHaveAttribute("data-distill-dark", /d\d+/);
  const colours = await page.locator("#more").evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el.querySelector("p") as Element).color }));
  const lum = (c: string) => {
    const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? []).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect(lum(colours.bg)).toBeLessThan(0.05);
  expect((lum(colours.fg) + 0.05) / (lum(colours.bg) + 0.05)).toBeGreaterThanOrEqual(4.5);

  // Close: everything goes, the typed value stays.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(page.locator("[data-distill-hide], [data-distill-dark], [data-distill-action]")).toHaveCount(0);
  for (const sel of ["#bar", "#tip", "#side"]) expect(await shown(page, sel), sel).toBe(true);
  await expect(page.locator("#jmeno")).toHaveValue("Jana Nováková");
});
