// Round 3, card 7 (r3-07): prices in your currency. Finding prices in page text, converting with the European Central
// Bank's daily reference rates, and reading the ECB's public XML. Pure. CONTRACT STUB: the r3-07 builder fills it in.

/** ECB reference rates: 1 EUR = rates[code]. `date` is the ECB's own date (YYYY-MM-DD). */
export interface Rates { base: "EUR"; date: string; rates: Record<string, number> }

export interface FoundPrice {
  /** Offsets in the text the price was found in. */
  start: number;
  end: number;
  amount: number;
  /** ISO 4217 ("CZK"). */
  currency: string;
  /** The exact words: "1 200,- Kč". */
  text: string;
}

export function findPrices(_text: string, _lang: string): FoundPrice[] {
  return [];
}

/** `amount` of `from` in `to`, or null when a rate is missing. */
export function convert(_amount: number, _from: string, _to: string, _rates: Rates): number | null {
  return null;
}

/** "€48", "$52" in `locale`, rounded sensibly for a hint in brackets. */
export function formatMoney(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

/** The ECB's eurofxref-daily.xml, or null when it does not look like one. */
export function parseEcbRates(_xml: string): Rates | null {
  return null;
}
