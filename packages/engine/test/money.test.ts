import { describe, expect, it } from "vitest";
import { convert, currencyOfLocale, findPrices, formatMoney, parseAmount, parseEcbRates, type Rates } from "../src/money.js";

const NBSP = " ";
const one = (text: string) => {
  const found = findPrices(text, "cs");
  expect(found).toHaveLength(1);
  const p = found[0]!;
  expect(text.slice(p.start, p.end)).toBe(p.text);
  return p;
};

describe("findPrices: the Czech ways of writing a price", () => {
  it.each([
    ["Cena 1 200 Kč za den.", 1200, "1 200 Kč"],
    [`Cena 1${NBSP}200${NBSP}Kč za den.`, 1200, `1${NBSP}200${NBSP}Kč`],
    ["Cena 1 200,- Kč za den.", 1200, "1 200,- Kč"],
    ["Cena 1.200 Kč za den.", 1200, "1.200 Kč"],
    ["Cena 1 200 CZK za den.", 1200, "1 200 CZK"],
    ["Cena Kč 1 200 za den.", 1200, "Kč 1 200"],
    ["Poplatek 500Kč.", 500, "500Kč"],
    ["Poplatek 1 250,50 Kč ročně.", 1250.5, "1 250,50 Kč"],
    ["Vstupné 80,- Kč", 80, "80,- Kč"],
    ["Pes: 300 Kč/rok", 300, "300 Kč/rok"],
    ["od 500 Kč/den", 500, "500 Kč/den"],
    ["ODPADY – 500 Kč / osoba / rok Poplatek", 500, "500 Kč / osoba / rok"],
    ["Stálo to 12 345 678 Kč.", 12345678, "12 345 678 Kč"],
    ["Ticket €48 only", 48, "€48"],
    ["Ticket 48 EUR only", 48, "48 EUR"],
    ["It costs $1,200.50 today", 1200.5, "$1,200.50"],
    ["Price CZK 1,200 per day", 1200, "CZK 1,200"],
  ])("%s", (text, amount, words) => {
    const p = one(text);
    expect(p.amount).toBe(amount);
    expect(p.text).toBe(words);
  });

  it("reads the currency", () => {
    expect(one("1 200 Kč").currency).toBe("CZK");
    expect(one("€48").currency).toBe("EUR");
    expect(one("$5").currency).toBe("USD");
    expect(one("20 zł").currency).toBe("PLN");
  });

  it.each([
    ["Nájem 500-800 Kč měsíčně", 500, 800, "500-800 Kč"],
    ["Nájem 500 – 800 Kč měsíčně", 500, 800, "500 – 800 Kč"],
    ["Nájem od 500 do 800 Kč/den", 500, 800, "500 do 800 Kč/den"],
    ["Nájem 500 až 800 Kč", 500, 800, "500 až 800 Kč"],
    ["€20–30 a night", 20, 30, "€20–30"],
  ])("a range: %s", (text, amount, to, words) => {
    const p = one(text);
    expect(p).toMatchObject({ amount, to, text: words, currency: expect.any(String) });
  });

  it("finds several, in order, with offsets into the text", () => {
    const text = "Dospělí 120 Kč, děti 60,- Kč, rodina Kč 300.";
    const found = findPrices(text, "cs");
    expect(found.map((p) => p.amount)).toEqual([120, 60, 300]);
    for (const p of found) expect(text.slice(p.start, p.end)).toBe(p.text);
  });

  it.each([
    "Telefon 585 150 218",
    "V roce 2026 platí nový řád.",
    "Dne 15. 3. 2026 se koná schůze.",
    "Kapacita 120 osob",
    "Ulice Kčerná 5", // a word that starts with Kč is no currency
    "0 Kč",
  ])("no price in: %s", (text) => {
    expect(findPrices(text, "cs")).toEqual([]);
  });

  it("does not take a year before a price as part of the price", () => {
    const p = one("V roce 2026 200 Kč za psa.");
    expect(p.amount).toBe(200);
  });
});

describe("parseAmount", () => {
  it.each([
    ["1 200", 1200], ["1.200", 1200], ["1,200", 1200], ["1 200,50", 1200.5], ["1,200.50", 1200.5], ["1.200,50", 1200.5],
    ["12,5", 12.5], ["12.5", 12.5], ["80,-", 80], ["80.-", 80], ["1.234.567", 1234567],
  ])("%s -> %d", (raw, n) => {
    expect(parseAmount(raw)).toBe(n);
  });
});

const RATES: Rates = { base: "EUR", date: "2026-11-20", rates: { CZK: 25, USD: 1.08, GBP: 0.85 } };

describe("convert", () => {
  it("goes through the euro", () => {
    expect(convert(1200, "CZK", "EUR", RATES)).toBeCloseTo(48);
    expect(convert(48, "EUR", "CZK", RATES)).toBeCloseTo(1200);
    expect(convert(1250, "CZK", "USD", RATES)).toBeCloseTo(54);
    expect(convert(10, "USD", "USD", RATES)).toBe(10);
  });
  it("is null without a rate", () => {
    expect(convert(1, "CZK", "JPY", RATES)).toBeNull();
    expect(convert(1, "XXX", "EUR", RATES)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("is a short hint in the reader's locale", () => {
    expect(formatMoney(48.2, "EUR", "en-GB")).toBe("€48");
    expect(formatMoney(52.4, "USD", "en-US")).toBe("$52");
    expect(formatMoney(0.4, "EUR", "en-GB")).toBe("€0.40");
    expect(formatMoney(1234, "GBP", "en-GB")).toBe("£1,234");
  });
});

const ECB = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
	<Cube>
		<Cube time='2026-11-20'>
			<Cube currency='USD' rate='1.0543'/>
			<Cube currency='JPY' rate='162.85'/>
			<Cube currency='CZK' rate='25.112'/>
			<Cube currency='DKK' rate='7.4589'/>
			<Cube currency='GBP' rate='0.8312'/>
			<Cube currency='HUF' rate='402.15'/>
			<Cube currency='PLN' rate='4.2505'/>
		</Cube>
	</Cube>
</gesmes:Envelope>`;

describe("parseEcbRates", () => {
  it("reads the date and the rates", () => {
    const r = parseEcbRates(ECB);
    expect(r).toEqual({ base: "EUR", date: "2026-11-20", rates: { USD: 1.0543, JPY: 162.85, CZK: 25.112, DKK: 7.4589, GBP: 0.8312, HUF: 402.15, PLN: 4.2505 } });
  });
  it("is null for anything else", () => {
    expect(parseEcbRates("<html><body>Maintenance</body></html>")).toBeNull();
    expect(parseEcbRates("")).toBeNull();
    expect(parseEcbRates(ECB.replace("2026-11-20", "yesterday"))).toBeNull();
    expect(parseEcbRates(ECB.replace(/<Cube currency='(USD|JPY|CZK)'[^>]*>/g, ""))).toBeNull();
    expect(parseEcbRates(ECB.replace("rate='25.112'", "rate='-1'"))?.rates.CZK).toBeUndefined();
  });
});

describe("currencyOfLocale", () => {
  it.each([
    ["en-US", "USD"], ["en-GB", "GBP"], ["cs-CZ", "CZK"], ["de-AT", "EUR"], ["de-DE", "EUR"], ["pl-PL", "PLN"],
    ["de-CH", "CHF"], ["en", "EUR"], ["cs", "EUR"], ["zh-Hans-CN", "CNY"], ["es-419", "EUR"], ["", "EUR"], ["sr-RS", "EUR"],
  ])("%s -> %s", (locale, cur) => {
    expect(currencyOfLocale(locale)).toBe(cur);
  });
});
