// Spark universal-core round 2, card 2: one claim checked on the web (task checkClaim, cloud, grounded in Google
// Search). The answer is untrusted: a closed set of verdicts, plain text, and sources accepted only when they are
// among the search results the service itself returned (grounding metadata), never a link the model wrote.
// STUB (contract commit): the round-2 builder fills it.

export type ClaimVerdict = "supported" | "disputed" | "mixed" | "notFound";
export const CLAIM_VERDICTS: readonly ClaimVerdict[] = ["supported", "disputed", "mixed", "notFound"];

/** A web page the search behind a check used (from the response's grounding metadata). */
export interface CheckSource { title: string; url: string }

export interface ClaimCheck {
  claimId: string;
  verdict: ClaimVerdict;
  /** One plain sentence, at most about 240 characters. */
  reason: string;
  /** Sources that passed: https only, among `grounding`, at most 5. */
  sources: CheckSource[];
}

export interface CheckResult {
  check: ClaimCheck | null;
  /** Things refused: an unknown verdict, a source not in the search results, HTML. */
  dropped: number;
}

/** The door for checkClaim's answer. `grounding`: the sources the service reported for this answer. */
export function parseCheck(_answer: unknown, _grounding: readonly CheckSource[], _claimId: string): CheckResult {
  return { check: null, dropped: 0 };
}
