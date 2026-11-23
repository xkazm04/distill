// Round 3, card 9 (r3-09): what this page asks of you. Deadlines, sums to pay (with the account number), what to bring,
// how to reach someone and opening hours, found in the main text by patterns (no AI). Pure: text in, items out.
// CONTRACT STUB: the r3-09 builder fills it in.

export const ACTION_KINDS = ["deadline", "payment", "bring", "contact", "hours"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface FoundAction {
  /** `a0`, `a1`, ... in reading order. */
  id: string;
  kind: ActionKind;
  /** As shown in More: "Pay 500 Kč to 123456789/0100 by 15 March". Page words, never anything the person typed. */
  text: string;
  /** The main-text block it was found in, and the exact words there (what Show me highlights). */
  blockId: string;
  quote: string;
  /** tel:, mailto: for a contact. */
  href?: string;
}

/** Items in reading order, at most one per quote. `lang` is the page's language ("cs", "en", ...). */
export function findActions(_blocks: readonly { id: string; text: string }[], _lang: string): FoundAction[] {
  return [];
}
