// Round 3, card 4 (r3-04): a cookie banner answered for you. Where the banner offers a reject-all button (OneTrust,
// Didomi, Cookiebot, Quantcast, ... or a plain button whose words say so), press it once per site; never Accept.
// Without one the banner is only hidden, as Clean does today. CONTRACT STUB: the r3-04 builder fills it in.
import type { ConsentOutcome } from "../messages";

/** Switch on (answer banners) or off (hide only). Returns what happened on this page. */
export function setConsent(_doc: Document, on: boolean): ConsentOutcome {
  return on ? "none" : "off";
}
