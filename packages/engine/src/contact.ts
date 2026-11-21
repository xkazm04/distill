// Contact details on a page (spark universal-core #5): phone numbers, e-mail addresses, street addresses, opening hours
// and a link to the contact page. Pure DOM reading like page.ts and clutter.ts: it reads the whole page, the parts Clean
// hid included, and never changes it. STUB: the round-1 builder fills it in.

export type ContactKind = "phone" | "email" | "address" | "hours" | "contactPage";

export interface FoundContact {
  /** `k0`, `k1`, ... in document order, stable within one call. */
  id: string;
  kind: ContactKind;
  /** As the person should see it: the number spaced as written, the hours as one line. */
  text: string;
  /** tel:, mailto: or the contact page's absolute address. Omitted for an address or hours. */
  href?: string;
}

export interface ContactOptions {
  /** The page's address, to make a contact page's link absolute. */
  url: string;
  /** Called once per item with the element it was found in. */
  onElement?: (id: string, el: Element) => void;
}

/** The ways to reach whoever runs the page, each once, in document order. */
export function findContacts(doc: Document, opts: ContactOptions): FoundContact[] {
  void doc; void opts;
  return [];
}
