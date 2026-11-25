// The script check (tiger 2026-11-25, S3): an answer in letters the form does not take is stopped before it is written,
// with one sentence in the reader's language. No model, pure, nothing leaves the device.
//
// Where the rule comes from: the FORM'S LANGUAGE. A form written in a Latin-script language (cs, sk, pl, de, ...) takes
// its free-text answers in Latin letters; a Cyrillic, Greek or Arabic answer typed into one is written, read back and
// counted as filled, then refused by the office (the PDF writer embeds Noto Sans, so Cyrillic is even drawn). A guide
// key was considered and left out: every guide is for a Czech form, so the form's language already says it, and a new
// guide key would be text a named person has to review. A label that asks for the original script ("v azbuce",
// "in original script") is exempt.
//
// Only text and textarea are checked: email, tel, number and date have their own formats, and a choice can only hold
// one of the form's own options.
import type { FieldStructure } from "./types.js";

/** Languages whose official forms are written in Latin letters. A form in any other language (or an unknown one) is
 *  never checked: the check only stops what it is sure of. */
export const LATIN_FORM_LANGS: readonly string[] = [
  "cs", "sk", "pl", "de", "en", "fr", "es", "it", "pt", "nl", "hu", "ro", "hr", "sl", "bs", "sq", "sv", "da", "no", "nb",
  "nn", "fi", "et", "lv", "lt", "is", "ga", "mt", "tr", "az", "vi", "id", "ms", "ca", "eu", "gl", "lb",
];

const CHECKED_KINDS: ReadonlySet<FieldStructure["kind"]> = new Set(["text", "textarea"]);

/** A label or hint that asks for the original script on purpose. */
const ORIGINAL_SCRIPT = /azbu|cyril|kyril|кирил|původním\s+písm|v\s+originál|original\s+script|native\s+script|in\s+cyrillic/i;

const SCRIPTS: readonly [name: string, re: RegExp][] = [
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Arabic", /\p{Script=Arabic}/u],
  ["Hebrew", /\p{Script=Hebrew}/u],
  ["Armenian", /\p{Script=Armenian}/u],
  ["Georgian", /\p{Script=Georgian}/u],
  ["Devanagari", /\p{Script=Devanagari}/u],
  ["Chinese", /\p{Script=Han}/u],
  ["Japanese", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["Korean", /\p{Script=Hangul}/u],
  ["Thai", /\p{Script=Thai}/u],
];

export interface ScriptProblem {
  /** The script found, in English ("Cyrillic"), or "another" when it has no name here. */
  script: string;
  /** The letters that are not Latin, each once, in the order typed. */
  letters: string;
  /** One sentence for the person, in the reader's language (en, or uk for a Ukrainian reader). */
  message: string;
}

const primary = (lang: string): string => (lang || "").toLowerCase().split(/[-_]/)[0] ?? "";

/** Whether answers to this form's free-text fields must be in Latin letters. */
export function formTakesLatin(formLang: string): boolean {
  return LATIN_FORM_LANGS.includes(primary(formLang));
}

function messageFor(script: string, readerLang: string): string {
  if (primary(readerLang) === "uk") {
    const what = script === "Cyrillic" ? "кирилицю" : "ці літери";
    return `Пишіть латинськими літерами (A–Z), як у вашому паспорті: ця форма не приймає ${what}.`;
  }
  const what = script === "another" ? "these letters" : `${script} letters`;
  return `Write this in Latin letters (A-Z), as in your passport: this form does not take ${what}.`;
}

/**
 * Null when the answer may be written; otherwise what is wrong, in one sentence. Latin letters with any accent
 * (ěščřžýáíéůú, äöüß, ąęł) are Latin. Digits, spaces, punctuation and symbols are never a problem.
 */
export function checkScript(
  field: Pick<FieldStructure, "kind" | "label"> & Partial<Pick<FieldStructure, "hint">>,
  formLang: string,
  value: string,
  readerLang = "en",
): ScriptProblem | null {
  if (!CHECKED_KINDS.has(field.kind) || !formTakesLatin(formLang) || !value) return null;
  if (ORIGINAL_SCRIPT.test(`${field.label} ${field.hint ?? ""}`)) return null;
  const foreign: string[] = [];
  for (const ch of value.normalize("NFC")) {
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch) && !foreign.includes(ch)) foreign.push(ch);
  }
  if (!foreign.length) return null;
  const first = foreign[0] as string;
  const script = SCRIPTS.find(([, re]) => re.test(first))?.[0] ?? "another";
  return { script, letters: foreign.join(""), message: messageFor(script, readerLang) };
}
