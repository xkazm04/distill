// Round 4, card 5 (r4-05): explain this word. An abbreviation the page spells out itself is explained from the page
// (no AI); otherwise the on-device model explains it (task explainTerm, class values: which word the person chose says
// something about them, so it never goes to the cloud), and its answer passes this door. CONTRACT STUB: the r4-05
// builder fills it in, with the prompt and the schema.

export const TERM_MAX = 80;
export const EXPLANATION_MAX = 320;

/** "OSVČ" -> "osoba samostatně výdělečně činná" when the text spells it out ("... činná (OSVČ)", "OSVČ (osoba ...)"). */
export function spelledOut(_text: string, _term: string): string | null {
  return null;
}

export type ExplainResult = { kind: "explained"; text: string } | { kind: "refused"; why: "empty" | "invalid" };

/** The door for explainTerm's answer: plain text, one or two sentences, at most EXPLANATION_MAX, no links or markup. */
export function parseExplanation(_raw: unknown): ExplainResult {
  return { kind: "refused", why: "invalid" };
}
