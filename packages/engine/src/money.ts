// Round 3, card 7 (r3-07): prices in your currency. Finding prices in page text, converting with the European Central
// Bank's daily reference rates, and reading the ECB's public XML. Pure: no DOM, no network.
//
// What counts as a price: a number right next to a currency word or sign ("1 200 Kč", "1 200,- Kč", "1.200 Kč",
// "1 200 CZK", "Kč 1 200", "€48", "48 EUR"), with an optional unit after a slash ("500 Kč/den") and ranges of two
// numbers sharing one currency ("500-800 Kč", "od 500 do 800 Kč", "500 až 800 Kč"). A bare number is never a price.

/** ECB reference rates: 1 EUR = rates[code]. `date` is the ECB's own date (YYYY-MM-DD). */
export interface Rates { base: "EUR"; date: string; rates: Record<string, number> }

export interface FoundPrice {
  /** Offsets in the text the price was found in. */
  start: number;
  end: number;
  amount: number;
  /** A range's upper end ("500-800 Kč": amount 500, to 800). */
  to?: number;
  /** ISO 4217 ("CZK"). */
  currency: string;
  /** The exact words: "1 200,- Kč". */
  text: string;
}

/** Currency words and signs -> ISO 4217. Longer spellings first, so "Kč" never stops at "K". */
const CURRENCY_WORDS: [string, string][] = [
  ["Kč", "CZK"], ["Kc", "CZK"], ["CZK", "CZK"], ["korun", "CZK"],
  ["EUR", "EUR"], ["€", "EUR"], ["eur", "EUR"],
  ["USD", "USD"], ["US$", "USD"], ["$", "USD"],
  ["GBP", "GBP"], ["£", "GBP"],
  ["PLN", "PLN"], ["zł", "PLN"],
  ["HUF", "HUF"], ["Ft", "HUF"],
  ["CHF", "CHF"],
];
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CUR = CURRENCY_WORDS.map(([w]) => w).sort((a, b) => b.length - a.length).map(esc).join("|");
const codeOf = (word: string): string => CURRENCY_WORDS.find(([w]) => w === word)?.[1] ?? word.toUpperCase();

/** Spaces a number may use between its thousands: space, no-break space, narrow no-break space, thin space. */
const GAP = "[ \\u00a0\\u202f\\u2009]";
/** A number: grouped thousands ("1 200", "1.200", "1,200") with optional decimals, or plain digits with optional
 *  decimals. The ",-" of "1 200,- Kč" is a whole number's way of saying "no hellers". */
const NUM = `(?:\\d{1,3}(?:(?:${GAP}|\\.|,)\\d{3})+|\\d+)(?:[.,]\\d{1,2})?(?:,[-\u2013\u2014]|\\.-)?`;
/** Between a range's two numbers. */
const RANGE = `(?:${GAP}*[-\u2013\u2014]${GAP}*|${GAP}+(?:až|do|to|bis)${GAP}+)`;
/** Up to two units after slashes: "/den", "/měsíc", "/os.", "/ osoba / rok". */
const UNIT = "(?:\\s?\\/\\s?\\p{L}{1,10}\\.?){0,2}";
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}.,])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])";

/** "1 200 Kč", "500-800 Kč", "od 500 do 800 Kč/den". Groups: 1 low, 2 high, 3 currency. */
const SUFFIX = new RegExp(`${NOT_WORD_BEFORE}(${NUM})(?:${RANGE}(${NUM}))?${GAP}?(${CUR})${NOT_WORD_AFTER}${UNIT}`, "gu");
/** "Kč 1 200", "€48", "$1,200.50", "€20-30". Groups: 1 currency, 2 low, 3 high. */
const PREFIX = new RegExp(`(?<![\\p{L}\\p{N}])(${CUR})${GAP}?(${NUM})(?:${RANGE}(?:${CUR})?${GAP}?(${NUM}))?(?![\\p{N}])${UNIT}`, "gu");

/**
 * A number as written. Czech (and most of Europe) writes "1 200,50" and "1.200"; English writes
 * "1,200.50". When both separators appear, the last one is the decimal point. A lone separator followed by exactly
 * three digits groups thousands (money is never written with three decimals).
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/(?:,[-\u2013\u2014]|\.-)$/u, "").replace(/[ \u00a0\u202f\u2009]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = Math.max(lastComma, lastDot);
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1] as string;
    // Money never has three decimals: a lone separator before exactly three digits groups thousands.
    const thousands = parts.length > 2 || tail.length === 3;
    s = thousands ? parts.join("") : parts.slice(0, -1).join("") + "." + tail;
  }
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Every price in `text`, in order, never overlapping. `_lang` is the text's language ("cs", "en"); the formats read
 *  here are the same in each, so it is not needed yet. */
export function findPrices(text: string, _lang: string): FoundPrice[] {
  const found: FoundPrice[] = [];
  const add = (start: number, words: string, low: string, high: string | undefined, cur: string) => {
    const amount = parseAmount(low);
    if (amount === null || amount <= 0) return;
    const end = start + words.length;
    if (found.some((f) => start < f.end && end > f.start)) return;
    const to = high !== undefined ? parseAmount(high) : null;
    const p: FoundPrice = { start, end, amount, currency: codeOf(cur), text: words };
    if (to !== null && to > amount) p.to = to;
    found.push(p);
  };
  for (const m of text.matchAll(SUFFIX)) add(m.index ?? 0, m[0], m[1] as string, m[2], m[3] as string);
  for (const m of text.matchAll(PREFIX)) add(m.index ?? 0, m[0], m[2] as string, m[3], m[1] as string);
  return found.sort((a, b) => a.start - b.start);
}

/** `amount` of `from` in `to`, or null when a rate is missing. */
export function convert(amount: number, from: string, to: string, rates: Rates): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return amount;
  const rate = (code: string): number | null => {
    if (code === "EUR") return 1;
    const r = rates.rates[code];
    return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : null;
  };
  const rf = rate(f);
  const rt = rate(t);
  if (rf === null || rt === null) return null;
  return (amount / rf) * rt;
}

/** "€48", "$52" in `locale`, rounded sensibly for a hint in brackets: whole units from 10 up, cents below. */
export function formatMoney(amount: number, currency: string, locale: string): string {
  const digits = Math.abs(amount) >= 10 ? 0 : 2;
  const opts: Intl.NumberFormatOptions = { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits };
  try {
    return new Intl.NumberFormat(locale, { ...opts, currencyDisplay: "narrowSymbol" }).format(amount);
  } catch {
    return new Intl.NumberFormat("en", opts).format(amount);
  }
}

/** The ECB's eurofxref-daily.xml, or null when it does not look like one. */
export function parseEcbRates(xml: string): Rates | null {
  if (typeof xml !== "string" || xml.length > 200_000) return null;
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]\s*\/?>/g)) {
    const rate = Number(m[2]);
    if (Number.isFinite(rate) && rate > 0 && m[1] !== "EUR") rates[m[1] as string] = rate;
  }
  if (Object.keys(rates).length < 5) return null;
  return { base: "EUR", date, rates };
}

/** The euro area (2026): a reader from these regions pays in euros. */
const EURO = new Set("AT BE HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES BG AD MC SM VA ME XK".split(" "));
/** Regions whose own currency the ECB lists. */
const REGION_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", JP: "JPY", CZ: "CZK", DK: "DKK", HU: "HUF", PL: "PLN", RO: "RON", SE: "SEK", CH: "CHF", LI: "CHF",
  IS: "ISK", NO: "NOK", TR: "TRY", AU: "AUD", BR: "BRL", CA: "CAD", CN: "CNY", HK: "HKD", ID: "IDR", IL: "ILS", IN: "INR",
  KR: "KRW", MX: "MXN", MY: "MYR", NZ: "NZD", PH: "PHP", SG: "SGD", TH: "THB", ZA: "ZAR",
};

/** The reader's currency from a locale's region ("en-GB" -> GBP, "cs-CZ" -> CZK, "de-AT" -> EUR); EUR when the locale
 *  names no region or one the ECB does not list. */
export function currencyOfLocale(locale: string): string {
  // Only a region the locale itself names: "en" alone would maximize to US, which is a guess, not the reader's choice.
  const region = /^[A-Za-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(locale)?.[1]?.toUpperCase();
  if (!region || EURO.has(region)) return "EUR";
  return REGION_CURRENCY[region] ?? "EUR";
}

/** The currencies a reader can choose in More (the ECB's list plus the euro), in a stable order. */
export const READER_CURRENCIES = ["EUR", "USD", "GBP", "CZK", "PLN", "HUF", "CHF", "SEK", "NOK", "DKK", "RON", "JPY", "CAD", "AUD", "CNY", "INR"] as const;
