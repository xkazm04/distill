// Round 3, card 7 (r3-07): prices and dates in your terms, added beside the page's words in the main text (the words
// stay; off and Original remove the additions). CONTRACT STUB: the r3-07 builder fills it in.
import type { ContentRequest } from "../messages";
import type { CleanContext } from "./context";

type TermsRequest = Extract<ContentRequest, { type: "distill:caption:terms" }>;

export function setTerms(_ctx: CleanContext, _req: TermsRequest): { prices: number; dates: number } {
  return { prices: 0, dates: 0 };
}
