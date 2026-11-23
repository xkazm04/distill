// Spark round 3: r3-07 Prices and dates in your terms, on the demo page caption-terms.html. Hermetic: the ECB's daily
// list is a stub served by route interception, and the test proves the rate download is the only request Distill
// makes: one GET to www.ecb.europa.eu, with no cookies, no referrer and no page data. Real sites:
// live/probes/terms.live.ts. Screenshots go to E2E_EVIDENCE_DIR when it is set, else e2e/out/evidence.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Request } from "playwright/test";
import { captionFrame, firstSight, startCaption } from "./caption";
import { expect, OUT, test } from "./harness";

const EVIDENCE = process.env.E2E_EVIDENCE_DIR || join(OUT, "evidence");
const shot = async (page: Page, name: string) => {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}.jpg`), type: "jpeg", quality: 80 });
};

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const STUB = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
<gesmes:subject>Reference rates</gesmes:subject><gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
<Cube><Cube time='2026-11-20'><Cube currency='USD' rate='1.08'/><Cube currency='JPY' rate='162.85'/><Cube currency='CZK' rate='25.00'/>
<Cube currency='GBP' rate='0.85'/><Cube currency='PLN' rate='4.25'/></Cube></Cube></gesmes:Envelope>`;

/** Every addition on the page now: its words, what is shown after them, its title. Runs in the page. */
function terms(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("[data-distill-term]")).map((el) => ({
    kind: el.getAttribute("data-distill-term"),
    words: el.textContent,
    after: getComputedStyle(el, "::after").content.replace(/[  ]/g, " "),
    title: el.getAttribute("title") ?? "",
  })));
}

/** The main text's markup without the marker attributes of Distill's other modules (comfort, tables): what terms
 *  must give back exactly. Runs in the page. */
function markup(page: Page) {
  return page.evaluate(() => {
    const main = (document.querySelector("main") as Element).cloneNode(true) as Element;
    for (const el of [main, ...Array.from(main.querySelectorAll("*"))]) {
      for (const a of el.getAttributeNames()) if (a.startsWith("data-distill-") && !a.startsWith("data-distill-term")) el.removeAttribute(a);
    }
    return main.innerHTML;
  });
}

test("caption terms: prices in the reader's currency and dates their way beside the page's words; one ECB request, no cookies; off, Original and close restore", async ({ distill }) => {
  const ecb: Request[] = [];
  const outside: string[] = [];
  // A cookie the ECB set before: the download must not carry it.
  await distill.context.addCookies([{ name: "ecb_tracker", value: "seen-before", domain: "www.ecb.europa.eu", path: "/", secure: true }]);
  await distill.context.route("https://www.ecb.europa.eu/**", (r) => {
    ecb.push(r.request());
    return r.fulfill({ status: 200, contentType: "text/xml", body: STUB });
  });
  distill.context.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(distill.origin) && !u.startsWith("chrome-extension:") && !u.startsWith("data:") && !u.startsWith(ECB_URL)) outside.push(u);
  });

  const tab = await distill.openTab("caption-terms");
  const page = tab.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  const untouched = await page.evaluate(() => (document.querySelector("main") as Element).innerHTML);
  const words = await page.evaluate(() => (document.querySelector("main") as Element).textContent);

  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(page);
  await firstSight(frame);
  await expect.poll(async () => (await terms(page)).length, { timeout: 10_000 }).toBe(10);

  // The browser's locale here is en-US: dollars, and the dates written the American way.
  const now = await terms(page);
  expect(now.map((t) => [t.words, t.after])).toEqual([
    ["300 Kč/rok", '" ($13)"'],
    ["nejpozději do 31. 3. 2026", '" (by March 31, 2026)"'],
    ["1 200,- Kč", '" ($52)"'],
    ["Kč 600", '" ($26)"'],
    ["2.000 Kč", '" ($86)"'],
    ["4 500–6 800 Kč", '" ($194–$294)"'],
    ["15. března od 10.30 hod.", '" (March 15, 10:30 AM)"'],
    ["300", '" ($13)"'],
    ["480", '" ($21)"'],
    ["350", '" ($15)"'],
  ]);
  expect(now[0]?.title).toContain("1 USD = 23.15 CZK");
  expect(now[0]?.title).toContain("European Central Bank");
  expect(now[0]?.title).toContain("November 20, 2026");
  // The page's words stay, every one: the additions are not text of the page.
  expect(await page.evaluate(() => (document.querySelector("main") as Element).textContent)).toBe(words);
  // The bare numbers under "Kč" are priced; the deposit column, which names no currency, is not.
  expect(now.filter((t) => t.words === "1000" || t.words === "3000")).toEqual([]);
  await shot(page, "r3-07-demo");

  // The one request: a GET of the ECB's list, without the ECB's cookie, without a referrer, without a body.
  expect(ecb).toHaveLength(1);
  const req = ecb[0] as Request;
  expect(req.url()).toBe(ECB_URL);
  expect(req.method()).toBe("GET");
  expect(req.postData()).toBeNull();
  const headers = await req.allHeaders();
  expect(headers.cookie).toBeUndefined();
  expect(headers.referer).toBeUndefined();
  expect(Object.values(headers).join(" ")).not.toContain("caption-terms");
  expect(outside).toEqual([]);

  // More: the section says what was written; another currency uses the kept rates (no second download).
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-terms-line")).toHaveText("8 prices in USD, 2 dates written your way.");
  await expect(frame.getByTestId("cap-terms-rates")).toContainText("European Central Bank");
  await frame.getByTestId("cap-terms-currency").selectOption("EUR");
  await expect.poll(async () => (await terms(page))[0]?.after).toBe('" (€12)"');
  expect(ecb).toHaveLength(1);
  await frame.getByTestId("cap-more-btn").click();

  // Original: the page as written, nothing added; Back to Distill puts them back.
  await frame.getByTestId("cap-original").click();
  await frame.getByTestId("cap-back").waitFor();
  expect(await terms(page)).toEqual([]);
  expect(await markup(page)).toBe(untouched);
  await frame.getByTestId("cap-back").click();
  await expect.poll(async () => (await terms(page)).length).toBe(10);

  // Off: exactly the page's own markup again. On: back.
  await frame.getByTestId("cap-more-btn").click();
  await frame.getByTestId("cap-terms").click();
  await expect(frame.getByTestId("cap-terms-line")).toHaveText("Off: the page's prices and dates as written.");
  expect(await markup(page)).toBe(untouched);
  await frame.getByTestId("cap-terms").click();
  await expect.poll(async () => (await terms(page)).length).toBe(10);

  // Close: every addition and Distill's style go.
  await frame.getByTestId("cap-close").click();
  await expect.poll(() => page.evaluate(() => !!document.querySelector("distill-caption"))).toBe(false);
  expect(await page.evaluate(() => (document.querySelector("main") as Element).innerHTML)).toBe(untouched);
  expect(await page.evaluate(() => document.querySelectorAll('style[data-distill="terms"]').length)).toBe(0);
});

test("caption terms: without rates (the ECB unreachable) only dates are written", async ({ distill }) => {
  const tab = await distill.openTab("caption-terms");
  await startCaption(distill.worker, tab.id);
  const frame = await captionFrame(tab.page);
  await firstSight(frame);
  await expect.poll(async () => (await terms(tab.page)).map((t) => t.kind), { timeout: 10_000 }).toEqual(["date", "date"]);
  await frame.getByTestId("cap-more-btn").click();
  await expect(frame.getByTestId("cap-terms-line")).toHaveText("2 dates written your way.");
});
