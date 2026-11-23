// Spark universal-core round 2, card 7: where a link goes, read from the link alone (no request is ever made).
// STUB (contract commit): the round-2 builder fills it.

export interface LinkNote {
  /** The host as a person reads it ("praslavice.cz"), after unwrapping a known redirector. */
  site: string;
  /** The link leaves the page's site (registrable domain differs). */
  leaves: boolean;
  /** "PDF", "DOCX", "ZIP" ... when the address names a file type. */
  fileType?: string;
  /** The real target when the link goes through a redirector (google.com/url?q=, l.facebook.com, ...). */
  unwrapped?: string;
  /** The address without tracking tags (utm_*, fbclid, gclid, ...), when it had any. */
  clean?: string;
  /** Names of the tracking tags taken out. */
  tracking: string[];
  /** mailto:, tel:, javascript: or a same-page #anchor: no note needed. */
  kind: "web" | "mail" | "phone" | "anchor" | "script" | "other";
}

/** What a link is, from its href and the page's address. */
export function describeLink(href: string, _pageUrl: string): LinkNote {
  return { site: "", leaves: false, tracking: [], kind: /^mailto:/i.test(href) ? "mail" : /^tel:/i.test(href) ? "phone" : "other" };
}
