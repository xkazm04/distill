// Spark universal-core round 2, cards 1, 2 and 10, the page side: claim marks in the main text and "Show me".
// Every mark is reversible (data-distill-* only); Original and close take them off. STUB (contract commit).
import type { ClaimMark } from "../messages";

/** Underlines the claims' sentences in their blocks; replaces earlier marks. Returns how many were found and marked. */
export function markClaims(_doc: Document, _claims: readonly ClaimMark[]): number {
  return 0;
}

/** Scrolls to `sentence` in block `blockId` and highlights it for a moment. False when it is not on the page. */
export function showText(_doc: Document, _blockId: string, _sentence: string): boolean {
  return false;
}

/** Takes every claim mark off. */
export function clearClaims(_doc: Document): void {}
