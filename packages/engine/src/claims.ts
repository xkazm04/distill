// Spark universal-core round 2, card 1: the claims of an article worth checking. Two steps: a fast engine pass picks
// candidate sentences (numbers, dates, quotes, "according to", named studies), then the on-device model keeps the ones
// worth checking (task findClaims). Its answer is untrusted and passes parseClaims: only candidates the engine offered.
import { isObj } from "./sanitize.js";
import type { TranslateBlock } from "./translate.js";

/** Why a sentence is checkable. Closed vocabulary: anything else from a model is dropped. */
export type ClaimWhy = "number" | "date" | "quote" | "source" | "cause";
export const CLAIM_WHY: readonly ClaimWhy[] = ["number", "date", "quote", "source", "cause"];

/** A sentence of the main text that states something checkable. Page text only, never a person's values. */
export interface Claim {
  /** `c0`, `c1`, ... in document order, stable for one page. */
  id: string;
  /** The block (TextBlock id, "t3") the sentence is in. */
  blockId: string;
  /** The sentence exactly as the page has it (whitespace collapsed). */
  text: string;
  why: ClaimWhy;
}

/** The model keeps at most this many (the prompt asks for 12); more are counted as dropped. */
export const MAX_CLAIMS = 12;
/** Shorter sentences say too little to check ("Podle ČTK."). */
const MIN_CHARS = 40;
const MIN_WORDS = 6;
/** Longer "sentences" are a list or a run-on the splitter could not cut: not one claim. */
const MAX_CHARS = 420;

// ---- sentences ---------------------------------------------------------------------------------------------------

/** Words that end with a full stop without ending the sentence (Czech and English, lower case, no dot). */
const ABBREV = new Set([
  // Czech
  "např", "tzv", "tj", "resp", "atd", "apod", "mj", "mil", "mld", "tis", "kč", "č", "s", "r", "o", "p", "sv", "st", "ing",
  "mgr", "mudr", "judr", "phdr", "rndr", "doc", "prof", "bc", "csc", "ph", "dr", "zast", "min", "max", "cca", "hod",
  "odst", "písm", "str", "ul", "nám", "tř", "pozn", "srov", "viz", "roč", "vyd", "angl", "lat", "př", "n", "l",
  // English
  "mr", "mrs", "ms", "jr", "sr", "vs", "etc", "e.g", "i.e", "no", "fig", "inc", "ltd", "co", "corp", "gov", "approx",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "u.s", "u.k", "dept", "est",
]);

/** The sentences of `text`, each exactly as the text has it (so the page side can find it again). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  // A sentence ends at . ! ? or … (with closing quotes or brackets), then space, then what starts a sentence.
  const end = /[.!?…]+["'“”»«„)\]]*\s+(?=["'„“«(\[]?[\p{Lu}\p{N}])/gu;
  let start = 0;
  for (let m = end.exec(text); m; m = end.exec(text)) {
    const cut = m.index + m[0].trimEnd().length;
    const before = text.slice(start, m.index + 1);
    const word = /([\p{L}.]+)\.$/u.exec(before)?.[1]?.toLowerCase() ?? "";
    // "např. Praha", "J. Novák", "25. 11. 2026", "1. března" (an abbreviation, an initial, a day or an ordinal) do not
    // end a sentence.
    if (m[0].startsWith(".")) {
      if (ABBREV.has(word) || /(?:^|[\s(])\p{Lu}\.$/u.test(before)) continue;
      if (/(?:^|[\s(])\d{1,2}\.$/u.test(before)) continue;
    }
    out.push(text.slice(start, cut).trim());
    start = m.index + m[0].length;
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out.filter(Boolean);
}

// ---- what makes a sentence checkable -----------------------------------------------------------------------------

const MONTHS = [
  // Czech, every case a date takes ("1. ledna", "v lednu", "leden")
  "led(?:en|na|nu)", "únor(?:a|u)?", "břez(?:en|na|nu)", "dub(?:en|na|nu)", "květ(?:en|na|nu)", "červen(?:ec|ce|ci|a|u)?",
  "srp(?:en|na|nu)", "září", "říj(?:en|na|nu)", "listopad(?:u)?", "prosin(?:ec|ce|ci)",
  // English
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
].join("|");

/** A word boundary that knows Unicode letters (JavaScript's own `\b` knows only ASCII: it misses the start of "řekl"). */
const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;
const words = (src: string, flags = "iu"): RegExp => new RegExp(src.replace(/<B>/g, B).replace(/<E>/g, E), flags);

const SIGNALS: { why: ClaimWhy; re: RegExp }[] = [
  // A source: "according to", "podle" + whom, a named study, survey, report or statistics office.
  { why: "source", re: words(String.raw`<B>(?:according to|cited by|citing|reported by|an? (?:new |recent )?(?:study|survey|report|analysis|poll)|the (?:study|survey|report|analysis|poll|data)|researchers?|scientists?|statistics office|census)<E>`) },
  { why: "source", re: words(String.raw`<B>(?:[Pp]odle|[Dd]le)\s+(?:\p{Lu}|nejnovější|nových|nové|posledních|údajů|dat|statisti|studie|průzkumu|výzkumu|analýzy|zprávy|odhadu|odborník|expert|ministerstva|úřadu|policie|serveru|agentury|webu|vědc)`, "u") },
  { why: "source", re: words(String.raw`<B>(?:studie|studii|průzkum|průzkumu|výzkum|výzkumu|analýza|analýzy|statistik[ay]?|ČSÚ|ČTK|OECD|Eurostat|ministerstv[oaue])<E>`) },
  // A quote: words in quotation marks. Without them, someone said, wrote or told: who said it is the source.
  { why: "quote", re: /[„“"«»][^„“"«»]{12,}[“”"«»]/u },
  { why: "source", re: words(String.raw`<B>(?:said|says|told|stated|wrote|announced|confirmed|řekl[ai]?|uvedl[ai]?|sdělil[ai]?|dodal[ai]?|napsal[ai]?|prohlásil[ai]?|uvádí|tvrdí|potvrdil[ai]?|oznámil[ai]?|upozornil[ai]?|varoval[ai]?)<E>`) },
  // A number with a unit, a share or an amount; or a plain number of two or more digits, or a decimal.
  { why: "number", re: words(String.raw`\d[\d\s.,]*\s?(?:%|‰|(?:procent|procenta|percent|per cent|kč|korun|eur|usd|dolar\p{L}*|milion\p{L}*|miliard\p{L}*|million|billion|trillion|tisíc|thousand|km|kg|lidí|people|let|years)<E>)`) },
  // A date: a year, a day and month, a numeric date, "in March" (before a bare number: "2025" is a year).
  { why: "date", re: words(String.raw`<B>(?:19|20)\d{2}<E>|<B>\d{1,2}\.\s?(?:${MONTHS})<E>|<B>(?:${MONTHS})\s+\d{1,2}<E>|<B>\d{1,2}\.\s?\d{1,2}\.\s?(?:19|20)\d{2}<E>|<B>(?:v|od|do|in|since|by)\s+(?:${MONTHS})<E>`) },
  { why: "number", re: words(String.raw`[$€£]\s?\d|<B>\d{2,}<E>|<B>\d+[.,]\d+<E>`) },
  // A claimed cause.
  { why: "cause", re: words(String.raw`<B>(?:because|due to|caused|causes|led to|leads to|as a result|resulted in|kvůli|protože|způsobil[aoy]?|způsobuje|vedl[aoy]? k|v důsledku|důsledkem|příčinou)<E>`) },
];

/** Contact lines ("Tel.: 549 211 296, info@obec.cz") are not claims. */
const CONTACT = words(String.raw`[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}|<B>(?:tel|telefon|fax|e-mail|email|phone)\.?:?\s*\+?\d`);

/** Why `sentence` is checkable, or null: the first signal it carries, in SIGNALS' order (a source before a number). */
export function claimWhy(sentence: string): ClaimWhy | null {
  const s = sentence.trim();
  if (s.length < MIN_CHARS || s.length > MAX_CHARS) return null;
  if ((s.match(/[\p{L}\p{N}]+/gu) ?? []).length < MIN_WORDS) return null;
  if (/\?["“”»]?$/.test(s)) return null; // a question claims nothing
  if (CONTACT.test(s)) return null;
  // Mostly figures (a score line, a timetable row): not a sentence of the article.
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  if (letters < s.length * 0.5) return null;
  for (const { why, re } of SIGNALS) if (re.test(s)) return why;
  return null;
}

/** Engine pass: candidate sentences of the main text, in document order, at most `max`. */
export function findClaimCandidates(blocks: readonly TranslateBlock[], max = 40): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    for (const text of splitSentences(b.text.replace(/\s+/g, " ").trim())) {
      if (out.length >= max) return out;
      const why = claimWhy(text);
      if (!why || seen.has(text)) continue;
      seen.add(text);
      out.push({ id: `c${out.length}`, blockId: b.id, text, why });
    }
  }
  return out;
}

export interface ClaimPick {
  /** Candidates the model kept, in document order (their `why` may be the model's, from the closed set). */
  claims: Claim[];
  /** Entries refused: an id not among the candidates, repeated, or a `why` outside CLAIM_WHY. */
  dropped: number;
}

/**
 * The door for findClaims' answer ({claims: [{id, why}]}, or a bare list). Keeps only ids of `candidates`, once each,
 * with a `why` from CLAIM_WHY, at most MAX_CLAIMS; the text always comes from the candidate, never from the model.
 * Everything refused is counted.
 */
export function parseClaims(answer: unknown, candidates: readonly Claim[]): ClaimPick {
  const list: unknown[] | null = Array.isArray(answer) ? answer : isObj(answer) && Array.isArray(answer.claims) ? answer.claims : null;
  if (!list) return { claims: [], dropped: answer === undefined || answer === null ? 0 : 1 };
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const kept = new Map<string, ClaimWhy>();
  let dropped = 0;
  for (const item of list) {
    const { id, why } = (isObj(item) ? item : {}) as { id?: unknown; why?: unknown };
    if (typeof id !== "string" || !byId.has(id) || kept.has(id) || typeof why !== "string" || !CLAIM_WHY.includes(why as ClaimWhy) || kept.size >= MAX_CLAIMS) {
      dropped++;
      continue;
    }
    kept.set(id, why as ClaimWhy);
  }
  const claims = candidates.filter((c) => kept.has(c.id)).map((c) => ({ ...c, why: kept.get(c.id) as ClaimWhy }));
  return { claims, dropped };
}
