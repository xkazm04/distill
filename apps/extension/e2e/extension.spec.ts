// The extension end to end: the built side panel drives a real tab through the content script. AI is off here (the
// worktree build has no Firebase config), so these prove the no-AI paths; the owner checks Gemini Nano by hand.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { EXTENSION_ROOT, expect, test } from "./harness";

const ARTICLE_TITLE = "City council approves new bus routes after months of debate";
const FORM_TITLE = "Žádost o dětský příspěvek";
/** A view in the sidebar. At the panel's width the sidebar is a drawer, so this finds it hidden too. */
const view = (panel: Page, name: RegExp) => panel.getByRole("tab", { name, includeHidden: true });
/** Choose a view as a person would at the panel's width: one click in the strip of views. */
async function pick(panel: Page, name: RegExp) {
  await panel.locator(".workspace").waitFor(); // the views exist once the panel has read the tab
  const strip = panel.getByTestId("view-strip");
  if (await strip.isVisible()) await strip.getByRole("button", { name }).click();
  else await panel.getByRole("tab", { name }).click();
}
const step = (panel: Page) => panel.getByTestId("wf-step");

test("article: the panel reads the page", async ({ distill }) => {
  const tab = await distill.openTab("article");
  const panel = await distill.openPanel(tab.id);

  await expect(panel.getByRole("heading", { level: 1 })).toHaveText(ARTICLE_TITLE);
  const count = panel.locator(".ws-blocks");
  await expect(count).toHaveText(/^\d+ blocks read$/);
  expect(Number((await count.textContent())?.split(" ")[0])).toBeGreaterThan(3);

  // Read is the first view: the page's own text, without the cookie banner, the menu or the advert.
  await expect(view(panel, /^Read/)).toHaveAttribute("aria-selected", "true");
  const reading = panel.locator("article.reading");
  await expect(reading).toContainText("The city council voted 9 to 4 on Tuesday evening");
  await expect(reading).toContainText("Route 14 runs every 10 minutes");
  await expect(reading).not.toContainText("Win a free holiday");
  await expect(reading).not.toContainText("We use cookies");

  // No AI here: the not-configured notice, and the text as written.
  await expect(panel.getByTestId("not-configured")).toBeVisible();
  await expect(panel.getByText("AI is off, so this is the page text as written.")).toBeVisible();
});

test("form: the no-AI guide fills the real tab", async ({ distill }) => {
  const tab = await distill.openTab("form");
  const panel = await distill.openPanel(tab.id);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText(FORM_TITLE);

  await pick(panel, /^Fill a form/);
  await expect(panel.getByTestId("origin-chip")).toHaveText("No AI used");
  await expect(panel.getByTestId("wf-answered")).toHaveText(/^0 of \d+ answered$/);
  // The basic guide uses the form's own (Czech) labels.
  await expect(step(panel).locator("label").first()).toContainText("Jméno");

  await step(panel).locator("input").first().fill("Jana");
  await step(panel).getByRole("button", { name: "Next" }).click();

  // The answer is in the REAL tab's field, outlined as filled.
  const jmeno = tab.page.locator("#jmeno");
  await expect(jmeno).toHaveValue("Jana");
  await expect(jmeno).toHaveAttribute("data-distill-mark", /.*/);
  const outline = await jmeno.evaluate((el) => { const c = getComputedStyle(el); return `${c.outlineStyle} ${c.outlineWidth}`; });
  expect(outline).toBe("solid 3px");
  await expect(panel.getByTestId("wf-answered")).toHaveText(/^1 of \d+ answered$/);

  // Step 2 is the surname. Type it, go Back, then Next: both answers are kept.
  await expect(step(panel).locator("label").first()).toContainText("Příjmení");
  await step(panel).locator("input").first().fill("Nováková");
  await step(panel).getByRole("button", { name: "Back" }).click();
  await expect(step(panel).locator("input").first()).toHaveValue("Jana");
  await step(panel).getByRole("button", { name: "Next" }).click();
  await expect(step(panel).locator("label").first()).toContainText("Příjmení");
  await expect(step(panel).locator("input").first()).toHaveValue("Nováková");
  await expect(tab.page.locator("#prijmeni")).toHaveValue("");
});

test("framed form: the guide reads and fills a form in a same-origin frame", async ({ distill }) => {
  const tab = await distill.openTab("framed-form");
  const panel = await distill.openPanel(tab.id);
  await pick(panel, /^Fill a form/);
  await expect(panel.getByTestId("origin-chip")).toHaveText("No AI used");
  await expect(step(panel).locator("label").first()).toContainText("Jméno");

  await step(panel).locator("input").first().fill("Jana");
  await step(panel).getByRole("button", { name: "Next" }).click();

  // The answer is in the field inside the frame, outlined as filled; the content script runs in the top frame only.
  const jmeno = tab.page.frameLocator("#frame").locator("#jmeno");
  await expect(jmeno).toHaveValue("Jana");
  await expect(jmeno).toHaveAttribute("data-distill-mark", /.*/);
  await expect(panel.getByTestId("wf-answered")).toHaveText(/^1 of \d+ answered$/);
});

test("pricing: New layout falls back to the focus view without AI", async ({ distill }) => {
  const tab = await distill.openTab("pricing");
  const panel = await distill.openPanel(tab.id);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText("Plans and pricing - Cloudly storage");

  await pick(panel, /^New layout/);
  await expect(panel.getByTestId("recast-off")).toHaveText("A new layout needs AI, which is off here. Here is the focus view.");
  const reading = panel.locator("article.reading");
  await expect(reading).toBeVisible();
  expect(await reading.locator("[data-block]").count()).toBeGreaterThan(0);
});

// Unpinned: the panel follows the active tab through chrome.tabs.onActivated, as the real side panel does. The panel
// page is itself a tab in the same window, so the test activates the demo tabs from the service worker.
test("tab switch: the panel follows the active tab", async ({ distill }) => {
  const article = await distill.openTab("article");
  const panel = await distill.openPanel();
  await distill.activate(article.id);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText(ARTICLE_TITLE);
  await expect(panel.locator("article.reading")).toContainText("The city council voted 9 to 4");

  const form = await distill.openTab("form", "tab2");
  distill.tab = form.page;
  await distill.activate(form.id);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText(FORM_TITLE);
  await expect(view(panel, /^Fill a form/)).toContainText("A form is on this page");

  await distill.activate(article.id);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText(ARTICLE_TITLE);
  await distill.activate(form.id);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText(FORM_TITLE);
});

// Pages no extension may read are named as browser pages: no button, no error.
test("injection refused: an about:blank page is named as a browser page", async ({ distill }) => {
  const tab = await distill.openTab("blank");
  await tab.page.goto("about:blank");
  const panel = await distill.openPanel(tab.id);
  await expect(panel.getByTestId("browser-page")).toHaveText("Browser pages cannot be read.Open a normal web page.");
  await expect(panel.getByTestId("page-error")).toHaveCount(0);
  await expect(panel.getByTestId("browser-page").getByRole("button")).toHaveCount(0);
});

// Handrail in real Chrome: the panel's port reaches the service worker, which tries the native host. With no helper
// program installed, the Agent view says so in plain words. Where nativeMessaging is optional and not yet given, the
// view offers to connect instead, with no error.
test("agent: without the helper program the Agent view says it is not running", async ({ distill }) => {
  const manifest = JSON.parse(readFileSync(join(EXTENSION_ROOT, "dist-e2e", "manifest.json"), "utf8")) as { optional_permissions?: string[] };
  const optional = manifest.optional_permissions?.includes("nativeMessaging") ?? false;
  const tab = await distill.openTab("form");
  const panel = await distill.openPanel(tab.id);
  await expect(view(panel, /^Agent/)).toContainText("Not connected");
  await pick(panel, /^Agent/);
  if (optional) {
    await expect(panel.getByTestId("handrail-connect")).toBeVisible();
    await expect(panel.getByTestId("handrail-offline")).toHaveCount(0);
  } else {
    await expect(panel.getByTestId("handrail-offline")).toContainText("The helper program is not running", { timeout: 5_000 });
  }
});

// ---- Follow tabs and pages, keep the guide, point at the source, ask for access (WP14).

test.describe("without host access", () => {
  test.use({ grantHosts: false });
  test("access needed: the shipped manifest asks for access instead of failing", async ({ distill }) => {
    const tab = await distill.openTab("article");
    const panel = await distill.openPanel(tab.id);
    await expect(panel.getByTestId("access-needed")).toBeVisible();
    await expect(panel.getByTestId("access-needed")).toContainText("Distill needs your OK to read this page.");
    await expect(panel.getByRole("button", { name: "Allow on all sites" })).toBeVisible();
    await expect(panel.getByTestId("page-error")).toHaveCount(0);
  });
});

test("browser page: a chrome:// page is named as a browser page", async ({ distill }) => {
  const tab = await distill.openTab("blank");
  await tab.page.goto("chrome://version");
  const panel = await distill.openPanel(tab.id);
  await expect(panel.getByTestId("browser-page")).toBeVisible();
  await expect(panel.getByTestId("page-error")).toHaveCount(0);
});

test("page change: a single-page app's new content is read again", async ({ distill }) => {
  const tab = await distill.openTab("article");
  const panel = await distill.openPanel(tab.id);
  await expect(panel.locator("article.reading")).toContainText("The city council voted 9 to 4");
  await tab.page.evaluate(() => {
    history.pushState({}, "", "/article.html?next");
    const main = document.querySelector("main") as HTMLElement;
    main.innerHTML = "<article><h1>Library opens on Sundays</h1><p>From January the central library opens every Sunday from 10:00 to 16:00, the council said.</p></article>";
  });
  await expect(panel.locator("article.reading")).toContainText("the central library opens every Sunday");
});

test("form changed: the guide says the form changed under it", async ({ distill }) => {
  const tab = await distill.openTab("form");
  const panel = await distill.openPanel(tab.id);
  await pick(panel, /^Fill a form/);
  await expect(step(panel)).toBeVisible();
  await tab.page.evaluate(() => {
    const extra = document.createElement("div");
    extra.innerHTML = '<label for="pojistovna">Zdravotní pojišťovna *</label><input id="pojistovna" name="pojistovna" required>';
    document.querySelector("fieldset")?.appendChild(extra);
  });
  await expect(panel.getByTestId("form-changed")).toBeVisible();
});

test("guide kept: a reload of the tab keeps the step and puts the answers back", async ({ distill }) => {
  const tab = await distill.openTab("form");
  const panel = await distill.openPanel(tab.id);
  await pick(panel, /^Fill a form/);
  await step(panel).locator("input").first().fill("Jana");
  await step(panel).getByRole("button", { name: "Next" }).click();
  await expect(tab.page.locator("#jmeno")).toHaveValue("Jana");

  await tab.page.reload();
  await expect(panel.getByTestId("wf-restored")).toBeVisible();
  await expect(step(panel).locator("label").first()).toContainText("Příjmení");
  await expect(panel.getByTestId("wf-answered")).toHaveText(/^1 of \d+ answered$/);
  await expect(tab.page.locator("#jmeno")).toHaveValue("Jana"); // written into the reloaded form again
});

test("carried over: the next form on the same site gets the same-label answer, marked", async ({ distill }) => {
  const tab = await distill.openTab("form");
  const panel = await distill.openPanel(tab.id);
  await pick(panel, /^Fill a form/);
  await step(panel).locator("input").first().fill("Jana");
  await step(panel).getByRole("button", { name: "Next" }).click();
  await expect(tab.page.locator("#jmeno")).toHaveValue("Jana");

  // "Page 2" on the same site: a new form whose first field has the same label.
  await tab.page.goto(`${distill.origin}/blank.html?page2`);
  await expect(panel.getByTestId("no-form")).toBeVisible();
  await tab.page.evaluate(() => {
    const form = document.createElement("form");
    form.innerHTML = "<label for=\"jmeno2\">Jméno *</label><input id=\"jmeno2\" name=\"jmeno2\"><label for=\"obec2\">Obec</label><input id=\"obec2\" name=\"obec2\">";
    document.body.append(form);
  });
  await expect(panel.getByTestId("carried-over")).toContainText("Carried over from the previous page");
  await expect(step(panel).locator("input").first()).toHaveValue("Jana");
  await expect(tab.page.locator("#jmeno2")).toHaveValue(""); // nothing is written until the person presses Next
});

test("locate: pointing at a block outlines its source in the tab", async ({ distill }) => {
  const tab = await distill.openTab("article");
  const panel = await distill.openPanel(tab.id);
  await panel.locator("article.reading [data-block]", { hasText: "The city council voted 9 to 4" }).hover();
  await expect(tab.page.locator("[data-distill-locate]")).toHaveCount(1);
  await expect(tab.page.locator("[data-distill-locate]")).toContainText("The city council voted 9 to 4");
});

test("page errors: an answer the page rejects shows its error on its step, and never in the page view", async ({ distill }) => {
  const tab = await distill.openTab("form");
  // The page checks its own answers on submit, as a portal's script does: it marks the field and shows a short message.
  await tab.page.evaluate(() => {
    const form = document.querySelector("form") as HTMLFormElement;
    form.noValidate = true;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const jmeno = document.getElementById("jmeno") as HTMLInputElement;
      document.getElementById("jmeno-err")?.remove();
      if (!/\d/.test(jmeno.value)) return;
      jmeno.setAttribute("aria-invalid", "true");
      jmeno.setAttribute("aria-describedby", "jmeno-err");
      jmeno.insertAdjacentHTML("afterend", `<span id="jmeno-err" class="error">Jméno „${jmeno.value}“ nesmí obsahovat číslice</span>`);
    });
  });
  const panel = await distill.openPanel(tab.id);
  await pick(panel, /^Fill a form/);
  await step(panel).locator("input").first().fill("Jana2");
  await step(panel).getByRole("button", { name: "Next" }).click();
  await expect(tab.page.locator("#jmeno")).toHaveValue("Jana2");
  await expect(step(panel).locator("label").first()).toContainText("Příjmení");

  // The person sends the form in the tab; the page rejects the name.
  await tab.page.getByRole("button", { name: "Odeslat žádost" }).click();
  await expect(tab.page.locator("#jmeno-err")).toBeVisible();

  // The guide noticed: the name's step shows the form's own words, and, with no model on this device, says why there
  // is no explanation instead of sending it anywhere.
  await step(panel).getByRole("button", { name: "Back" }).click();
  const err = panel.getByTestId("field-error");
  await expect(err).toHaveAttribute("data-field", "jmeno");
  await expect(err.getByTestId("error-original")).toHaveText("Jméno „Jana2“ nesmí obsahovat číslice");
  await expect(err.getByTestId("error-original")).toHaveAttribute("lang", "cs");
  await expect(err.getByTestId("error-note")).toContainText("model on this device");
  await expect(panel.getByTestId("source-chip")).toHaveCount(0);

  // The message repeats what was typed, so the page view (cloud-eligible) never carries it.
  await pick(panel, /^Read/);
  await expect(panel.locator("article.reading")).toContainText("Jméno");
  await expect(panel.locator("article.reading")).not.toContainText("nesmí obsahovat číslice");

  // Fixed on the page: the next reading clears it.
  await pick(panel, /^Fill a form/);
  await tab.page.locator("#jmeno").fill("Jana");
  await tab.page.getByRole("button", { name: "Odeslat žádost" }).click();
  await expect(tab.page.locator("#jmeno-err")).toHaveCount(0);
  await expect(panel.getByTestId("field-error")).toHaveCount(0);
});

// ---- The guide library (guides/README.md): bundled into the extension, matched in the panel, no network.

test("library guide: the guided demo form at its demo address gets the example guide, with no AI and no network", async ({ distill }) => {
  const requests: string[] = [];
  distill.context.on("request", (r) => requests.push(r.url()));
  const tab = await distill.openTab("demo/guided-form");
  const panel = await distill.openPanel(tab.id);
  await pick(panel, /^Fill a form/);

  // The library's own label, never an AI chip: the demo guide is an example, and says so.
  await expect(panel.getByTestId("guide-chip")).toHaveText("Example guide");
  await expect(panel.getByTestId("guide-source")).toContainText("An example guide for Distill's made-up demo form. No office issues this form, so no official instructions were checked.");
  await expect(panel.getByTestId("guide-source")).not.toContainText("Checked against");
  await expect(panel.getByTestId("guide-notes")).toContainText("made-up example form");
  await expect(panel.getByTestId("source-chip")).toHaveCount(0);
  await expect(panel.getByTestId("origin-chip")).toHaveCount(0);
  // The real page reads exactly as the guide was written for it (in Chromium as in the authoring tool): no drift notice.
  await expect(panel.getByTestId("guide-changed")).toHaveCount(0);
  await expect(panel.getByTestId("wf-answered")).toHaveText("0 of 6 answered");

  // Step 1 is the guide's: name and address together, still under the form's own Czech labels, and it rests on the
  // form's own words, quoted in Czech.
  await expect(step(panel).locator("h3")).toHaveText("What are your full name and permanent address?");
  await expect(step(panel).locator("label").nth(0)).toContainText("Jméno a příjmení");
  await expect(step(panel).locator("label").nth(1)).toContainText("Adresa trvalého pobytu");
  await expect(step(panel).getByTestId("guide-quote").locator("blockquote")).toHaveText("ulice, číslo domu, obec");
  await expect(step(panel).getByTestId("guide-quote").locator("blockquote")).toHaveAttribute("lang", "cs");
  await step(panel).locator("input").nth(0).fill("Olena Kovalenko");
  await step(panel).locator("input").nth(1).fill("Vinohradská 12, Praha");
  await step(panel).getByRole("button", { name: "Next" }).click();
  await expect(tab.page.locator("#jmeno")).toHaveValue("Olena Kovalenko");
  await expect(tab.page.locator("#adresa")).toHaveValue("Vinohradská 12, Praha");
  await expect(step(panel).locator("h3")).toHaveText("What e-mail address can the office use?");

  // No network: the only http(s) requests in the whole browser were the tab's own page (and its favicon). Nothing
  // went out to look the guide up, and nothing about the form was sent anywhere.
  const web = requests.filter((u) => /^https?:/.test(u));
  expect(web.filter((u) => u !== tab.url && u !== `${distill.origin}/favicon.ico`)).toEqual([]);
  expect(requests.some((u) => u.includes("library.json"))).toBe(false);
});

test("library guide: the original demo form at its demo address gets no guide - it stays the model's", async ({ distill }) => {
  // The web app's first demo is where on-device and cloud inference are shown, so the library has no guide for it. With
  // no model in this browser, the model path says plainly that no AI was used.
  const tab = await distill.openTab("demo/form");
  const panel = await distill.openPanel(tab.id);
  await pick(panel, /^Fill a form/);
  await expect(panel.getByTestId("origin-chip")).toHaveText("No AI used");
  await expect(panel.getByTestId("guide-chip")).toHaveCount(0);
  await expect(panel.getByTestId("guide-source")).toHaveCount(0);
});

test("library guide: the guided form at another address is not matched", async ({ distill }) => {
  const tab = await distill.openTab("guided-form");
  const panel = await distill.openPanel(tab.id);
  await pick(panel, /^Fill a form/);
  await expect(panel.getByTestId("origin-chip")).toHaveText("No AI used");
  await expect(panel.getByTestId("guide-chip")).toHaveCount(0);
});
