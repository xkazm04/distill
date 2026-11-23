// Spark universal-core round 2, card 4: plain words in place (the existing task simplifyBlocks on the caption's text
// blocks). A rewrite must keep the facts: every number, date, time, amount, percentage, link and name of the source
// block. One that drops or changes one is refused and its block stays as written. The model's answer is untrusted: it
// first passes the same checks as a translation (parseTranslation: only the source's ids, once each, plain text, a
// length cap), then the facts check.
//
// Facts are compared normalised, never as raw text: "1 234,5" (Czech), "1,234.5" (English) and "1234.5" are one
// number; "15. března 2026", "15. 3. 2026", "15.3.2026", "2026-03-15" and "March 15, 2026" one date; "500 Kč" and
// "500 CZK" one amount; "15 %" and "15 procent" one percentage. A name is a capitalised word that does not start a
// sentence; it survives a Czech case ending ("Benešov" / "Benešově"), compared without regard to letter case.
import { parseTranslation, type TranslateBlock } from "./translate.js";

/** What a rewrite would have lost: a number (times and percentages count as numbers), a date, an amount, a name. */
export type FactKind = "number" | "date" | "amount" | "name" | "link";

export interface Fact {
  kind: FactKind;
  /** The fact as the source wrote it, for a log or a test (page text: it never leaves the browser). */
  text: string;
}

export interface PlainResult {
  /** Rewrites that passed, in the source's order. */
  blocks: TranslateBlock[];
  /** Refused because a number, date, amount or name of the source is missing or changed. */
  lostFacts: number;
  /** For each refused block, the kind of the first fact it lost (in the source's order). */
  lostKinds: FactKind[];
  /** The ids of the refused blocks, in the same order as lostKinds. */
  lostIds: string[];
  /** Refused for any other reason (unknown id, no text, HTML only, far too long). */
  dropped: number;
}

// ---- Normalising -------------------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {};
[
  ["leden", "ledna", "january", "jan"], ["únor", "února", "february", "feb"], ["březen", "března", "march", "mar"],
  ["duben", "dubna", "april", "apr"], ["květen", "května", "may"], ["červen", "června", "june", "jun"],
  ["červenec", "července", "july", "jul"], ["srpen", "srpna", "august", "aug"], ["září", "september", "sep", "sept"],
  ["říjen", "října", "october", "oct"], ["listopad", "listopadu", "november", "nov"], ["prosinec", "prosince", "december", "dec"],
].forEach((names, i) => names.forEach((n) => { MONTHS[n] = i + 1; }));
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

/** A number as written: digit groups (space, comma or dot every three digits), then maybe a decimal part. */
const NUM = String.raw`\d{1,3}(?:[ ,.]\d{3}(?!\d))+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
const NOT_AFTER_WORD = String.raw`(?<![\p{L}\p{N}])`;
const UNIT = String.raw`Kč|Kc|CZK|korun[ay]?|€|EUR|eur(?:o|a|u)?|\$|USD|dolar(?:ů|y|u)?|dollars?|£|GBP|%|procent[ao]?|percent|per\s?cent`;
/** A currency or percent word is part of an amount, never a name ("Kč", "EUR"). */
const UNIT_WORD = new RegExp(`^(?:${UNIT})$`, "iu");
const PREFIX_UNIT = String.raw`€|\$|£|EUR|CZK|USD|GBP|Kč`;

const AMOUNT_AFTER = new RegExp(`${NOT_AFTER_WORD}(${NUM})(?:,-)?\\s?(${UNIT})(?![\\p{L}])`, "giu");
const AMOUNT_BEFORE = new RegExp(`(?<![\\p{L}])(${PREFIX_UNIT})\\s?(${NUM})(?![\\d])`, "giu");
const NUMBER = new RegExp(`${NOT_AFTER_WORD}(?:${NUM})`, "gu");
const DATE_DMY = /(?<![\p{L}\p{N}.,])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}))?(?!\d)/gu;
const DATE_ISO = /(?<![\p{L}\p{N}])(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/gu;
const TIME = /(?<![\p{L}\p{N}.,:])(\d{1,2}):(\d{2})(?![\d:])/gu;
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/giu;
const WORD = /[\p{L}][\p{L}\p{M}\p{N}'’-]*/gu;

function unitOf(u: string): string {
  const x = u.toLowerCase().replace(/\s/g, "");
  if (/^(kč|kc|czk|korun)/.test(x)) return "CZK";
  if (x === "€" || x.startsWith("eur")) return "EUR";
  if (x === "$" || x === "usd" || x.startsWith("dol")) return "USD";
  if (x === "£" || x === "gbp") return "GBP";
  return "%";
}

/** Text with one kind of space and dash, composed letters. */
const tidy = (s: string): string => s.normalize("NFC").replace(/[     ]/g, " ");

/** Month names next to a day or a year become their number ("15. března 2026" -> "15. 3. 2026"). */
function monthsToNumbers(s: string): string {
  const name = (m: string) => MONTHS[m.toLowerCase()] ?? 0;
  return s
    .replace(new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,2})\\.?\\s*(${MONTH_RE})(?![\\p{L}])`, "giu"), (_a, d: string, m: string) => `${d}. ${name(m)}.`)
    .replace(new RegExp(`(?<![\\p{L}])(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,)?`, "giu"), (_a, m: string, d: string) => `${d}. ${name(m)}.`)
    .replace(new RegExp(`(?<![\\p{L}])(${MONTH_RE})\\.?\\s+(\\d{4})(?!\\d)`, "giu"), (_a, m: string, y: string) => `${name(m)}/${y}`);
}

/** "007" -> "7", "12.50" -> "12.5", "3.0" -> "3". */
function canon(intPart: string, dec = ""): string {
  const i = intPart.replace(/^0+(?=\d)/, "");
  const d = dec.replace(/0+$/, "");
  return d ? `${i}.${d}` : i;
}

/**
 * The values a number as written may mean, as alternatives (each a list of values that must all be present):
 * "1 234,5" -> [[1234.5], [1, 234.5]]; "1,234" -> [[1234], [1.234]]; "12,5" -> [[12.5]].
 */
export function numberValues(raw: string): string[][] {
  const r = raw.trim();
  if (/ /.test(r)) {
    const joined = r.replace(/ /g, "");
    const alts = numberValues(joined);
    const parts = r.split(" ").map((p) => numberValues(p)[0]?.[0] ?? p);
    return [...alts, parts];
  }
  const comma = r.includes(",");
  const dot = r.includes(".");
  if (comma && dot) {
    const decSep = r.lastIndexOf(",") > r.lastIndexOf(".") ? "," : ".";
    const [i, d] = r.split(decSep) as [string, string?];
    return [[canon(i.replace(/[.,]/g, ""), d)]];
  }
  if (comma || dot) {
    const sep = comma ? "," : ".";
    const parts = r.split(sep);
    if (parts.length > 2) return [[canon(parts.join(""))]]; // 1.234.567
    const [i, d] = parts as [string, string];
    // Ambiguous: a thousand, or a decimal written with exactly those three digits ("12,500" is never "12.5").
    if (d.length === 3) return [[canon(i + d)], [`${canon(i)}.${d}`]];
    return [[canon(i, d)]];
  }
  return [[canon(r)]];
}

interface Facts {
  numbers: { text: string; alts: string[][] }[];
  dates: { text: string; d: number; m: number; y?: number }[];
  times: { text: string; value: string }[];
  amounts: { text: string; unit: string; alts: string[][] }[];
  links: { text: string; value: string }[];
  names: { text: string; value: string }[];
  /** The rewrite side: every value a number of it may mean (amounts' numbers included). */
  values: Set<string>;
  words: string[];
}

/** Everything a rewrite must keep, read from `text`. */
function factsOf(input: string): Facts {
  const f: Facts = { numbers: [], dates: [], times: [], amounts: [], links: [], names: [], values: new Set(), words: [] };
  let s = tidy(input);
  const blank = (m: string) => " ".repeat(m.length);
  s = s.replace(LINK, (m) => { f.links.push({ text: m, value: m.toLowerCase().replace(/[.,;:!?)]+$/, "") }); return blank(m); });

  // Words, before any number is taken out: names, and every word for the rewrite side.
  const sentenceStart = (at: number): boolean => {
    let i = at - 1;
    while (i >= 0 && /[\s„“"'‚‘«»([{]/u.test(s[i] ?? "")) i--;
    return i < 0 || /[.!?:;…•–—\-|]/u.test(s[i] ?? "");
  };
  for (const m of s.matchAll(WORD)) {
    const w = m[0].replace(/[-'’]+$/, "");
    const lower = w.toLowerCase();
    f.words.push(lower);
    if (w.length < 2 || !/^\p{Lu}/u.test(w) || MONTHS[lower] !== undefined || UNIT_WORD.test(w)) continue;
    if (sentenceStart(m.index ?? 0)) continue;
    f.names.push({ text: w, value: lower });
  }

  s = monthsToNumbers(s);
  s = s.replace(DATE_ISO, (m, y: string, mo: string, d: string) => { f.dates.push({ text: m, d: +d, m: +mo, y: +y }); return blank(m); });
  s = s.replace(DATE_DMY, (m, d: string, mo: string, y?: string) => {
    if (+d < 1 || +d > 31 || +mo < 1 || +mo > 12) return m; // not a date: left for the numbers
    f.dates.push({ text: m, d: +d, m: +mo, ...(y ? { y: +y } : {}) });
    return blank(m);
  });
  // A month with a year only ("March 2026" -> "3/2026"): its month and year as numbers.
  s = s.replace(/(?<!\d)(\d{1,2})\/(\d{4})(?!\d)/g, (_m, mo: string, y: string) => ` ${mo} ${y} `);
  s = s.replace(TIME, (m, h: string, mi: string) => { f.times.push({ text: m, value: `${+h}:${mi}` }); return blank(m); });
  const amount = (m: string, num: string, unit: string) => {
    const alts = numberValues(num);
    f.amounts.push({ text: m.trim(), unit: unitOf(unit), alts });
    alts.flat().forEach((v) => f.values.add(v));
    return blank(m);
  };
  s = s.replace(AMOUNT_AFTER, (m, num: string, unit: string) => amount(m, num, unit));
  s = s.replace(AMOUNT_BEFORE, (m, unit: string, num: string) => amount(m, num, unit));
  for (const m of s.matchAll(NUMBER)) {
    const alts = numberValues(m[0]);
    f.numbers.push({ text: m[0], alts });
    alts.flat().forEach((v) => f.values.add(v));
  }
  // Dates and times are numbers too, for a source number the rewrite wrote as part of a date ("1." -> "1. 3.").
  for (const d of f.dates) { f.values.add(String(d.d)); f.values.add(String(d.m)); if (d.y) f.values.add(String(d.y)); }
  for (const t of f.times) t.value.split(":").forEach((v) => f.values.add(canon(v)));
  return f;
}

/** A name survives in `words` as itself or with a different ending (Czech cases: "Benešov" / "Benešově"). */
function hasName(name: string, words: readonly string[]): boolean {
  if (words.includes(name)) return true;
  const len = [...name].length;
  if (len < 5) return false;
  const need = Math.max(4, len - 3);
  return words.some((w) => {
    const a = [...w];
    const b = [...name];
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i >= need && Math.abs(a.length - b.length) <= 3;
  });
}

/** The facts of `source` that `rewrite` lost or changed, in the source's order of kinds (numbers first). */
export function missingFacts(source: string, rewrite: string): Fact[] {
  const src = factsOf(source);
  const out = factsOf(rewrite);
  const lost: Fact[] = [];
  const someAlt = (alts: string[][], has: (v: string) => boolean) => alts.some((alt) => alt.every(has));

  for (const a of src.amounts) {
    const ok = out.amounts.some((b) => b.unit === a.unit && a.alts.some((alt) => alt.length === 1 && b.alts.some((bb) => bb.includes(alt[0] as string))));
    if (!ok) lost.push({ kind: a.unit === "%" ? "number" : "amount", text: a.text });
  }
  for (const n of src.numbers) if (!someAlt(n.alts, (v) => out.values.has(v))) lost.push({ kind: "number", text: n.text });
  for (const t of src.times) if (!out.times.some((x) => x.value === t.value)) lost.push({ kind: "number", text: t.text });
  for (const d of src.dates) {
    const ok = out.dates.some((x) => x.d === d.d && x.m === d.m && (d.y === undefined || x.y === d.y));
    if (!ok) lost.push({ kind: "date", text: d.text });
  }
  for (const l of src.links) if (!out.links.some((x) => x.value === l.value)) lost.push({ kind: "link", text: l.text });
  for (const n of src.names) if (!hasName(n.value, out.words)) lost.push({ kind: "name", text: n.text });
  return lost;
}

/** True when `rewrite` keeps every fact token of `source`. */
export function keepsFacts(source: string, rewrite: string): boolean {
  return missingFacts(source, rewrite).length === 0;
}

// ---- Not plainer (r4-03) -----------------------------------------------------------------------------------------
//
// The real run of 2026-11-23 (gemini-3.5-flash-lite, Deník in Czech) answered every block with a near copy of it that
// carried misspellings the page never had ("který" -> "kter½", "tisíc" -> "tísíc", "mají" -> "mávají", "není" ->
// "nensí"), and the facts check let all 17 through. Such a "rewrite" is not plainer and is worse than the page: it
// stays as written. A near copy that only swaps a hard word for an easy one, or changes an ending (a Czech case), passes.

/** A rewrite whose words are at least this similar to the source's (in order) is a near copy of it. */
export const NEAR_COPY = 0.8;
/** Symbols a rewrite may not bring in when its source has none of them (a fraction sign inside a word, a private-use
 *  glyph, the replacement character): broken text, not plain words. */
const ODD = /[\p{No}\p{So}\p{Co}�]/gu;

const wordsOf = (s: string): string[] => (tidy(s).toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []);

/** `w` is `s` misspelled: a letter or two changed, added or dropped inside the word, its start and its end the same
 *  ("tisíc" -> "tísíc", "mají" -> "mávají"). A changed ending is grammar, not a misspelling ("lidé" -> "lidí"). */
export function misspelled(s: string, w: string): boolean {
  if (s === w || s.length < 3 || w.length < 3 || /\p{N}/u.test(s + w)) return false;
  const a = [...s];
  const b = [...w];
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return p >= 1 && q >= 1 && a.length - p - q <= 2 && b.length - p - q <= 2;
}

/** How alike two texts' words are, in order (2 * LCS / (n + m), 0 to 1), and how many words of `b` are words of `a`
 *  misspelled (an unmatched word of `b` against the unmatched words of `a` between the same matched words). */
export function compareWords(a: string, b: string): { similarity: number; misspellings: number } {
  const x = wordsOf(a);
  const y = wordsOf(b);
  if (!x.length && !y.length) return { similarity: 1, misspellings: 0 };
  const L: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      L[i]![j] = x[i] === y[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    }
  }
  let misspellings = 0;
  let gapA: string[] = [];
  let gapB: string[] = [];
  const close = () => { for (const w of gapB) if (gapA.some((s) => misspelled(s, w))) misspellings++; gapA = []; gapB = []; };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { close(); i++; j++; }
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) gapA.push(x[i++] as string);
    else gapB.push(y[j++] as string);
  }
  gapA.push(...x.slice(i));
  gapB.push(...y.slice(j));
  close();
  return { similarity: (2 * L[0]![0]!) / (x.length + y.length), misspellings };
}

/** Why a rewrite that kept its facts is still no use, or null: "same" (the block unchanged: nothing to show), "odd"
 *  (symbols its source does not have) or "misspelled" (a near copy that misspells the source's words). */
export function notPlainer(source: string, rewrite: string): "same" | "odd" | "misspelled" | null {
  if (tidy(source).replace(/\s+/g, " ").trim() === tidy(rewrite).replace(/\s+/g, " ").trim()) return "same";
  const had = new Set(source.match(ODD) ?? []);
  if ((rewrite.match(ODD) ?? []).some((c) => !had.has(c))) return "odd";
  const c = compareWords(source, rewrite);
  if (c.similarity >= NEAR_COPY && c.misspellings > 0) return "misspelled";
  return null;
}

/**
 * The door for a plain-words answer ({blocks: [{id, text}]}, schemas.translate's shape): the translation door first,
 * then every fact kept (missingFacts), then plainer than the source (notPlainer). A block the model returned unchanged
 * is left alone and not counted; a near copy that misspells it, or one with odd symbols, is refused and counted in
 * `dropped`.
 */
export function parsePlain(answer: unknown, source: readonly TranslateBlock[]): PlainResult {
  const t = parseTranslation(answer, source);
  const src = new Map(source.map((b) => [b.id, b.text]));
  const blocks: TranslateBlock[] = [];
  const lostKinds: FactKind[] = [];
  const lostIds: string[] = [];
  let dropped = t.dropped;
  for (const b of t.blocks) {
    const from = src.get(b.id) ?? "";
    const lost = missingFacts(from, b.text);
    if (lost.length) { lostKinds.push((lost[0] as Fact).kind); lostIds.push(b.id); continue; }
    const no = notPlainer(from, b.text);
    if (no === "same") continue;
    if (no) { dropped++; continue; }
    blocks.push(b);
  }
  return { blocks, lostFacts: lostKinds.length, lostKinds, lostIds, dropped };
}
