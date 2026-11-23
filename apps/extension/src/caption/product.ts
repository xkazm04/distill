// Round 4, card 7 (r4-07): a product page's facts (engine readProduct), and Show me for one. Page words only, read
// inside the browser: readProduct never reads a form field. Show me outlines the place a fact was read for a moment
// (contact.ts markOnPage), the same reversible outline every Show me of the strip uses.
import { readProduct, type ProductFacts } from "@distill/engine";
import { markOnPage } from "./contact";

const HIDE = "data-distill-hide";
const ORIGINAL = "data-distill-original";

/** Fact id -> where it was read, by the last readProductFacts. Never leaves the page. */
let where = new Map<string, Element>();

export function readProductFacts(doc: Document): ProductFacts | null {
  const next = new Map<string, Element>();
  const facts = readProduct(doc, { onElement: (id, el) => next.set(id, el) });
  where = next;
  return facts;
}

/** Scrolls to where fact `id` was read and outlines it. False when it was read from the data (no place to show), the
 *  place is gone, or Clean hid it (and the original is not shown). */
export function showProduct(doc: Document, id: string): boolean {
  const el = where.get(id);
  if (!el?.isConnected) return false;
  if (!doc.documentElement.hasAttribute(ORIGINAL) && el.closest(`[${HIDE}]`)) return false;
  markOnPage(doc, el);
  return true;
}

/** Forgets what was read (close). */
export function clearProduct(): void {
  where = new Map();
}
