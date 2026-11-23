// Round 4, card 7 (r4-07): a product page's facts in one card. Reads the page's structured data (schema.org Product and
// Offer) first, then its tables and labels. Pure reading, nothing fetched. CONTRACT STUB: the r4-07 builder fills it in.

export const PRODUCT_FACTS = ["price", "oldPrice", "stock", "delivery", "warranty", "returns", "spec"] as const;
export type ProductFactKind = (typeof PRODUCT_FACTS)[number];

export interface ProductFact {
  /** `p0`, `p1`, ... in card order. */
  id: string;
  kind: ProductFactKind;
  /** The label as shown ("Záruka", or the spec's own name). */
  label: string;
  /** The page's own words for the value. */
  value: string;
  /** Where it was read: structured data (no place on the page to show) or a place on the page (Show me). */
  from: "data" | "page";
}

export interface ProductFacts { name?: string; facts: ProductFact[] }

/** Null when the page is not a product page. */
export function readProduct(_doc: Document): ProductFacts | null {
  return null;
}
