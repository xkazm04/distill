// Prices and dates in your terms (r3-07), the page side: what is added beside the page's words, that the words stay,
// and that off, Original and close put every text node back exactly. Rendering (::after) is checked in the e2e.
import { afterEach, describe, expect, it } from "vitest";
import type { Rates } from "@distill/engine";
import type { CleanContext } from "./context";
import { additions, clearTerms, setTerms, tablePrices, termsAside, termsReport, TERM } from "./terms";

const RATES: Rates = { base: "EUR", date: "2026-11-20", rates: { CZK: 25, USD: 1.08, GBP: 0.85 } };

function page(html: string, lang = "cs"): CleanContext {
  document.documentElement.setAttribute("lang", lang);
  document.documentElement.removeAttribute("data-distill-original");
  document.body.innerHTML = `<main>${html}</main>`;
  const main = document.querySelector("main") as Element;
  return { doc: document, win: window, keep: [], body: Array.from(main.children), main, protect: [], removed: new Map() };
}
const on = (extra: Partial<{ currency: string; locale: string; rates: Rates }> = {}) =>
  ({ type: "distill:caption:terms" as const, on: true, locale: "en-GB", currency: "EUR", rates: RATES, ...extra });

afterEach(() => clearTerms(document));

describe("additions", () => {
  const opts = { lang: "cs", locale: "en-GB", currency: "EUR", rates: RATES, dates: true };
  it("a price gets the reader's currency, its title the rate and its date", () => {
    const [a] = additions("Cena 1 200 Kč za den.", opts);
    expect(a).toMatchObject({ kind: "price", add: "(€48)", start: 5, end: 13 });
    expect(a?.title).toContain("1 EUR = 25 CZK");
    expect(a?.title).toContain("20 November 2026");
  });
  it("a range", () => {
    expect(additions("Nájem 500-800 Kč", opts)[0]?.add).toBe("(€20–€32)");
  });
  it("nothing for a price already in the reader's currency, or without rates", () => {
    expect(additions("Cena 1 200 Kč", { ...opts, currency: "CZK" })).toEqual([]);
    expect(additions("Cena 1 200 Kč", { ...opts, rates: undefined })).toEqual([]);
  });
  it("dates in the reader's terms only when asked", () => {
    expect(additions("Zaplaťte do 15. 3. 2026.", opts).map((a) => a.add)).toEqual(["(by 15 March 2026)"]);
    expect(additions("Zaplaťte do 15. 3. 2026.", { ...opts, dates: false })).toEqual([]);
  });
});

describe("setTerms", () => {
  it("wraps the words, keeps them, and comes off exactly", () => {
    const ctx = page(`<p id="p">Poplatek za psa je 300 Kč/rok, splatný do 31. 3. 2026 na účet obce.</p>`);
    const before = document.body.innerHTML;
    const text = document.getElementById("p")!.textContent;
    const first = document.getElementById("p")!.firstChild;
    expect(setTerms(ctx, on())).toEqual({ prices: 1, dates: 1 });
    expect(document.getElementById("p")!.textContent).toBe(text); // the page's words, all of them, nothing added as text
    expect(termsReport(document)).toEqual([
      expect.objectContaining({ kind: "price", words: "300 Kč/rok", add: "(€12)" }),
      expect.objectContaining({ kind: "date", words: "do 31. 3. 2026", add: "(by 31 March 2026)" }),
    ]);
    expect(document.querySelector('style[data-distill="terms"]')).not.toBeNull();
    expect(setTerms(ctx, { type: "distill:caption:terms", on: false })).toEqual({ prices: 0, dates: 0 });
    expect(document.body.innerHTML).toBe(before);
    expect(document.getElementById("p")!.firstChild).toBe(first); // the very same text node
    expect(document.getElementById("p")!.childNodes).toHaveLength(1);
  });

  it("a price at the very start of a node, and two in one node", () => {
    const ctx = page(`<p><b>1 200 Kč</b> nebo 2 400 Kč za víkend</p>`);
    const before = document.body.innerHTML;
    expect(setTerms(ctx, on()).prices).toBe(2);
    clearTerms(document);
    expect(document.body.innerHTML).toBe(before);
  });

  it("no dates when the reader reads the page's language and nothing was translated", () => {
    const ctx = page(`<p>Schůze bude 15. 3. 2026 na úřadě, vstupné 50 Kč.</p>`);
    expect(setTerms(ctx, on({ locale: "cs-CZ", currency: "EUR" }))).toEqual({ prices: 1, dates: 0 });
  });

  it("only dates without rates", () => {
    const ctx = page(`<p>Schůze bude 15. 3. 2026 na úřadě, vstupné 50 Kč.</p>`);
    expect(setTerms(ctx, on({ rates: undefined }))).toEqual({ prices: 0, dates: 1 });
  });

  it("leaves forms, code and Distill's hidden boxes alone", () => {
    const ctx = page(`<p>Cena 100 Kč</p><form><label>Částka 200 Kč</label></form><pre>300 Kč</pre><div data-distill-hide>400 Kč</div>`);
    expect(setTerms(ctx, on()).prices).toBe(1);
  });

  it("Original takes everything out and Back to Distill puts it back", () => {
    const ctx = page(`<p id="p">Cena 1 200 Kč za den.</p>`);
    setTerms(ctx, on());
    termsAside(() => ctx, () => document.documentElement.setAttribute("data-distill-original", ""));
    expect(document.querySelector(`[${TERM}]`)).toBeNull();
    expect(document.getElementById("p")!.childNodes).toHaveLength(1);
    termsAside(() => ctx, () => document.documentElement.removeAttribute("data-distill-original"));
    expect(document.querySelectorAll(`[${TERM}]`)).toHaveLength(1);
  });

  it("a change to the text nodes (a translation) runs on whole nodes and the additions follow the new words", () => {
    const ctx = page(`<p id="p">Cena 1 200 Kč za den.</p>`);
    setTerms(ctx, on({ locale: "en-GB" }));
    const node = document.getElementById("p")!.firstChild as Text;
    termsAside(() => ctx, () => {
      expect(node.data).toBe("Cena 1 200 Kč za den."); // whole again while the translation writes
      node.data = "Price CZK 2,500 a day, due 15. 3. 2026.";
    });
    expect(termsReport(document).map((t) => [t.words, t.add])).toEqual([["CZK 2,500", "(€100)"], ["15. 3. 2026", "(15 March 2026)"]]);
  });
});

describe("tablePrices: bare numbers under a header that names the currency", () => {
  const SMID = `<table border="2"><tr><th>Typ</th><th>Délka m</th><th>Nosnost Kg</th><th>Cena s daní za 1 den Kč</th><th>Kauce</th></tr>
    <tr><th>A</th><th>2</th><th>400</th><th>300</th><th>1000</th></tr>
    <tr><th>B</th><th>2.5</th><th>400</th><th>350</th><th>3000</th></tr>
    <tr><th>C</th><th>3</th><th>480</th><th>1 200</th><th>2000</th></tr></table>`;
  it("only the column whose header names the currency", () => {
    const ctx = page(SMID);
    const found = [...tablePrices([ctx.main!]).values()];
    expect(found.map((p) => [p.amount, p.currency])).toEqual([[300, "CZK"], [350, "CZK"], [1200, "CZK"]]);
  });
  it("the live rental list: half its rows lack the last cell, so it is no data table, yet its header still names the currency", () => {
    const row = (popis: boolean, price: number) => `<tr><th><img src="v.png" width="100" height="50"></th><th>2</th><th>1.2</th><th>bez plachty</th><th>400</th><th>${price}</th><th>1000</th>${popis ? '<th><a href="p.html">Popis</a></th>' : ""}`;
    const ctx = page(`<table border="2"><tr><th>Typ</th><th>Délka m</th> <th>Šířka m</th><th>Výška m</th><th>Nosnost Kg</th><th>Cena s daní za 1 den Kč</th><th>Kauce</th><th>Foto</th>
      ${[row(false, 300), row(true, 350), row(false, 400), row(true, 480), row(false, 680)].join("\n")}</table>`);
    expect([...tablePrices([ctx.main!]).values()].map((p) => p.amount)).toEqual([300, 350, 400, 480, 680]);
  });
  it("setTerms writes them, and takes them off", () => {
    const ctx = page(SMID);
    const before = document.body.innerHTML;
    expect(setTerms(ctx, on()).prices).toBe(3);
    expect(termsReport(document).map((t) => t.add)).toEqual(["(€12)", "(€14)", "(€48)"]);
    clearTerms(document);
    expect(document.body.innerHTML).toBe(before);
  });
});
