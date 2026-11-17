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
  const manifest = JSON.parse(readFileSync(join(EXTENSION_ROOT, "dist", "manifest.json"), "utf8")) as { optional_permissions?: string[] };
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
