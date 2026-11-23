// Round 3, card 7 (r3-07): dates and times in your terms. Finds Czech (and other numeric day-month) dates in page text
// and writes them in the reader's locale. Pure: no DOM.
//
// Read here: "15. 3. 2026", "15.3.2026", "15.3.", "15. 3.", "15. března 2026", "15. března", each with an optional
// word before it that changes its meaning ("do 15. 3." = by, "od 15. 3." = from) and an optional time after it
// ("15. 3. 2026 v 10:30", "15. 3. 2026, 10.30 hod."). A time on its own is read only with "hod." after it
// ("10.30 hod.", "10 hod."): a bare "10:30" reads the same everywhere.

export interface FoundDate {
  start: number;
  end: number;
  /** The exact words: "15. 3. 2026", "do 15. 3.". */
  text: string;
  /** YYYY-MM-DD, or --MM-DD when the page gives no year; "" for a time on its own ("10.30 hod."). */
  iso: string;
  /** HH:MM when a time is part of it. */
  time?: string;
}

/** Czech month names as a date writes them (genitive), and a few common short forms. */
const MONTHS: [RegExp, number][] = [
  [/^led(?:na|en)?\.?$/u, 1], [/^únor(?:a)?$|^úno\.?$/u, 2], [/^břez(?:na|en)$|^bře\.?$/u, 3], [/^dub(?:na|en)?\.?$/u, 4],
  [/^květ(?:na|en)$|^kvě\.?$/u, 5], [/^červ(?:na|en)$|^čvn\.?$/u, 6], [/^července$|^červenec$|^čvc\.?$/u, 7],
  [/^srp(?:na|en)?\.?$/u, 8], [/^září$|^zář\.?$/u, 9], [/^října$|^říjen$|^říj\.?$/u, 10], [/^listopad(?:u)?$|^lis\.?$/u, 11],
  [/^prosin(?:ce|ec)$|^pro\.?$/u, 12],
];
const monthOf = (word: string): number | null => MONTHS.find(([re]) => re.test(word.toLowerCase()))?.[1] ?? null;

const SP = "[ \\u00a0\\u202f\\u2009]";
/** Words before a date that change what it means. */
const LEAD = `(?:(do|od|dne|ode dne|před|po|nejpozději do|k)${SP}+)?`;
/** A time after a date: ", 10:30", " v 10.30 hod.", " od 9 hod.". */
const TIME_AFTER = `(?:,?${SP}*(?:v|ve|od|do|o)?${SP}*(\\d{1,2})[:.](\\d{2})(?:${SP}*hod\\.?)?|,?${SP}*(?:v|ve|od|do|o)?${SP}*(\\d{1,2})${SP}*hod\\.?)?`;
const NB = "(?<![\\p{L}\\p{N}.])";

/** "15. 3. 2026", "15.3.", "do 15. 3." with an optional time. Groups: 1 lead, 2 day, 3 month, 4 year, 5-6 h:m, 7 h. */
const NUMERIC = new RegExp(`${NB}${LEAD}(\\d{1,2})\\.${SP}?(\\d{1,2})\\.(?:${SP}?(\\d{4}))?(?![\\p{N}])${TIME_AFTER}`, "giu");
/** "15. března 2026". Groups: 1 lead, 2 day, 3 month word, 4 year, 5-6 h:m, 7 h. */
const WORDED = new RegExp(`${NB}${LEAD}(\\d{1,2})\\.${SP}?(\\p{L}{3,9}\\.?)(?:${SP}(\\d{4}))?(?![\\p{L}\\p{N}])${TIME_AFTER}`, "giu");
/** "10.30 hod.", "10:30 hod.", "10 hod." on their own. Groups: 1 lead, 2 h, 3 m. */
const TIME_ONLY = new RegExp(`${NB}(?:(v|ve|od|do|o)${SP}+)?(\\d{1,2})(?:[:.](\\d{2}))?${SP}*hod\\.?(?![\\p{L}])`, "giu");

const pad = (n: number): string => String(n).padStart(2, "0");
const validDay = (d: number, m: number, y?: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const days = new Date(Date.UTC(y ?? 2024, m, 0)).getUTCDate(); // 2024: a leap year, so 29. 2. without a year stays
  return d <= days;
};
const timeOf = (h?: string, m?: string, hOnly?: string): string | undefined => {
  const hh = Number(h ?? hOnly);
  const mm = Number(m ?? "0");
  if ((h ?? hOnly) === undefined || hh > 23 || mm > 59) return undefined;
  return `${pad(hh)}:${pad(mm)}`;
};

/** The words before a date as the reader reads them (English), by the Czech word. */
const LEAD_WORDS: Record<string, string> = { do: "by", "nejpozději do": "by", od: "from", "ode dne": "from", "před": "before", po: "after", k: "as of" };
/** Keeps what the date's lead word was, so formatDate can say "by 15 March". */
const leadOf = (text: string): string | undefined => {
  const m = new RegExp(`^(nejpozději do|ode dne|do|od|dne|před|po|k)${SP}`, "iu").exec(text);
  return m?.[1]?.toLowerCase();
};

/** Every date (and time with "hod.") in `text`, in order, never overlapping. */
export function findDates(text: string, _lang: string): FoundDate[] {
  const found: FoundDate[] = [];
  const add = (start: number, words: string, iso: string, time?: string) => {
    // A trailing comma or space the time part took without a time is not the date's.
    const trimmed = words.replace(/[,\s ]+$/u, "");
    const end = start + trimmed.length;
    if (found.some((f) => start < f.end && end > f.start)) return;
    const d: FoundDate = { start, end, text: trimmed, iso };
    if (time) d.time = time;
    found.push(d);
  };
  for (const m of text.matchAll(NUMERIC)) {
    const day = Number(m[2]);
    const month = Number(m[3]);
    const year = m[4] ? Number(m[4]) : undefined;
    if (!validDay(day, month, year)) continue;
    // "1.2." in "verze 1.2.3" is no date; a date without a year needs a word before it or must stand alone.
    if (!year && /^\d/.test(text.slice((m.index ?? 0) + m[0].length))) continue;
    const iso = year ? `${year}-${pad(month)}-${pad(day)}` : `--${pad(month)}-${pad(day)}`;
    add(m.index ?? 0, m[0], iso, timeOf(m[5], m[6], m[7]));
  }
  for (const m of text.matchAll(WORDED)) {
    const month = monthOf((m[3] as string).replace(/\.$/, "")) ?? monthOf(m[3] as string);
    if (!month) continue;
    const day = Number(m[2]);
    const year = m[4] ? Number(m[4]) : undefined;
    if (!validDay(day, month, year)) continue;
    const iso = year ? `${year}-${pad(month)}-${pad(day)}` : `--${pad(month)}-${pad(day)}`;
    add(m.index ?? 0, m[0], iso, timeOf(m[5], m[6], m[7]));
  }
  for (const m of text.matchAll(TIME_ONLY)) {
    const time = timeOf(m[2], m[3] ?? "00");
    if (time) add(m.index ?? 0, m[0], "", time);
  }
  return found.sort((a, b) => a.start - b.start);
}

/** "15 March 2026" (en-GB), "March 15, 2026" (en-US), with the time ("15 March 2026, 10:30") and the lead word in
 *  English locales ("by 15 March"). A time on its own: "10:30" (or "10:30 AM"). */
export function formatDate(d: FoundDate, locale: string): string {
  const lead = leadOf(d.text);
  const english = /^en\b/i.test(locale);
  let out = "";
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.iso);
  const partial = /^--(\d{2})-(\d{2})$/.exec(d.iso);
  const fmt = (opts: Intl.DateTimeFormatOptions, date: Date): string => {
    try { return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(date); } catch { return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(date); }
  };
  if (full) out = fmt({ day: "numeric", month: "long", year: "numeric" }, new Date(Date.UTC(+full[1]!, +full[2]! - 1, +full[3]!)));
  else if (partial) out = fmt({ day: "numeric", month: "long" }, new Date(Date.UTC(2024, +partial[1]! - 1, +partial[2]!)));
  if (d.time) {
    const [h, m] = d.time.split(":").map(Number) as [number, number];
    const t = fmt({ hour: "numeric", minute: "2-digit" }, new Date(Date.UTC(2024, 0, 1, h, m)));
    out = out ? `${out}, ${t}` : t;
  }
  if (!out) return d.text;
  const word = lead && english ? LEAD_WORDS[lead] : undefined;
  return word ? `${word} ${out}` : out;
}
