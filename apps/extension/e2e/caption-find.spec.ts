// Round 1, W3 (spark universal-core): what the caption finds on a page. #2 the language from the words of a page with
// no lang attribute, #5 the contact card. Hermetic, on the demo pages.
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `caption-find-${name}.png`), animations: "disabled" });

const located = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-locate]")).map((e) => e.id || e.localName));

test("caption find: an old Czech site with no lang attribute is named Czech from its words, and its contacts are one tap away", async ({ distill }) => {
  const tab = await distill.openTab("caption-autoservis");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  expect(await tab.page.evaluate(() => document.documentElement.lang)).toBe("");

  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  // #2: the page says nothing about its language; its words do.
  expect(await firstSight(frame)).toMatch(/· Page in Czech$/);
  await expect(tab.page.locator("footer")).toBeHidden(); // Clean took the footer, where most of the contacts are

  // #5: More lists the contacts, phones and e-mails first; nothing on the price list or the company ids is a phone.
  await frame.getByTestId("cap-more-btn").click();
  const card = frame.getByTestId("cap-contact");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "Contact" })).toBeVisible();
  const rows = card.getByTestId("cap-contact-item");
  await expect(rows).toHaveCount(6);
  expect(await rows.evaluateAll((els) => els.map((e) => `${e.getAttribute("data-kind")}: ${e.querySelector(".contact-text")?.textContent}`))).toEqual([
    "phone: 377 912 345",
    "phone: 602 123 456",
    "email: servis@kovar.example",
    "address: Plzeňská 118, 332 03 Štáhlavy",
    "hours: Po - Pá: 7.00 - 16.30; So: 8.00 - 11.00",
    "contactPage: Kontakt",
  ]);
  const phone = rows.nth(0);
  await expect(phone.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:+420377912345");
  await expect(phone.getByRole("link", { name: "Call" })).toHaveAttribute("target", "_top");
  await expect(rows.nth(2).getByRole("link", { name: "Write" })).toHaveAttribute("href", "mailto:servis@kovar.example");

  // Found in the main text: Show on page outlines it, in view. Found only in the footer Clean hid: the strip says so
  // and leaves the page alone.
  await phone.getByRole("button", { name: "Show on page" }).click();
  await expect.poll(() => located(tab.page)).toEqual(["objednavky"]);
  await settled(tab.page);
  await shot(tab.page, "contact");
  const box = await tab.page.locator("#objednavky").boundingBox();
  expect(box && box.y >= 0 && box.y + box.height <= 900).toBe(true);
  await expect(rows.nth(1)).toContainText("In a part Distill hid. Original shows it.");
  await expect(rows.nth(1).getByRole("button", { name: "Show on page" })).toHaveCount(0);
  // The outline goes by itself and leaves nothing behind.
  await expect.poll(() => tab.page.evaluate(() => document.querySelectorAll("[data-distill-locate], #distill-locate-style").length), { timeout: 5_000 }).toBe(0);

  // Copy puts the text on the clipboard (or says it cannot); Open goes to the contact page in this tab.
  await rows.nth(0).getByRole("button", { name: "Copy phone" }).click();
  await expect(rows.nth(0).getByRole("button", { name: "Copy phone" })).toHaveText("Copied");
  await rows.nth(5).getByRole("button", { name: "Open" }).click();
  await tab.page.waitForURL(/caption-autoservis-kontakt\.html$/);
  await expect(tab.page.locator("h1")).toHaveText("Kontakt");
});

test("caption find: the contact card stays out of the way where there is nothing to call", async ({ distill }) => {
  const tab = await distill.openTab("article");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-more")).toBeVisible();
  // The demo article has no phone, e-mail, address or hours; whatever it finds must not be a number from its text.
  const found = await frame.getByTestId("cap-contact-item").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
  expect(found.filter((k) => k === "phone")).toEqual([]);
});
