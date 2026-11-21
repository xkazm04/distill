// #9 Ready to send?: how far the page's form is filled, and the next empty field. Uses the engine's form reader; it
// looks only at whether a field is filled, never at what is in it, and types nothing. STUB: owned by W3.
import type { FormProgress } from "../messages";

/** The page's main form (the largest shown), counted; null when the page has none. */
export function formProgress(doc: Document): FormProgress | null { void doc; return null; }
/** Scrolls to the next empty required field (else the next empty one), focuses it, and counts again. */
export function nextField(doc: Document): FormProgress | null { void doc; return null; }
