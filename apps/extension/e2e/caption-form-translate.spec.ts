// A form in your language (r4-04) on a Czech fault-report form, in real Chromium. The e2e build has no model: the
// stand-in answers translateBlocks with "[EN] " + the words and translateErrors with "[EN-ERR] " + the message, and
// records what each run was handed (Translate.tsx E2E_SENT_KEY). What is checked: every label, legend, hint, option,
// optgroup, placeholder, aria-label and button is translated in place and comes back with Keep Czech, Original and
// close; the form submits exactly the same data before, during and after; a typed value and an error message never go
// to translateBlocks (the cloud-eligible task); an error is translated only by translateErrors, which runs on this
// device; without a model on this device the error stays as it is and the strip says why.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Worker } from "playwright/test";
import { captionFrame, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const NAME = "Zqxvlenka Wbrtnovsky";
const DESCRIPTION = "Lampa u čísla 4711 nesvítí od pondělí ZQX";
const BAD_MAIL = "zqx4711@nikde";

async function fakeModel(worker: Worker, opts: { fail?: string; source?: "on_device" | "in_cloud"; delayMs?: number } = {}) {
  await worker.evaluate(async (o) => { await chrome.storage.session.set({ "distill:e2e:fakeAi": o, "distill:e2e:sentTranslate": [] }); }, opts);
}
interface Sent { task: "translateBlocks" | "translateErrors"; prompt: string; blocks: { id: string; text: string }[] }
const sent = (worker: Worker) =>
  worker.evaluate(async () => ((await chrome.storage.session.get("distill:e2e:sentTranslate"))["distill:e2e:sentTranslate"] as Sent[] | undefined) ?? []);

/** The form's markup, without the empty style attribute Playwright's screenshot leaves on text fields. */
const formHtml = (page: Page) => page.locator("#report").evaluate((el) => el.outerHTML.replace(/ style=""/g, ""));
const exactly = (page: Page) => page.locator("body").evaluate((el) => {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("distill-caption, [data-distill-spacer]").forEach((n) => n.remove());
  return copy.querySelector("main")?.outerHTML.replace(/ style=""/g, "") ?? "";
});
/** The same, without the marks Distill's other features put on elements. */
const plainForm = async (page: Page) => (await formHtml(page)).replace(/\s(data-distill-[a-z-]+)(="[^"]*")?/g, "");

async function submit(page: Page): Promise<string[]> {
  const before = await page.evaluate(() => (window as unknown as { __submissions: string[][] }).__submissions.length);
  await page.locator("#send").click();
  await page.waitForFunction((n) => (window as unknown as { __submissions: string[][] }).__submissions.length > n, before);
  return page.evaluate(() => { const s = (window as unknown as { __submissions: string[][] }).__submissions; return s[s.length - 1] ?? []; });
}

async function fill(page: Page) {
  await page.fill("#jmeno", NAME);
  await page.fill("#email", "zqx@example.cz");
  await page.selectOption("#druh", { label: "Díra v silnici" }); // an option without a value attribute: it sends its text
  await page.check("input[name=nalehavost][value=hned]");
  await page.fill("#popis", DESCRIPTION);
  await page.check("input[name=souhlas]");
}

const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `caption-form-translate-${name}.png`) });
};

test("form translate: every word of the form in English and back; the same data is sent; no value or error goes to translateBlocks", async ({ distill }) => {
  const tab = await distill.openTab("caption-form-cs");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await fill(page);
  const before = await submit(page);
  expect(before).toEqual(["jmeno=" + NAME, "email=zqx@example.cz", "druh=Díra v silnici", "nalehavost=hned", "popis=" + DESCRIPTION, "souhlas=ano", "akce=Odeslat hlášení"]); // the named submit button sends its own value
  const form = await plainForm(page);
  const exact = await exactly(page);
  await fakeModel(distill.worker);

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  await expect(frame.getByTestId("cap-status")).toContainText("Translated from Czech", { timeout: 15_000 });
  const chip = frame.getByTestId("cap-chip");
  await expect(chip).toHaveText("On this device");
  await expect(chip).toHaveAttribute("data-form", /^\d+$/);

  // Every word of the form, in place.
  await expect(page.locator("legend").first()).toHaveText("[EN] Kdo závadu hlásí");
  await expect(page.locator("legend").nth(1)).toHaveText("[EN] Co se stalo");
  await expect(page.locator("label[for=jmeno]")).toHaveText(/^\[EN\] Jméno a příjmení \*$/);
  await expect(page.locator("label[for=jmeno] .req")).toHaveCount(1); // the star keeps its own element
  await expect(page.locator("label[for=email]")).toHaveText("[EN] E-mail");
  await expect(page.locator("#email-hint")).toHaveText("[EN] Na tento e-mail vám pošleme odpověď.");
  await expect(page.locator("label[for=druh]")).toHaveText("[EN] Druh závady");
  await expect(page.locator("#report p")).toHaveText("[EN] Jak je to naléhavé?");
  for (const opt of await page.locator("#druh option").all()) await expect(opt).toHaveText(/^\[EN\] /);
  await expect(page.locator("#druh optgroup")).toHaveAttribute("label", "[EN] Silnice a chodníky");
  await expect(page.locator("#druh")).toHaveAttribute("aria-label", "[EN] Vyberte druh závady");
  await expect(page.locator("#jmeno")).toHaveAttribute("placeholder", "[EN] Jan Novák");
  await expect(page.locator("#popis")).toHaveAttribute("placeholder", "[EN] Popište, kde přesně závada je");
  await expect(page.locator("label.inline").nth(0)).toHaveText(/\[EN\] Hned/);
  await expect(page.locator("label.inline").nth(2)).toHaveText(/\[EN\] Souhlasím se zpracováním osobních údajů/);
  await expect(page.locator("#send")).toHaveAttribute("value", "[EN] Odeslat hlášení");
  await expect(page.locator("#clear")).toHaveText("[EN] Vymazat formulář");
  // Not the header's search box: it is not the page's form.
  await expect(page.locator("#search input").first()).toHaveAttribute("placeholder", "Hledat na webu");
  // What the person typed and chose is as it was; the option values are the page's own.
  await expect(page.locator("#jmeno")).toHaveValue(NAME);
  await expect(page.locator("#popis")).toHaveValue(DESCRIPTION);
  await expect(page.locator("#druh option[value=osvetleni]")).toHaveCount(1);
  await shot(page, "translated");

  // The same data, to the byte.
  expect(await submit(page)).toEqual(before);

  // Nothing the person typed went to a model, and nothing went but the form's own words and the page's text.
  const runs = await sent(distill.worker);
  expect(runs.length).toBeGreaterThan(0);
  const all = JSON.stringify(runs);
  for (const never of [NAME, DESCRIPTION, "zqx@example.cz", "ZQX", "4711", "osvetleni"]) expect(all).not.toContain(never);
  expect(runs.every((r) => r.task === "translateBlocks")).toBe(true);
  const words = runs.flatMap((r) => r.blocks.map((b) => b.text));
  for (const want of ["Kdo závadu hlásí", "Díra v silnici", "Silnice a chodníky", "Jan Novák", "Odeslat hlášení", "Vymazat formulář"]) expect(words).toContain(want);

  // An error the form shows (it repeats what was typed): translated by translateErrors only, on this device.
  await page.fill("#email", BAD_MAIL);
  await page.locator("#send").click();
  await expect(page.locator("#email-err")).toHaveText(`[EN-ERR] Adresa „${BAD_MAIL}“ není platná e-mailová adresa.`, { timeout: 10_000 });
  await expect(frame.getByTestId("cap-status")).toContainText("1 error message translated on this device");
  await expect(chip).toHaveAttribute("data-errors", "translated:1");
  const after = await sent(distill.worker);
  const errorRuns = after.filter((r) => r.task === "translateErrors");
  expect(errorRuns).toHaveLength(1);
  expect(errorRuns[0]?.blocks.map((b) => b.text)).toEqual([`Adresa „${BAD_MAIL}“ není platná e-mailová adresa.`]);
  const pageRuns = JSON.stringify(after.filter((r) => r.task === "translateBlocks"));
  for (const never of [BAD_MAIL, "není platná", NAME, DESCRIPTION]) expect(pageRuns).not.toContain(never);
  await shot(page, "error");
  await page.fill("#email", "zqx@example.cz");
  expect(await submit(page)).toEqual(before);
  await expect(page.locator("#email-err")).toHaveText("");

  // Keep Czech: the form's own words, exactly; the same data; Show English brings the translation back.
  await frame.getByTestId("cap-keep-source").click();
  await expect(frame.getByTestId("cap-keep-source")).toHaveText("Show English");
  expect(await plainForm(page)).toBe(form);
  expect(await submit(page)).toEqual(before);
  await frame.getByTestId("cap-keep-source").click();
  await expect(page.locator("legend").first()).toHaveText("[EN] Kdo závadu hlásí");

  // Original: the untouched form; Back to Distill shows the translation again.
  await frame.getByTestId("cap-original").click();
  await expect(frame.getByTestId("cap-back")).toBeVisible();
  expect(await plainForm(page)).toBe(form);
  await frame.getByTestId("cap-back").click();
  await expect(page.locator("#druh optgroup")).toHaveAttribute("label", "[EN] Silnice a chodníky");
  expect(await submit(page)).toEqual(before);

  // Close: nothing left behind, to the byte; the values as typed.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  await expect(page.locator("distill-caption")).toHaveCount(0);
  expect(await exactly(page)).toBe(exact);
  expect(await page.locator("[data-distill-form-translated], [data-distill-form-value]").count()).toBe(0);
  await expect(page.locator("#jmeno")).toHaveValue(NAME);
  expect(await submit(page)).toEqual(before);
});

test("form translate: with no model on this device the error stays as it is and the strip says why; the form's words are still translated", async ({ distill }) => {
  const tab = await distill.openTab("caption-form-cs");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.fill("#jmeno", NAME); // required: the browser's own check comes first
  await page.fill("#email", BAD_MAIL);
  await page.locator("#send").click();
  const message = `Adresa „${BAD_MAIL}“ není platná e-mailová adresa.`;
  await expect(page.locator("#email-err")).toHaveText(message);
  // The stand-in model answers the page's words; the on-device run of the errors fails as a missing local model does.
  await fakeModel(distill.worker, { fail: "device:translateErrors" });

  expect(await startCaption(distill.worker, tab.id)).toBe(true);
  const frame = await captionFrame(page);
  const status = frame.getByTestId("cap-status");
  await expect(status).toContainText("Translated from Czech", { timeout: 15_000 });
  await expect(status).toContainText("Error messages left in Czech: the AI model on this device is not ready");
  await expect(frame.getByTestId("cap-chip")).toHaveAttribute("data-errors", "kept:1");
  await expect(page.locator("legend").first()).toHaveText("[EN] Kdo závadu hlásí");
  await expect(page.locator("#email-err")).toHaveText(message);
  // The error never reached translateBlocks.
  const pageRuns = JSON.stringify((await sent(distill.worker)).filter((r) => r.task === "translateBlocks"));
  expect(pageRuns).not.toContain(BAD_MAIL);
  expect(pageRuns).not.toContain("není platná");
  await shot(page, "error-kept");
});
