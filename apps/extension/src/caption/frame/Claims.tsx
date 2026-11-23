// Spark universal-core round 2, card 1 (and card 10's gist next door in Gist.tsx): the claims of the article worth
// checking, found on the device right after Clean. Each claim row hosts the web check (ClaimCheck.tsx, card 2).
// STUB (contract commit): the round-2 builder fills it.
import type { Claim } from "@distill/engine";
import type { CleanReport } from "../../messages";

export interface ClaimsState {
  /** "idle" until the report is in; "none" when the page has nothing to check or is not an article. */
  phase: "idle" | "finding" | "ready" | "none" | "failed";
  claims: Claim[];
  /** Refused by the door (parseClaims), shown on screen. */
  dropped: number;
}

/** Finds the claims once the report is in. The strip's status line reads `claims.length`. */
export function useClaims(_report: CleanReport | null): ClaimsState {
  return { phase: "idle", claims: [], dropped: 0 };
}

/** The claims in More: each with Show me and its web check. */
export function ClaimsSection(_props: { report: CleanReport; claims: ClaimsState }) {
  return null;
}
