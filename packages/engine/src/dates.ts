// Round 3, card 7 (r3-07): dates and times in your terms. Finds Czech (and other numeric) dates in page text and writes
// them in the reader's locale. Pure. CONTRACT STUB: the r3-07 builder fills it in.

export interface FoundDate {
  start: number;
  end: number;
  /** The exact words: "15. 3. 2026", "do 15. 3.". */
  text: string;
  /** YYYY-MM-DD, or --MM-DD when the page gives no year. */
  iso: string;
  /** HH:MM when a time is part of it. */
  time?: string;
}

export function findDates(_text: string, _lang: string): FoundDate[] {
  return [];
}

/** "15 March 2026" in `locale`. */
export function formatDate(d: FoundDate, _locale: string): string {
  return d.text;
}
