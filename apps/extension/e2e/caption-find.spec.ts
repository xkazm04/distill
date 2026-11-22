// Round 1, W3 (spark universal-core): what the caption finds on a page. #2 the language from the words of a page with
// no lang attribute, #5 the contact card, #9 the form check. Hermetic, on the demo pages.
import { join } from "node:path";
import type { Frame, Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `caption-find-${name}.png`), animations: "disabled" });

/** The strip gets focus back, as when the person clicks it after typing in the page. */
async function refocus(frame: Frame) {
  await frame.evaluate(() => window.dispatchEvent(new Event("focus")));
}

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

test("caption find: Ready to send? counts the form, jumps to the next empty required field and never touches the trap", async ({ distill }) => {
  const tab = await distill.openTab("caption-hlaseni-zavad");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);

  // Seven fields a person can see; the hidden token and the robot trap (website) are not counted.
  const next = frame.getByTestId("cap-form-next");
  await expect(next).toHaveText("Form 0 of 7 · Next");
  await expect(frame.getByTestId("cap-row").getByRole("button")).toHaveCount(3); // Form, More, Original

  // Typing in the page is counted when the strip gets focus back.
  await tab.page.fill("#jmeno", "Jana Nováková");
  await refocus(frame);
  await expect(next).toHaveText("Form 1 of 7 · Next");

  // Next: the first empty required field, focused and outlined in view; again: the one after it.
  await next.click();
  await expect.poll(() => tab.page.evaluate(() => document.activeElement?.id)).toBe("email");
  expect(await located(tab.page)).toEqual(["email"]);
  await shot(tab.page, "form-next");
  await tab.page.keyboard.type("jana@example.cz");
  await next.click();
  await expect.poll(() => tab.page.evaluate(() => document.activeElement?.id)).toBe("druh");
  await expect(next).toHaveText("Form 2 of 7 · Next");

  // The page's own errors, counted in More after Send (the person pressed it in the page).
  await tab.page.locator("button[type=submit]").click();
  await refocus(frame);
  await frame.getByTestId("cap-more-btn").click();
  const section = frame.getByTestId("cap-form");
  await expect(section).toContainText("2 of 7 fields filled. 4 required fields are empty.");
  await expect(section).toContainText("The page shows 4 errors.");
  await settled(tab.page);
  await shot(tab.page, "form-more");
  await frame.locator("body").press("Escape");

  // Counts only: the reply carries no value the person typed.
  const reply = await distill.worker.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: "distill:caption:form" }, { frameId: 0 }), tab.id);
  expect(JSON.stringify(reply)).not.toMatch(/Jana|example\.cz/);
  expect(Object.keys((reply as { data: object }).data).sort()).toEqual(["errors", "fields", "filled", "required", "requiredLeft"]);

  // Everything filled: a quiet "Form complete", no button.
  await tab.page.selectOption("#druh", "osvetleni");
  await tab.page.fill("#telefon", "777 000 111");
  await tab.page.fill("#misto", "Hlavní, sloup č. 14");
  await tab.page.fill("#popis", "Lampa nesvítí od pondělí.");
  // The strip sits over the bottom of the window; Playwright scrolls a control only just into view, where the strip
  // can be over it and take the click (it failed 1 run in 3). A person scrolls it clear: so does the test.
  await tab.page.locator("#souhlas").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await tab.page.check("#souhlas");
  await refocus(frame);
  await expect(frame.getByTestId("cap-form-done")).toHaveText("Form complete");
  await expect(next).toHaveCount(0);
  expect(await tab.page.inputValue("#website")).toBe(""); // the trap was never visited or filled
  await settled(tab.page);
});

test("caption find: the side panel's guide marks the same fields required as the strip counts, read the village way", async ({ distill }) => {
  // The demo village form marks "required" its own way, as Štáhlavy and Přáslavice do: a star, a required class, a
  // "- povinné" in the label; the attribute is on one field only. The engine reads them all, for the strip and the panel.
  const tab = await distill.openTab("caption-hlaseni-zavad");
  await tab.page.setViewportSize({ width: 1440, height: 900 });
  expect(await tab.page.locator("#hlaseni [required]").count()).toBe(1);
  const panel = await distill.openPanel(tab.id);
  await panel.locator(".workspace").waitFor();
  const strip = panel.getByTestId("view-strip");
  if (await strip.isVisible()) await strip.getByRole("button", { name: /^Fill a form/ }).click();
  else await panel.getByRole("tab", { name: /^Fill a form/ }).click();
  const step = panel.getByTestId("wf-step");
  await expect(panel.getByTestId("wf-answered")).toHaveText("0 of 7 answered");

  // The first step: required by its star alone, so Next waits for an answer.
  await expect(step.locator(".field label").first()).toContainText("Jméno a příjmení (required)");
  await expect(step.getByRole("button", { name: "Next" })).toBeDisabled();
  await expect(step).toContainText("Fill in the required answer to continue");
  await panel.screenshot({ path: join(OUT, "caption-find-panel-required.png") });

  // Every step, skipped through: the fields the panel marks required are the six the page marks its own way.
  const marked: string[] = [];
  for (let i = 0; i < 7; i++) {
    for (const t of await step.locator(".field label").allTextContents()) marked.push(`${t.replace(/\s*label on the form$/, "")}`);
    await step.getByRole("button", { name: "Skip" }).click();
  }
  expect(marked.filter((t) => t.endsWith("(required)")).map((t) => t.replace(/ \(required\)$/, ""))).toEqual([
    "Jméno a příjmení", "E-mail", "Druh závady - povinné", "Místo závady", "Popis závady", "Souhlasím se zpracováním osobních údajů",
  ]);
  expect(marked).toContain("Telefon (nepovinné)");

  // The strip counts the same six.
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  const reply = await distill.worker.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: "distill:caption:form" }, { frameId: 0 }), tab.id);
  expect((reply as { data: { required: number; fields: number } }).data).toMatchObject({ fields: 7, required: 6 });
});

test("caption find: the form check is short at phone width, and absent on a page without a form", async ({ distill }) => {
  const tab = await distill.openTab("caption-hlaseni-zavad");
  await tab.page.setViewportSize({ width: 390, height: 844 });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await expect(frame.getByTestId("cap-form-next")).toHaveText("0 of 7 · Next", { useInnerText: true });

  const article = await distill.openTab("article");
  await article.page.setViewportSize({ width: 1440, height: 900 });
  await startCaption(distill.worker, article.id);
  const f2 = await captionFrame(article.page);
  await firstSight(f2);
  await expect(f2.getByTestId("cap-row")).toBeVisible();
  await expect(f2.getByTestId("cap-form-next")).toHaveCount(0);
  await expect(f2.getByTestId("cap-form-done")).toHaveCount(0);
});
