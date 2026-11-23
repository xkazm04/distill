// Spark round 3, r3-01: the main text that is only the text, on the demo page caption-maintext.html (built like a
// Deník article). Hermetic, like the rest of this folder; real sites: live/probes/maintext.live.ts.
// Screenshots go to E2E_EVIDENCE_DIR when it is set (the review's evidence folder), else e2e/out/evidence.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Worker } from "playwright/test";
import { captionFrame, firstSight, showPart, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};

/** The main text as the frame's page tasks get it (claims, the gist, plain words, Ask). */
const mainText = (worker: Worker, tabId: number) => worker.evaluate(async (id) => {
  const res = await chrome.tabs.sendMessage(id, { type: "distill:caption:mainText" }, { frameId: 0 }) as { ok: boolean; data?: { id: string; text: string }[] };
  return res?.ok ? (res.data ?? []).map((b) => b.text) : [];
}, tabId);

const hidden = (page: Page, id: string) => page.evaluate((i) => !!document.getElementById(i)?.closest("[data-distill-hide]"), id);

test("main text: starts with the lead, leaves out the headline, credit, caption, promo, boxes and ad labels; Clean takes the promo, the boxes and both ad slots; Show, Original and close bring them back", async ({ distill }) => {
  const tab = await distill.openTab("caption-maintext");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);

  // The main text: the lead first, every paragraph, and nothing of the frame around it.
  const text = await mainText(distill.worker, tab.id);
  expect(text[0]).toMatch(/^Řada lidí nechává peníze ležet na ulici/);
  const all = text.join("\n");
  for (const p of ["p1", "p2", "p3", "p4"]) {
    const words = await tab.page.locator(`#${p}`).textContent();
    expect(all, p).toContain((words ?? "").trim().slice(0, 60));
  }
  for (const never of ["Příspěvek na bydlení: kdo na něj má nárok", "Deník/Jakub Dostál", "Čtěte v článku", "upřednostnit v Google", "Čtěte také", "Související články", "Ministerstvo práce", "Reklama"]) {
    expect(all, never).not.toContain(never);
  }

  // Clean: the promo, the read-also box, the related list and both ad slots (the empty one too) are hidden; every
  // paragraph, the headline and the photo stay.
  for (const id of ["prefer", "also", "related", "slot-ad", "slot-empty"]) expect(await hidden(tab.page, id), id).toBe(true);
  for (const id of ["headline", "photo", "lead", "p1", "p2", "p3", "p4"]) expect(await hidden(tab.page, id), id).toBe(false);
  await tab.page.evaluate(() => scrollTo(0, 0));
  await shot(tab.page, "r3-01-demo-after");

  // More lists what went, the promo by its own name, and each can be shown again.
  await frame.getByTestId("cap-more-btn").click();
  await showPart(frame, "cap-removed-item"); // r5-02: its part of More
  const items = frame.getByTestId("cap-removed-item");
  await expect(items.filter({ hasText: "Site promotion" })).toHaveCount(1);
  expect(await items.filter({ hasText: "Advert" }).count()).toBeGreaterThanOrEqual(2);
  await items.filter({ hasText: "Site promotion" }).getByRole("button", { name: "Show Site promotion again" }).click();
  await expect.poll(() => hidden(tab.page, "prefer")).toBe(false);
  // Shown again it is the page's again, but still not the main text.
  expect((await mainText(distill.worker, tab.id)).join("\n")).not.toContain("upřednostnit v Google");
  await frame.getByTestId("cap-more-btn").click();

  // Original brings everything back; close removes every mark.
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  for (const id of ["also", "related", "slot-ad", "slot-empty"]) {
    await expect(tab.page.locator(`#${id}`)).toBeVisible();
  }
  await frame.getByTestId("cap-back").click();
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(tab.page.locator("[data-distill-hide]")).toHaveCount(0);
});
