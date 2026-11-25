// Is a guide's official quote really in the published instructions? The mechanical half of a guide review
// (guides/README.md, "Is every official.text word for word as published?"): `npm run guides:review` and
// `npm run guides:drift` read the instructions into blocks and ask this. A found quote proves only that the words exist
// in the source, never that a step's explanation agrees with them: that stays a person's judgement.
import { findSentence } from "./gist.js";
import type { TranslateBlock } from "./translate.js";

/** What the source says about one quote. `unreadable` (the source could not be read, or holds no text) is never found. */
export type QuoteVerdict =
  | {
      verdict: "found";
      /** The block the quote starts in. */
      blockId: string;
      /** Set when the quote runs on into the next block (a sentence a PDF split across two blocks). */
      nextBlockId?: string;
      /** The quote exactly as the source writes it. */
      sentence: string;
      /** The paragraph around it (the block, or both blocks), shortened around the quote when long. */
      context: string;
    }
  | { verdict: "not_found" }
  | { verdict: "unreadable" };

/** The most context shown around a found quote. */
export const QUOTE_CONTEXT_MAX = 900;

function around(text: string, sentence: string): string {
  if (text.length <= QUOTE_CONTEXT_MAX) return text;
  const at = Math.max(0, text.indexOf(sentence));
  const room = Math.max(0, QUOTE_CONTEXT_MAX - sentence.length);
  let from = Math.max(0, at - Math.floor(room / 2));
  const to = Math.min(text.length, from + Math.max(sentence.length, QUOTE_CONTEXT_MAX));
  from = Math.max(0, to - Math.max(sentence.length, QUOTE_CONTEXT_MAX));
  return `${from > 0 ? "..." : ""}${text.slice(from, to)}${to < text.length ? "..." : ""}`;
}

/**
 * One verdict per quote, in order. `blocks` is the source read into blocks (null when it could not be read). Each
 * quote is looked for block by block, then in each pair of neighbouring blocks joined by a space, through findSentence:
 * curly and straight quotes, dashes and runs of spaces count as the same, every word must be there in order. A
 * paraphrase is not found.
 */
export function verifyQuotes(blocks: readonly TranslateBlock[] | null, quotes: readonly string[]): QuoteVerdict[] {
  const list = (blocks ?? []).filter((b) => b.text.trim());
  if (!list.length) return quotes.map(() => ({ verdict: "unreadable" as const }));
  return quotes.map((q): QuoteVerdict => {
    for (const b of list) {
      const sentence = findSentence(b.text, q);
      if (sentence) return { verdict: "found", blockId: b.id, sentence, context: around(b.text, sentence) };
    }
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i] as TranslateBlock;
      const b = list[i + 1] as TranslateBlock;
      const joined = `${a.text} ${b.text}`;
      const sentence = findSentence(joined, q);
      if (sentence) return { verdict: "found", blockId: a.id, nextBlockId: b.id, sentence, context: around(joined, sentence) };
    }
    return { verdict: "not_found" };
  });
}
