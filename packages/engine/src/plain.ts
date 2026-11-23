// Spark universal-core round 2, card 4: plain words in place (the existing task simplifyBlocks on the caption's text
// blocks). A rewrite must keep the facts: every number, date, amount and name of the source block. One that drops or
// changes one is refused and its block stays as written. STUB (contract commit): the round-2 builder fills it.
import type { TranslateBlock } from "./translate.js";

export interface PlainResult {
  /** Rewrites that passed, in the source's order. */
  blocks: TranslateBlock[];
  /** Refused because a number, date, amount or name of the source is missing or changed. */
  lostFacts: number;
  /** Refused for any other reason (unknown id, no text, HTML only, far too long). */
  dropped: number;
}

/** True when `rewrite` keeps every fact token of `source`. */
export function keepsFacts(_source: string, _rewrite: string): boolean {
  return true;
}

/** The door for a plain-words answer ({blocks: [{id, text}]}, schemas.translate's shape). */
export function parsePlain(_answer: unknown, _source: readonly TranslateBlock[]): PlainResult {
  return { blocks: [], lostFacts: 0, dropped: 0 };
}
