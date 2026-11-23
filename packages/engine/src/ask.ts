// Round 3, card 8 (r3-08): ask this page. The door for the on-device model's answer: it must quote a sentence that is
// really in the main text, or it is refused ("This page does not say"). The question is a typed value (task askPage,
// class values: device only, no cloud fallback; route.ts and apps/web/src/ai.ts enforce it).
import { findSentence } from "./gist.js";
import { isObj } from "./sanitize.js";

/** The longest question taken (characters); a longer one is cut here, before any prompt is built. */
export const QUESTION_MAX = 300;
/** The longest answer shown (characters); a longer one is cut at a word and ends with "...". */
export const ANSWER_MAX = 400;
/** The answer is one or two sentences: anything after the second is left out. */
export const ANSWER_SENTENCES = 2;

export interface PageAnswer { answer: string; blockId: string; sentence: string }

export type AnswerResult =
  | { kind: "answer"; answer: PageAnswer }
  | { kind: "refused"; why: "not-on-page" | "no-answer" | "invalid" };

/** Markup or an escaped "<": an answer is plain text, so a tag is refused, never rendered or quietly cleaned. */
const TAG = /<\/?[a-z!?][^>]*>?|&(?:lt|gt|#0*60|#x0*3c);/i;
/** Control characters other than plain whitespace. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
/** What a model writes when it has nothing: "the page does not say", "not mentioned", "unknown"... */
const NOTHING = /^(?:n\/a|none|unknown|no answer|not (?:stated|mentioned|said|given|found)|(?:the |this )?(?:page|text|article) does(?: not|n't) (?:say|mention|state)\b.*)\.?$/i;

/** The question as it may go into a prompt: one plain line, no control characters, at most QUESTION_MAX characters. */
export function cleanQuestion(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX).trim();
}

/** One or two sentences, at most ANSWER_MAX characters (cut at a word, ending in "..."). */
export function capAnswer(text: string): string {
  // A sentence ends at . ! or ? followed by a space and a capital or a digit (so "9 a.m. on weekdays" stays whole).
  const sentences = text.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'„“(])/u);
  let out = sentences.slice(0, ANSWER_SENTENCES).join(" ").trim() || text;
  if (out.length > ANSWER_MAX) {
    const cut = out.slice(0, ANSWER_MAX - 3);
    const space = cut.lastIndexOf(" ");
    out = `${(space > ANSWER_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}...`;
  }
  return out;
}

/**
 * The door for askPage's answer ({answer, blockId, sentence}). The answer is plain text (markup or control characters:
 * refused as invalid), capped to two sentences and ANSWER_MAX characters. An empty answer, or one that only says the
 * page does not say, is "no-answer". The sentence must be found (findSentence) in the named block, or, when the model
 * named no block or a wrong one, in any block of the main text; otherwise "not-on-page". The sentence kept is the
 * page's own, so Show me finds it. Either refusal is shown as "This page does not say".
 */
export function parseAnswer(raw: unknown, blocks: readonly { id: string; text: string }[]): AnswerResult {
  if (raw === undefined || raw === null || raw === "") return { kind: "refused", why: "no-answer" };
  if (!isObj(raw)) return { kind: "refused", why: "invalid" };
  const { answer, blockId, sentence } = raw as { answer?: unknown; blockId?: unknown; sentence?: unknown };
  if (answer !== undefined && typeof answer !== "string") return { kind: "refused", why: "invalid" };
  const plain = (answer ?? "").replace(/\s+/g, " ").trim();
  if (!plain || NOTHING.test(plain)) return { kind: "refused", why: "no-answer" };
  if (TAG.test(plain) || CONTROL.test(answer as string)) return { kind: "refused", why: "invalid" };
  if (typeof sentence !== "string" || !sentence.trim()) return { kind: "refused", why: "not-on-page" };
  if (blockId !== undefined && typeof blockId !== "string") return { kind: "refused", why: "invalid" };

  const named = typeof blockId === "string" ? blocks.find((b) => b.id === blockId) : undefined;
  const order = named ? [named, ...blocks.filter((b) => b !== named)] : blocks;
  for (const b of order) {
    const found = findSentence(b.text, sentence);
    if (found) return { kind: "answer", answer: { answer: capAnswer(plain), blockId: b.id, sentence: found } };
  }
  return { kind: "refused", why: "not-on-page" };
}
