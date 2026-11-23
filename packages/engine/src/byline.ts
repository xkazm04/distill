// Round 3, card 5 (r3-05): who wrote this and when, from the page's own data. Pure reading: structured data (JSON-LD),
// meta tags, then the visible byline. Nothing is fetched. CONTRACT STUB: the r3-05 builder fills it in.

export interface Byline {
  publisher?: string;
  author?: string;
  /** ISO date (YYYY-MM-DD) or date-time, as the page states it. */
  published?: string;
  updated?: string;
  /** Where the dates came from: structured data, meta tags, the visible text, or nowhere. */
  from: "data" | "meta" | "text" | "none";
}

/** Reads the byline of `doc`. Never throws; a page with nothing says `{ from: "none" }`. */
export function readByline(_doc: Document): Byline {
  return { from: "none" };
}

/** The strip's words, or null when there is nothing worth a line ("Published 3 years ago, updated yesterday" only when
 *  the two dates differ by more than a week). `now` is passed in so tests are stable. */
export function bylineLine(_b: Byline, _now: Date): string | null {
  return null;
}
