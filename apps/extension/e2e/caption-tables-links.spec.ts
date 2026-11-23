// Spark round 2: r2-05 Tables you can read and r2-07 Where does this link go, on the demo pages caption-tables.html and
// caption-links.html. Hermetic, like the rest of this folder; real sites: live/probes/tables-links.live.ts.
// Screenshots go to E2E_EVIDENCE_DIR when it is set (the review's evidence folder), else e2e/out/evidence.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { captionFrame, firstSight, settled, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};

/** What the tables look like now. Runs in the page. */
function tables(page: Page) {
  return page.evaluate(() => {
    const one = (id: string) => {
      const t = document.getElementById(id) as HTMLTableElement;
      const firstRow = t.tBodies[0]?.rows[0] as HTMLTableRowElement;
      const cell = firstRow.cells[0] as HTMLElement;
      return {
        marked: t.hasAttribute("data-distill-table"),
        wide: t.hasAttribute("data-distill-table-wide"),
        tall: t.hasAttribute("data-distill-table-tall"),
        cards: t.hasAttribute("data-distill-table-cards"),
        display: getComputedStyle(t).display,
        rowDisplay: getComputedStyle(firstRow).display,
        label: getComputedStyle(cell, "::before").content,
        scrolls: t.scrollWidth > t.clientWidth + 1,
        width: Math.round(t.getBoundingClientRect().width),
      };
    };
    return {
      hours: one("hours"), fees: one("fees"), waste: one("waste"),
      layout: { attrs: Array.from((document.getElementById("layout") as Element).querySelectorAll("*")).concat(document.getElementById("layout") as Element)
        .flatMap((e) => Array.from(e.attributes).map((a) => a.name)).filter((n) => n.startsWith("data-distill")),
      html: (document.getElementById("layout") as Element).outerHTML },
      sideways: document.documentElement.scrollWidth > innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

/** Where the tall table's header is while the middle of the table is at the top of the window, and whether it is the
 *  topmost thing there (nothing of the page covers it). Runs in the page. */
function headerWhileScrolled(page: Page) {
  return page.evaluate(async () => {
    const t = document.getElementById("waste") as HTMLTableElement;
    const top = t.getBoundingClientRect().top + scrollY;
    scrollTo({ top: top + 400, behavior: "instant" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const th = t.tHead?.rows[0]?.cells[1] as HTMLElement;
    const r = th.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const bar = (document.querySelector("header.top") as Element).getBoundingClientRect();
    return { top: Math.round(r.top), barBottom: Math.round(bar.bottom), onTop: !!hit && (hit === th || th.contains(hit)) };
  });
}

test("caption tables: the header stays in view, a wide table scrolls inside itself, cards on a phone; Original and close restore", async ({ distill }) => {
  const tab = await distill.openTab("caption-tables");
  const page = tab.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = await tables(page);
  expect(before.fees.scrolls).toBe(false);
  const untouched = await page.evaluate(() => (document.querySelector("main") as Element).innerHTML);

  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(page);
  await firstSight(frame);

  // The three data tables, never the layout table (the mayor's word: a picture beside text).
  let now = await tables(page);
  expect([now.hours.marked, now.fees.marked, now.waste.marked]).toEqual([true, true, true]);
  expect(now.layout.attrs).toEqual([]);
  expect(now.layout.html).toBe(before.layout.html);
  // At 1440: the fee list is wider than its column and scrolls inside itself; the page does not scroll sideways.
  expect(now.fees.wide).toBe(true);
  expect(now.fees.display).toBe("block");
  expect(now.fees.scrolls).toBe(true);
  expect(now.sideways).toBe(false);
  // The timetable is tall: its header stays in view below the page's own sticky bar, on top of everything there.
  expect(now.waste.tall).toBe(true);
  expect(now.waste.wide).toBe(false);
  const head = await headerWhileScrolled(page);
  expect(head.onTop).toBe(true);
  expect(Math.abs(head.top - head.barBottom)).toBeLessThanOrEqual(2);
  // The person brings the site's slim sticky bar back: the table's header now sticks just below it, never under it.
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByRole("button", { name: "Show Site header again" }).click();
  await frame.getByTestId("cap-more-btn").click();
  await settled(page);
  const below = await headerWhileScrolled(page);
  expect(below.barBottom).toBeGreaterThan(40);
  expect(below.onTop).toBe(true);
  expect(Math.abs(below.top - below.barBottom)).toBeLessThanOrEqual(2);
  await shot(page, "r2-05-demo-1440");

  // At 390: up to 4 columns become cards ("Den: Pondělí"), the rest scroll inside themselves, no sideways page scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await tables(page)).hours.rowDisplay).toBe("block");
  now = await tables(page);
  expect(now.hours.label).toBe('"Den: "');
  expect(now.sideways).toBe(false);
  expect(now.fees.display).toBe("block");
  expect(now.waste.cards).toBe(false); // five columns: no cards
  await page.evaluate(() => (document.getElementById("hours") as Element).scrollIntoView({ block: "start" }));
  await page.evaluate(() => scrollBy(0, -60));
  await shot(page, "r2-05-demo-390");

  // The switch in More: "Readable tables (3)", off shows the tables as the page made them, on brings them back.
  await frame.getByTestId("cap-more-btn").click();
  const box = frame.getByTestId("cap-tables");
  await expect(frame.getByTestId("cap-tables-section")).toContainText("Readable tables (3)");
  await expect(box).toBeChecked();
  await box.click();
  await expect(box).not.toBeChecked();
  await expect.poll(async () => (await tables(page)).hours.rowDisplay).toBe("table-row");
  await box.click();
  await expect(box).toBeChecked();
  await expect.poll(async () => (await tables(page)).hours.rowDisplay).toBe("block");
  await frame.getByTestId("cap-more-btn").click();

  // Original: the tables exactly as the site made them.
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  now = await tables(page);
  expect(now.hours.rowDisplay).toBe("table-row");
  expect(now.hours.label).toBe("none");
  expect(now.fees.display).toBe("table");
  await frame.getByTestId("cap-back").click();
  await expect.poll(async () => (await tables(page)).hours.rowDisplay).toBe("block");

  // Close: nothing of it is left; the main text is byte for byte what it was.
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await page.evaluate(() => document.querySelectorAll("[data-distill-table], [data-distill-table-head], [data-distill-label], style[data-distill]").length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-distill-tables-off"))).toBe(false);
  expect(await page.evaluate(() => (document.querySelector("main") as Element).innerHTML)).toBe(untouched);
});

/** The note's text while it is up, or null when there is none on screen. Runs in the page (the e2e build opens the
 *  note's shadow root; the build people install keeps it closed). */
const note = (page: Page) => page.evaluate(() => {
  const host = document.querySelector("distill-link-note") as HTMLElement | null;
  if (!host || getComputedStyle(host).visibility !== "visible") return null;
  return host.shadowRoot?.querySelector(".note")?.textContent ?? "";
});

test("caption links: a note says where each link goes, Copy clean link, none on mailto or anchors, no request made", async ({ distill }) => {
  const tab = await distill.openTab("caption-links");
  const page = tab.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await distill.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: distill.origin });
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(page);
  await firstSight(frame);

  // From here on the page asks for nothing: the notes are read from the addresses alone.
  const requests: string[] = [];
  page.on("request", (r) => { if (/^https?:/.test(r.url())) requests.push(r.url()); });

  const away = () => page.mouse.move(5, 300);
  const pointAt = async (id: string) => { await away(); await page.hover(`#${id}`); };

  await pointAt("pdf");
  await expect.poll(() => note(page)).toBe("127.0.0.1On this sitePDF file");

  await pointAt("utm");
  await expect.poll(() => note(page)).toBe("mojedane.czLeaves this siteTracking tags: utm_source, utm_medium, utm_campaignCopy clean link");
  await shot(page, "r2-07-note");
  // Copy clean link: the address without its tracking tags, on the clipboard. The pointer goes from the link to the button.
  await page.locator("distill-link-note").getByRole("button", { name: "Copy clean link" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("https://www.mojedane.cz/clanek?id=12");
  await expect.poll(() => note(page)).toContain("Copied");

  await pointAt("google");
  await expect.poll(() => note(page)).toBe("mvcr.czLeaves this siteGoes through a redirect to mvcr.czCopy clean link");
  await page.locator("distill-link-note").getByRole("button", { name: "Copy clean link" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("https://www.mvcr.cz/clanek/obcanske-prukazy.aspx");
  await shot(page, "r2-07-redirect");

  await pointAt("exe");
  await expect.poll(() => note(page)).toBe("example.czLeaves this siteEXE file: a program that runs on your device");

  // The note goes when the pointer leaves, on scroll and on Escape.
  await away();
  await expect.poll(() => note(page)).toBeNull();
  await page.hover("#pdf");
  await expect.poll(() => note(page)).not.toBeNull();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => note(page)).toBeNull();
  await page.evaluate(() => scrollTo(0, 0));
  await pointAt("utm");
  await expect.poll(() => note(page)).not.toBeNull();
  await page.keyboard.press("Escape");
  await expect.poll(() => note(page)).toBeNull();

  // No note on a mailto, an anchor of this page, or a link outside the main text (the menu and the footer, which Clean
  // took away: brought back from More for this).
  await away();
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByRole("button", { name: "Show everything again" }).click();
  await frame.getByTestId("cap-more-btn").click();
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator("#foot")).toBeVisible();
  for (const id of ["mail", "anchor", "menu", "foot"]) {
    await pointAt(id);
    await page.waitForTimeout(700);
    expect(await note(page), id).toBeNull();
  }

  // Keyboard focus shows the note at once.
  // A click on the paragraph's first words (no link there) starts the Tab order in the page right before the PDF link.
  const p1 = await page.locator("#p1").boundingBox();
  await page.mouse.click((p1?.x ?? 0) + 5, (p1?.y ?? 0) + 8);
  await away();
  for (let i = 0; i < 6 && (await page.evaluate(() => document.activeElement?.id)) !== "pdf"; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("pdf");
  await expect.poll(() => note(page)).toBe("127.0.0.1On this sitePDF file");
  await page.keyboard.press("Escape");
  await expect.poll(() => note(page)).toBeNull();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // The note never takes a click from the page: the link under the pointer is what a click reaches.
  await pointAt("utm");
  await expect.poll(() => note(page)).not.toBeNull();
  const hit = await page.evaluate(() => {
    const host = document.querySelector("distill-link-note") as HTMLElement;
    const r = host.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + 4, r.top + 4);
    return el?.localName ?? "";
  });
  expect(hit).not.toBe("distill-link-note");

  // The switch in More: off, no notes; on again.
  await away();
  await frame.getByTestId("cap-more-btn").click();
  const sw = frame.getByTestId("cap-links");
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(sw).not.toBeChecked();
  await frame.getByTestId("cap-more-btn").click();
  await pointAt("utm");
  await page.waitForTimeout(700);
  expect(await note(page)).toBeNull();
  await away();
  await frame.getByTestId("cap-more-btn").click();
  await sw.click();
  await expect(sw).toBeChecked();
  await frame.getByTestId("cap-more-btn").click();
  await pointAt("utm");
  await expect.poll(() => note(page)).not.toBeNull();

  // Original: no notes on the untouched page.
  await away();
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  await pointAt("pdf");
  await page.waitForTimeout(700);
  expect(await note(page)).toBeNull();
  await away();
  await frame.getByTestId("cap-back").click();

  // Distill asked for nothing while it showed the notes.
  expect(requests).toEqual([]);

  // Close: the note's element and its listeners are gone.
  expect(await startCaption(distill.worker, tab.id)).toBe(false);
  expect(await page.locator("distill-link-note").count()).toBe(0);
  await page.hover("#utm");
  await page.waitForTimeout(700);
  expect(await page.locator("distill-link-note").count()).toBe(0);
});
