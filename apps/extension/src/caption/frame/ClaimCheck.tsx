// Spark universal-core round 2, card 2: a claim checked on the web (task checkClaim, cloud, Google Search grounding).
// Rendered by Claims.tsx inside each claim row. STUB (contract commit): the round-2 builder fills it.
import type { Claim, ClaimCheck as Check } from "@distill/engine";

/** The verdicts so far, by claim id, and the switch "check the top claims by themselves". */
export interface ChecksState {
  checks: Record<string, Check | "checking" | "failed">;
  /** The person agreed to checks that send sentences to Google (asked once). */
  consent: boolean;
  auto: boolean;
}

export type Checks = ChecksState & { check(claim: Claim): void; checkAll(): void; setAuto(on: boolean): void };

/** Runs the automatic checks of the top claims (after consent) and offers check(claim) for a click. */
export function useChecks(_claims: readonly Claim[]): Checks {
  return { checks: {}, consent: false, auto: false, check: () => undefined, checkAll: () => undefined, setAuto: () => undefined };
}

/** One claim's Check button, then its verdict, reason and sources. */
export function ClaimCheck(_props: { claim: Claim; checks: Checks }) {
  return null;
}
