// Round 4, card 5 (r4-05): explain this word. An abbreviation the page spells out itself is explained from the page
// (no AI); otherwise the on-device model explains it (task explainTerm, class values: which word the person chose says
// something about them, so it never goes to the cloud), and its answer passes this door (parseExplanation).
import { isObj } from "./sanitize.js";

/** The longest selection explained (characters); a longer one gets no Explain button. */
export const TERM_MAX = 80;
/** The longest explanation shown (characters); a longer one is cut at a word and ends with "...". */
export const EXPLANATION_MAX = 320;
/** The explanation is one or two sentences: anything after the second is left out. */
const EXPLANATION_SENTENCES = 2;
/** The longest spelled-out form taken from the page (characters). */
const LONG_MAX = 160;

/** The selected words as they may go into a prompt: one plain line, no control characters; "" when empty or longer
 *  than TERM_MAX (a selection that long is not a word to explain). */
export function cleanTerm(raw: string): string {
  const t = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()
    // Punctuation the selection caught at its ends: "OSVČ," "(OSVČ)" "„OSVČ“".
    .replace(/^[\s"'„“”‚‘’«»(\[{,.;:!?–—-]+|[\s"'„“”‚‘’«»)\]},.;:!?–—-]+$/gu, "");
  return t && t.length <= TERM_MAX && /[\p{L}\p{N}]/u.test(t) ? t : "";
}

/** One character as compared: lower case, without its accent ("Č" -> "c"), so "ČSSZ" matches "česká správa ...". */
const fold = (ch: string): string => ch.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().slice(0, 1) || ch.toLowerCase();
const isAlnum = (ch: string | undefined): boolean => !!ch && /[\p{L}\p{N}]/u.test(ch);
const isUpper = (ch: string): boolean => /\p{Lu}/u.test(ch);

/** An abbreviation: one word of 2 to 12 letters or digits (a hyphen or a dot allowed), at least two of them capitals,
 *  starting with a letter: "OSVČ", "DPH", "VAT", "ČSSZ", "EU", "SPZ", "eID"... */
export function isAbbreviation(term: string): boolean {
  if (!/^\p{L}[\p{L}\p{N}.&-]{1,11}$/u.test(term)) return false;
  return [...term].filter(isUpper).length >= 2;
}

/**
 * Whether `long` spells out `short`, and where its spelled-out form starts (Schwartz and Hearst, 2003): every letter
 * and digit of the abbreviation is found in order from the end of `long` backwards, the first one at the start of a
 * word. Returns the shortest such end of `long` ("the Czech value added tax" for "VAT" -> "value added tax"), or null.
 */
function longFormOf(short: string, long: string): string | null {
  const s = [...short];
  const l = [...long];
  let si = s.length - 1;
  let li = l.length - 1;
  while (si >= 0) {
    const ch = s[si] as string;
    if (!isAlnum(ch)) { si--; continue; }
    const c = fold(ch);
    while (li >= 0 && (fold(l[li] as string) !== c || (si === 0 && li > 0 && isAlnum(l[li - 1])))) li--;
    if (li < 0) return null;
    li--;
    si--;
  }
  // Back to the start of the word the first letter was found in.
  let start = li + 1;
  while (start > 0 && isAlnum(l[start - 1])) start--;
  const out = l.slice(start).join("").replace(/\s+/g, " ").trim();
  // The form must be words, not the abbreviation itself again, and not longer than an abbreviation can stand for.
  const words = out.split(" ").length;
  if (!out.includes(" ") || out.toLowerCase().includes(short.toLowerCase()) || words > Math.min(s.length + 5, s.length * 2) || out.length > LONG_MAX) return null;
  return out;
}

/** "dále jen „OSVČ“", "hereinafter referred to as "VAT"", "tzv. OSVČ" -> "OSVČ" (what a parenthesis names). */
function named(inside: string): string {
  return inside
    .replace(/^\s*(?:dále\s+(?:jen|též|také)|dále|tzv\.|tj\.|hereinafter(?:\s+referred\s+to\s+as)?|hereafter|henceforth|in\s+short|short|abbreviated|zkráceně|zkr\.)\s*/iu, "")
    .replace(/^[\s"'„“”‚‘’«»]+|[\s"'„“”‚‘’«»]+$/gu, "")
    .trim();
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "OSVČ" -> "osoba samostatně výdělečně činná" when `text` spells it out itself, in either order: "osoba samostatně
 * výdělečně činná (OSVČ)", "... činná (dále jen „OSVČ“)", or "OSVČ (osoba samostatně výdělečně činná)"; English the
 * same ("value added tax (VAT)", "VAT (value added tax)"). Null when `term` is not an abbreviation or the page does not
 * spell it out. Read from the page's own words only: nothing is guessed.
 */
export function spelledOut(text: string, term: string): string | null {
  const t = cleanTerm(term);
  if (!t || !isAbbreviation(t)) return null;
  const flat = text.replace(/\s+/g, " ");
  // The abbreviation as a word of its own (not inside a longer word), case as the page writes it.
  const at = new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}(?![\\p{L}\\p{N}])`, "gu");
  for (const m of flat.matchAll(at)) {
    const i = m.index ?? 0;
    // 1. "<long form> (OSVČ)" or "<long form> (dále jen „OSVČ“)": the parenthesis around the abbreviation.
    const open = flat.lastIndexOf("(", i);
    const close = flat.indexOf(")", i + t.length);
    if (open >= 0 && close > 0 && open > flat.lastIndexOf(")", i) && named(flat.slice(open + 1, close)) === t) {
      // The words just before the parenthesis, within the same sentence or clause.
      const before = flat.slice(Math.max(0, open - 400), open);
      const clause = before.split(/[.!?;:()\[\]]\s|[()\[\];:]/u).pop() ?? before;
      const long = longFormOf(t, clause.replace(/[\s,–—-]+$/u, ""));
      if (long) return long;
    }
    // 2. "OSVČ (osoba samostatně výdělečně činná)": the parenthesis right after the abbreviation.
    const after = /^\s*[(\[]([^()\[\]]{3,240})[)\]]/u.exec(flat.slice(i + t.length));
    if (after) {
      const inside = (after[1] as string).split(/[,;]|\s[–—-]\s/u)[0]?.replace(/^[\s"'„“”‚‘’«»]+|[\s"'„“”‚‘’«»]+$/gu, "") ?? "";
      const long = longFormOf(t, inside);
      // The whole inside must be the form (its first word starts it), not words that happen to hold the letters.
      if (long && inside.trim().replace(/\s+/g, " ").startsWith(long)) return long;
    }
  }
  return null;
}

export type ExplainResult = { kind: "explained"; text: string } | { kind: "refused"; why: "empty" | "invalid" };

/** Markup or an escaped "<": an explanation is plain text, so a tag is refused, never rendered or quietly cleaned. */
const TAG = /<\/?[a-z!?][^>]*>?|&(?:lt|gt|#0*60|#x0*3c);/i;
/** A link of any kind: an address, a markdown link, a bare domain with a path. */
const LINK = /\b(?:https?|ftp|file|data|javascript|mailto):|\bwww\.|\]\s*\(|\b[\w-]+\.(?:com|org|net|cz|sk|de|eu|io|gov|info)\/\S/i;
/** Control characters other than plain whitespace. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
/** Markdown that is not a link: headings, list marks, emphasis, code ticks. Left out, the words kept. */
const MARKDOWN = /^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)|\*\*|__|`+/gm;
/** What a model writes when it has nothing. */
const NOTHING = /^(?:n\/a|none|unknown|no explanation|i (?:do not|don't) know\b.*|not (?:known|sure|clear)|(?:the )?(?:term|word|text) (?:is )?(?:unknown|unclear))\.?$/i;

/** One or two sentences, at most EXPLANATION_MAX characters (cut at a word, ending in "..."). */
function cap(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'„“(])/u);
  let out = sentences.slice(0, EXPLANATION_SENTENCES).join(" ").trim() || text;
  if (out.length > EXPLANATION_MAX) {
    const cut = out.slice(0, EXPLANATION_MAX - 3);
    const space = cut.lastIndexOf(" ");
    out = `${(space > EXPLANATION_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}...`;
  }
  return out;
}

/**
 * The door for explainTerm's answer: {text} (schemas.explain) or a plain string. Plain text only: markup, a link or
 * control characters -> refused as invalid (never rendered, never quietly cleaned into something else); markdown
 * emphasis and list marks are left out. Nothing, or a model saying it does not know -> "empty". Kept to one or two
 * sentences and at most EXPLANATION_MAX characters.
 */
export function parseExplanation(raw: unknown): ExplainResult {
  if (raw === undefined || raw === null || raw === "") return { kind: "refused", why: "empty" };
  let text: unknown = raw;
  if (isObj(raw)) text = (raw as { text?: unknown }).text;
  if (text === undefined || text === null) return { kind: "refused", why: "empty" };
  if (typeof text !== "string") return { kind: "refused", why: "invalid" };
  if (CONTROL.test(text) || TAG.test(text) || LINK.test(text)) return { kind: "refused", why: "invalid" };
  const plain = text.replace(MARKDOWN, "").replace(/\s+/g, " ").trim();
  if (!plain || NOTHING.test(plain)) return { kind: "refused", why: "empty" };
  return { kind: "explained", text: cap(plain) };
}
