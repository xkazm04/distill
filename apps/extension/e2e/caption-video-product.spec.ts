// Spark round 4: video chapters and sponsor parts (r4-06) on caption-video.html (a cooking video page: the description
// lists six times, one of them "Reklama – sponzor dílu"; the video is nine minutes of silence the page makes itself, so
// nothing is fetched), and a product page's facts (r4-07) on two shop pages: caption-shop.html (Czech, JSON-LD Product
// with an Offer, the price shown on the page, Czech labels, Parametry) and caption-shop-en.html (English, no structured
// data: WooCommerce-like markup). No model: both cards are patterns only. Real sites: live/probes/video-product.live.ts.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, showPart, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};
const time = (page: Page) => page.locator("#player").evaluate((v: HTMLVideoElement) => v.currentTime);
const located = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-locate]")).map((e) => e.id || e.localName));

test("video: chapters from the description in More, a chapter moves the player, Skip jumps past the sponsor part", async ({ distill }) => {
  const tab = await distill.openTab("caption-video");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => page.locator("#player").evaluate((v: HTMLVideoElement) => v.duration)).toBe(540);
  const description = await page.locator("#description").innerHTML();

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await expect(frame.getByTestId("cap-chip")).toHaveText("No AI used");
  // No sponsor part plays at the start: no Skip.
  await expect(frame.getByTestId("cap-video-skip")).toHaveCount(0);

  await frame.getByTestId("cap-more-btn").click();
  await showPart(frame, "cap-chapter"); // r5-02: its part of More
  const chapters = frame.getByTestId("cap-chapter");
  await expect(chapters).toHaveCount(6);
  expect(await chapters.evaluateAll((els) => els.map((e) => [e.getAttribute("data-start"), e.querySelector(".video-title")?.textContent, e.hasAttribute("data-sponsor")]))).toEqual([
    ["0", "Úvod", false], ["40", "Suroviny", false], ["130", "Reklama – sponzor dílu: nože Ostrý", true],
    ["185", "Těsto", false], ["330", "Smažení", false], ["465", "Servírování", false],
  ]);
  // "Ve 3:40 přidáváme mouku" is a time inside a sentence, not a chapter.
  await expect(chapters.first()).toHaveAttribute("aria-current", "true");

  // A chapter moves the player there, and the mark follows.
  await chapters.nth(4).locator("button").click();
  await expect.poll(() => time(page)).toBe(330);
  await expect(chapters.nth(4)).toHaveAttribute("aria-current", "true");
  await expect(chapters.nth(0)).not.toHaveAttribute("aria-current", "true");

  // Into the sponsor part: the row offers Skip; Skip jumps to the next chapter and goes away.
  await chapters.nth(2).locator("button").click();
  await expect.poll(() => time(page)).toBe(130);
  const skip = frame.getByTestId("cap-video-skip");
  await expect(skip).toBeVisible();
  await expect(skip).toHaveText("Skip sponsor");
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, "r4-06-demo");
  await skip.click();
  await expect.poll(() => time(page)).toBe(185);
  await expect(skip).toHaveCount(0);
  await expect(chapters.nth(3)).toHaveAttribute("aria-current", "true");

  // Skip also shows with More shut, while the sponsor part plays.
  await chapters.nth(2).locator("button").click();
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toHaveCount(0);
  await expect(skip).toBeVisible();

  // The page's own words are untouched; Original and close leave the video where the person put it.
  expect(await page.locator("#description").innerHTML()).toBe(description);
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").click();
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(page.locator("distill-caption")).toHaveCount(0);
  expect(await page.locator("#description").innerHTML()).toBe(description);
});

test("video: a page whose description lists no times shows no chapters", async ({ distill }) => {
  const tab = await distill.openTab("caption-video");
  await tab.page.locator("#description").evaluate((el) => { el.textContent = "Křupavé bramboráky. Ve 3:40 přidáváme mouku."; });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await frame.getByTestId("cap-more-btn").click();
  await tab.page.waitForTimeout(1500);
  await expect(frame.getByTestId("cap-video")).toHaveCount(0);
  await expect(frame.getByTestId("cap-video-skip")).toHaveCount(0);
});

const facts = (frame: import("playwright/test").Frame) => frame.getByTestId("cap-product-fact").evaluateAll((els) =>
  els.map((e) => [e.getAttribute("data-kind"), e.querySelector("[data-testid=cap-product-value]")?.textContent, e.getAttribute("data-from")]));

test("product (Czech shop): one card first in More, the page's words over the data's codes, Show me on each", async ({ distill }) => {
  const tab = await distill.openTab("caption-shop");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await frame.getByTestId("cap-more-btn").click();
  await showPart(frame, "cap-product"); // r5-02: its part of More
  const card = frame.getByTestId("cap-product");
  await expect(card).toBeVisible();
  // First in More after Ask: nothing between them.
  expect(await frame.getByTestId("cap-more").evaluate((m) => Array.from(m.children).map((c) => c.getAttribute("data-testid")).slice(0, 3))).toContain("cap-product");
  await expect(frame.getByTestId("cap-product-name")).toHaveText("Rychlovarná konvice Teplík 1,7 l");
  expect(await facts(frame)).toEqual([
    ["price", "1 299 Kč", "page"],
    ["oldPrice", "1 599 Kč", "page"],
    ["stock", "Skladem 5 ks", "page"],
    ["delivery", "zítra u vás", "page"],
    ["delivery", "od 79 Kč", "page"],
    ["warranty", "24 měsíců", "page"],
    ["returns", "14 dní na vrácení zboží bez udání důvodu", "page"],
    ["spec", "1,7 l", "page"],
    ["spec", "2200 W", "page"],
    ["spec", "nerez", "page"],
    ["spec", "stříbrná", "page"],
  ]);
  // The related products' prices (599, 149, 89 Kč) are not this product's: the list above is all of it.
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, "r4-07-demo");

  // Show me: the place on the page is outlined, then the outline goes.
  const rows = frame.getByTestId("cap-product-fact");
  await frame.locator("[data-testid=cap-product-fact][data-kind=warranty] [data-testid=cap-product-show]").click();
  await expect.poll(() => located(page)).toEqual(["warranty"]);
  await expect.poll(() => located(page), { timeout: 5_000 }).toEqual([]);
  await frame.locator("[data-testid=cap-product-fact][data-kind=price] [data-testid=cap-product-show]").click();
  await expect.poll(() => located(page)).toEqual(["price"]);
  await showPart(frame, "cap-product-specs"); // r5-02: its part of More
  await frame.getByTestId("cap-product-specs").click();
  await frame.locator("[data-testid=cap-product-fact][data-kind=spec] [data-testid=cap-product-show]").first().click();
  await expect.poll(() => page.evaluate(() => document.querySelector("[data-distill-locate]")?.textContent)).toBe("1,7 l");
  await expect(rows).toHaveCount(11);

  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-distill-locate], #distill-locate-style, distill-caption").length), { timeout: 5_000 }).toBe(0);
});

test("product (English shop, no structured data): price and old price, stock, perks, specifications", async ({ distill }) => {
  const tab = await distill.openTab("caption-shop-en");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await frame.getByTestId("cap-more-btn").click();
  await showPart(frame, "cap-product"); // r5-02: its part of More
  await expect(frame.getByTestId("cap-product")).toBeVisible();
  expect(await facts(frame)).toEqual([
    ["price", "£29.99", "page"],
    ["oldPrice", "£39.99", "page"],
    ["stock", "In stock", "page"],
    ["delivery", "Free delivery on orders over £25", "page"],
    ["delivery", "Ships within 24 hours", "page"],
    ["warranty", "2-year warranty", "page"],
    ["returns", "30 days to return", "page"],
    ["spec", "400 lumens", "page"],
    ["spec", "5200 mAh, USB-C", "page"],
    ["spec", "310 g", "page"],
    ["spec", "IPX4", "page"],
  ]);
});

test("product: an article is not a product page, More shows no card", async ({ distill }) => {
  const tab = await distill.openTab("caption-actions");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-more").waitFor();
  await tab.page.waitForTimeout(800);
  await expect(frame.getByTestId("cap-product")).toHaveCount(0);
});
