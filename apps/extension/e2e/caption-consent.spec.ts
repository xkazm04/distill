// Round 3, r3-04: a cookie banner answered for you, on the demo page caption-consent.html (?cmp=<system>). Distill
// presses each system's own reject button after Clean, never Accept; the site's own record (its cookie) says rejected
// and the banner does not come back after a reload. A banner without a reject button is only hidden. The switch in More
// turns it off for the site. Hermetic; real sites: live/probes/consent.live.ts.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, showPart, startCaption } from "./caption";
import { expect, OUT, test, type Distill } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};

/** What the page's banner recorded: every button pressed, in order, and its cookie. */
const record = (page: Page, cmp: string) => page.evaluate((c) => ({
  log: (window as unknown as { __consentLog: string[] }).__consentLog,
  cookie: document.cookie.split("; ").find((k) => k.startsWith(`consent_${c}=`))?.split("=")[1] ?? null,
  banner: !!document.querySelector(".banner, #usercentrics-root, [id^=sp_message_container], #onetrust-consent-sdk, #didomi-host, #qc-cmp2-container"),
}), cmp);

async function openWith(distill: Distill, cmp: string) {
  const tab = await distill.openTab("caption-consent");
  await tab.page.goto(`${tab.url}&cmp=${cmp}`);
  if (cmp !== "late") await tab.page.waitForFunction(() => !!document.querySelector(".banner, #usercentrics-root"));
  if (cmp === "sourcepoint") await tab.page.frameLocator("#sp_message_iframe_1001").locator(".sp_choice_type_13").waitFor();
  return tab;
}

const SYSTEMS = ["onetrust", "didomi", "cookiebot", "quantcast", "usercentrics", "sourcepoint", "trustarc", "plain"];

test("caption consent: each banner system's own reject button is pressed after Clean, never Accept; the site keeps the choice", async ({ distill }) => {
  for (const cmp of SYSTEMS) {
    const tab = await openWith(distill, cmp);
    expect((await record(tab.page, cmp)).log, cmp).toEqual([]);
    await startCaption(distill.worker, tab.id);
    const frame = await captionFrame(tab.page);
    const status = await firstSight(frame);
    expect(status, cmp).toContain("Cookies: rejected");
    const now = await record(tab.page, cmp);
    // Exactly one press, the reject one: never Accept, never Settings or More options.
    expect(now.log, cmp).toEqual(["rejected"]);
    expect(now.cookie, cmp).toBe("rejected");
    // More says what happened.
    await frame.getByTestId("cap-more-btn").click();
    await showPart(frame, "cap-consent-note"); // r5-02: its part of More
    await expect(frame.getByTestId("cap-consent-note"), cmp).toHaveAttribute("data-outcome", "rejected");
    if (cmp === "onetrust") await shot(tab.page, "r3-04-demo-onetrust");
    // The site's own record holds: after a reload the banner does not come back.
    await tab.page.reload();
    await tab.page.waitForTimeout(300);
    const after = await record(tab.page, cmp);
    expect(after.banner, cmp).toBe(false);
    expect(after.cookie, cmp).toBe("rejected");
    await tab.page.close();
  }
});

test("caption consent: a banner with no reject button is only hidden; nothing is pressed", async ({ distill }) => {
  const tab = await openWith(distill, "acceptonly");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  const status = await firstSight(frame);
  expect(status).not.toContain("Cookies");
  const now = await record(tab.page, "acceptonly");
  expect(now.log).toEqual([]);
  expect(now.cookie).toBeNull();
  // Clean hid it, as before round 3.
  expect(await tab.page.locator(".cookie-bar[data-distill-hide]").count()).toBe(1);
  await frame.getByTestId("cap-more-btn").click();
  await showPart(frame, "cap-consent-note"); // r5-02: its part of More
  await expect(frame.getByTestId("cap-consent-note")).toHaveAttribute("data-outcome", "hidden");
});

test("caption consent: a banner that comes late is answered too, once", async ({ distill }) => {
  const tab = await openWith(distill, "late");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await expect(frame.getByTestId("cap-status")).toContainText("Cookies: rejected", { timeout: 8_000 });
  await tab.page.waitForTimeout(500);
  expect((await record(tab.page, "late")).log).toEqual(["rejected"]);
});

test("caption consent: the switch in More turns it off for the site (kept on the device), and on again presses reject", async ({ distill }) => {
  // Turn it off on this site, from a page whose banner has no reject button.
  const first = await openWith(distill, "acceptonly");
  await startCaption(distill.worker, first.id);
  let frame = await captionFrame(first.page);
  await firstSight(frame);
  await frame.getByTestId("cap-more-btn").click();
  await showPart(frame, "cap-consent"); // r5-02: its part of More
  const sw = frame.getByTestId("cap-consent");
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(sw).not.toBeChecked();
  const kept = await distill.worker.evaluate(async () => (await chrome.storage.local.get("distill:consent"))["distill:consent"] as unknown);
  expect(kept).toEqual({ sites: { [new URL(first.url).origin]: false } });
  await first.page.close();

  // The next page of the site: the banner is hidden, its reject button is not pressed.
  const tab = await openWith(distill, "onetrust");
  await startCaption(distill.worker, tab.id);
  frame = await captionFrame(tab.page);
  const status = await firstSight(frame);
  expect(status).not.toContain("Cookies");
  expect((await record(tab.page, "onetrust")).log).toEqual([]);
  await frame.getByTestId("cap-more-btn").click();
  await showPart(frame, "cap-consent-note"); // r5-02: its part of More
  await expect(frame.getByTestId("cap-consent-note")).toHaveAttribute("data-outcome", "off");
  expect(await tab.page.locator("#onetrust-consent-sdk[data-distill-hide], #onetrust-consent-sdk [data-distill-hide]").count()).toBeGreaterThan(0);

  // On again: the banner still waiting is answered now, with its reject button.
  await showPart(frame, "cap-consent"); // r5-02: its part of More
  await frame.getByTestId("cap-consent").click();
  await expect(frame.getByTestId("cap-consent-note")).toHaveAttribute("data-outcome", "rejected");
  await expect(frame.getByTestId("cap-status")).toContainText("Cookies: rejected");
  expect((await record(tab.page, "onetrust")).log).toEqual(["rejected"]);
  // Back to the default for every site: no choice of its own kept.
  expect(await distill.worker.evaluate(async () => (await chrome.storage.local.get("distill:consent"))["distill:consent"] as unknown)).toEqual({ sites: {} });
});
