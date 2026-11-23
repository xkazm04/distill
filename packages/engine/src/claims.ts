// Spark universal-core round 2, card 1: the claims of an article worth checking. Two steps: a fast engine pass picks
// candidate sentences (numbers, dates, quotes, "according to", named studies), then the on-device model keeps the ones
// worth checking (task findClaims). Its answer is untrusted and passes parseClaims: only candidates the engine offered.
// STUB (contract commit): the round-2 builder fills it.
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

/** Engine pass: candidate sentences of the main text, in document order, at most `max`. */
export function findClaimCandidates(_blocks: readonly TranslateBlock[], _max = 40): Claim[] {
  return [];
}

export interface ClaimPick {
  /** Candidates the model kept, in document order (their `why` may be the model's, from the closed set). */
  claims: Claim[];
  /** Entries refused: an id not among the candidates, repeated, or a `why` outside CLAIM_WHY. */
  dropped: number;
}

/** The door for findClaims' answer ({claims: [{id, why}]}). */
export function parseClaims(_answer: unknown, _candidates: readonly Claim[]): ClaimPick {
  return { claims: [], dropped: 0 };
}
