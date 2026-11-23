// Contact details on a page (spark universal-core #5): phone numbers, e-mail addresses, street addresses, opening hours
// and a link to the contact page. Pure DOM reading like page.ts and clutter.ts: it reads the whole page, the parts Clean
// hid included, and never changes it. It reads the page's own text only: never a form control, never an editable area
// (what a person typed is not the page's contact).
import { detectLang } from "./lang.js";

export type ContactKind = "phone" | "email" | "address" | "hours" | "contactPage";

export interface FoundContact {
  /** `k0`, `k1`, ... in the order returned (phones and e-mails first), stable within one call. */
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

/** At most this many of each kind, and of all together. Phones and e-mails come first. */
const CAP: Record<ContactKind, number> = { phone: 3, email: 3, address: 2, hours: 2, contactPage: 1 };
const MAX_ITEMS = 8;
const ORDER: ContactKind[] = ["phone", "email", "address", "hours", "contactPage"];
/** Read at most this much of the page's text (a huge page's contacts are in its first and last parts anyway). */
const MAX_TEXT = 400_000;

interface Found { kind: ContactKind; text: string; href?: string; key: string; el: Element | null; at: number }

/** The ways to reach whoever runs the page, each once: phones and e-mails first, each kind in document order. */
export function findContacts(doc: Document, opts: ContactOptions): FoundContact[] {
  const root = doc.body ?? doc.documentElement;
  if (!root) return [];
  const found: Found[] = [];
  const seen = new Set<string>();
  const add = (f: Found) => {
    const k = `${f.kind}:${f.key}`;
    if (seen.has(k)) return;
    seen.add(k);
    found.push(f);
  };
  const order = docOrder(root);
  const isCz = (): boolean => czech(opts.url, doc);
  const lines = readLines(root);
  /** The lines that hold a phone: an address without a postcode is trusted next to one (see streetAddresses). */
  const phoneLines = new Set<number>();
  let lineOfNode: Map<Node, number> | null = null;
  const lineOf = (el: Element): number => {
    if (!lineOfNode) {
      lineOfNode = new Map();
      lines.forEach((l, i) => { for (const p of l.parts) lineOfNode?.set(p.node, i); });
    }
    const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = lineOfNode.get(n);
      if (i !== undefined) return i;
    }
    return -1;
  };

  // Links say it best: tel: and mailto: first.
  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    if (skipped(a)) continue;
    const href = (a.getAttribute("href") ?? "").trim();
    const scheme = href.slice(0, 7).toLowerCase();
    if (scheme.startsWith("tel:")) {
      const raw = safeDecode(href.slice(4)).replace(/[^\d+]/g, "");
      const shown = collapse(a.textContent ?? "");
      const p = phoneOf(digits(shown).length >= 7 ? shown : raw, "tel", isCz);
      if (p) {
        add({ ...p, el: a, at: order(a) });
        phoneLines.add(lineOf(a));
      }
    } else if (scheme === "mailto:") {
      const addr = safeDecode(href.slice(7).split("?")[0] ?? "").trim();
      if (EMAIL_ONLY.test(addr)) add({ kind: "email", text: addr, href: `mailto:${addr}`, key: addr.toLowerCase(), el: a, at: order(a) });
    }
  }

  for (const [li, line] of lines.entries()) {
    for (const m of line.text.matchAll(PHONE_RE)) {
      // Two numbers written as one run ("377 912 345 / 777 123 456"): when the whole is no number, try its pieces.
      for (const [piece, at] of pieces(m[0], m.index ?? 0, (t, i) => !!phoneOf(t, phoneContext(line.text, i, t.length), isCz))) {
        const p = phoneOf(piece, phoneContext(line.text, at, piece.length), isCz);
        if (p) {
          add({ ...p, ...placeOf(line, at, piece.length, order) });
          phoneLines.add(li);
        }
      }
    }
    for (const m of line.text.matchAll(EMAIL_RE)) {
      const at = m.index ?? 0;
      const addr = `${m[1]}@${(m[2] ?? "").replace(DOT_WORD, ".")}`.replace(/\s+/g, "");
      if (!EMAIL_ONLY.test(addr)) continue;
      add({ kind: "email", text: addr, href: `mailto:${addr}`, key: addr.toLowerCase(), ...placeOf(line, at, m[0].length, order) });
    }
  }

  // schema.org in JSON-LD: a phone or an e-mail the page does not show as text.
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    const json = s.textContent ?? "";
    for (const t of jsonLd(json, "telephone").flat()) {
      const p = typeof t === "string" ? phoneOf(t, "tel", isCz) : null;
      if (p) add({ ...p, el: null, at: Number.MAX_SAFE_INTEGER });
    }
    for (const e of jsonLd(json, "email").flat()) {
      const addr = typeof e === "string" ? e.replace(/^mailto:/i, "").trim() : "";
      if (EMAIL_ONLY.test(addr)) add({ kind: "email", text: addr, href: `mailto:${addr}`, key: addr.toLowerCase(), el: null, at: Number.MAX_SAFE_INTEGER });
    }
  }

  for (const a of addresses(root, lines, order)) add(a);
  for (const a of streetAddresses(lines, phoneLines, order)) add(a);
  for (const h of hours(root, lines, order)) add(h);
  const page = contactPage(root, opts.url, order);
  if (page) add(page);

  const out: Found[] = [];
  for (const kind of ORDER) out.push(...found.filter((f) => f.kind === kind).sort((a, b) => a.at - b.at).slice(0, CAP[kind]));
  return out.slice(0, MAX_ITEMS).map((f, i) => {
    const id = `k${i}`;
    if (f.el) opts.onElement?.(id, f.el);
    const item: FoundContact = { id, kind: f.kind, text: f.text };
    if (f.href) item.href = f.href;
    return item;
  });
}

// ---- reading the page's text as lines ----

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "canvas", "object", "embed", "head", "iframe",
  "input", "select", "option", "textarea", "button", "distill-caption"]);
/** Elements that end a line. A table row's cells and a term with its description stay on one line. */
const BREAKS = new Set(["address", "article", "aside", "blockquote", "div", "dl", "dt", "figcaption", "figure", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
  "tbody", "thead", "tfoot", "tr", "ul", "center", "font-block", "br", "marquee", "caption", "fieldset", "legend"]);

interface Line { text: string; parts: { node: Text; start: number }[] }

/** Not the page's own visible text: a control, an editable area, something hidden in its markup. */
function skipped(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (SKIP.has(e.localName.toLowerCase())) return true;
    if (e.hasAttribute("hidden") || e.getAttribute("aria-hidden") === "true") return true;
    if (e.hasAttribute("contenteditable") && e.getAttribute("contenteditable") !== "false") return true;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(e.getAttribute("style") ?? "")) return true;
  }
  return false;
}

function readLines(root: Element): Line[] {
  const lines: Line[] = [];
  let cur: Line = { text: "", parts: [] };
  let total = 0;
  const flush = () => {
    if (cur.text.trim()) lines.push(cur);
    cur = { text: "", parts: [] };
  };
  const walk = (node: Node): void => {
    if (total > MAX_TEXT) return;
    if (node.nodeType === 3) {
      const t = (node as Text).data;
      if (!t) return;
      cur.parts.push({ node: node as Text, start: cur.text.length });
      cur.text += t;
      total += t.length;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const name = el.localName.toLowerCase();
    if (SKIP.has(name) || el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return;
    if (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false") return;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute("style") ?? "")) return;
    const breaks = BREAKS.has(name);
    if (breaks) flush();
    else if (name === "td" || name === "th" || name === "dd") cur.text += "  ";
    for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
    if (breaks) flush();
  };
  walk(root);
  flush();
  return lines;
}

/** The element holding characters [at, at+len) of a line: the smallest one around all of them. */
function placeOf(line: Line, at: number, len: number, order: (el: Element) => number): { el: Element | null; at: number } {
  const elAt = (i: number): Element | null => {
    let hit: Text | null = null;
    for (const p of line.parts) { if (p.start <= i) hit = p.node; else break; }
    return hit?.parentElement ?? null;
  };
  const a = elAt(at);
  const b = elAt(at + len - 1);
  let el = a;
  if (a && b && a !== b) for (el = a; el && !el.contains(b); el = el.parentElement) { /* climb */ }
  return { el, at: el ? order(el) : Number.MAX_SAFE_INTEGER };
}

/** Each element's place in document order, counted once for the page. */
function docOrder(root: Element): (el: Element) => number {
  let index: Map<Element, number> | null = null;
  return (el) => {
    if (!index) {
      index = new Map();
      let i = 0;
      index.set(root, i++);
      for (const e of Array.from(root.querySelectorAll("*"))) index.set(e, i++);
    }
    return index.get(el) ?? Number.MAX_SAFE_INTEGER;
  };
}

// ---- phones ----

/** Something that could be a phone number: digits with spaces, dots, slashes, dashes or brackets between them. */
const PHONE_RE = /(?:\+|\b00)?\(?\d[\d\s./()–-]{5,40}\d/g;
const LABEL_RE = /(tel|telefon|telefonu|phone|mobil|mobile|mob|gsm|handy|fon|volejte|call|zavolejte|hotline|infolinka|kontakt)\b\W{0,6}$/i;
const FAX_RE = /fax\W{0,6}$/i;
/** Before a number that is not one: a company or tax id, a bank account, a reference. */
const NOT_PHONE_BEFORE = /(?:^|[^\p{L}])(i[čc]o?|di[čc]|i[čc]\s*dph|vat|ust|ust-?id(?:nr)?|steuer\w*|č\.\s*ú\.?|č\.?\s*účtu|účet|ucet|bankovní spojení|bank\w*|account|konto|kto|iban|bic|swift|reg\w*|č\.\s*j\.|čj|spis\w*|ref\w*|var\w*\s*symbol|vs|ks|ss|ev\.\s*č\.?|isbn|issn)\W{0,8}$/iu;
/** After a number that is a price. */
const PRICE_AFTER = /^\s*(,-|,–|kč|kc|czk|eur|€|\$|£|usd|korun|euro|ft|zł|zl)/i;
const PRICE_BEFORE = /(€|\$|£|czk|eur|usd)\s*$/i;
const DATE_IN = /\b\d{1,2}\s*\.\s*\d{1,2}\s*\.\s*(?:\d{2}|\d{4})\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/;
/** A time of day written with a dot or colon ("8.00", "16:30"): opening hours, not a phone. */
const TIME_IN = /(?:^|[^\d])\d{1,2}[.:]\d{2}(?!\d)/;

const digits = (s: string): string => s.replace(/\D/g, "");

/** `text` cut at `sep`, each piece with its offset. */
function split(text: string, at: number, sep: RegExp): [string, number][] {
  const out: [string, number][] = [];
  let from = 0;
  for (const m of [...text.matchAll(sep), null]) {
    const end = m ? m.index ?? 0 : text.length;
    const piece = text.slice(from, end);
    if (piece.trim()) out.push([piece, at + from]);
    if (m) from = end + m[0].length;
  }
  return out;
}

/**
 * The numbers in a candidate. A wide gap always parts two (table cells read as one line are two spaces apart: a row
 * of prices "400  300  1000" is not one number). Each part counts as a whole when it reads as a number, else its
 * pieces at " / " or " | " ("377 912 345 / 777 123 456").
 */
function pieces(text: string, at: number, ok: (t: string, at: number) => boolean): [string, number][] {
  return split(text, at, /\s{2,}/g).flatMap(([part, from]) => (ok(part, from) ? [[part, from] as [string, number]] : split(part, from, /\s+[/|]\s+/g)));
}

/** "tel" when the number came from a tel: link; else what stands before it in its line. */
function phoneContext(text: string, at: number, len: number): { before: string; after: string } {
  return { before: text.slice(Math.max(0, at - 32), at), after: text.slice(at + len, at + len + 12) };
}

function phoneOf(raw: string, ctx: "tel" | { before: string; after: string }, cz: () => boolean): Omit<Found, "el" | "at"> | null {
  const text = collapse(raw).replace(/[\s./(–-]+$/, "");
  const d = digits(text);
  const intl = /^\s*(\+|00)/.test(text);
  const national = intl ? d.replace(/^00/, "") : d;
  if (ctx !== "tel") {
    const { before, after } = ctx;
    if (/[\p{L}\d]$/u.test(before) || /^[\p{L}\d]/u.test(after)) return null; // part of a longer code ("CZ6508...")
    if (NOT_PHONE_BEFORE.test(before) || PRICE_BEFORE.test(before) || PRICE_AFTER.test(after)) return null;
    if (FAX_RE.test(before) && !/tel\W{0,3}\/\s*fax\W{0,6}$/i.test(before)) return null; // a fax is not a way to call
    if (DATE_IN.test(text) || TIME_IN.test(text)) return null;
    if (/\/\s*\d{4}$/.test(text) && !/^0/.test(text)) return null; // a Czech bank account: 123456789/0800
    if (/,\d{2}$/.test(text)) return null;
    const labelled = LABEL_RE.test(before);
    const spaced = /[\s./()-]/.test(text);
    if (intl) {
      if (national.length < 9 || national.length > 15) return null;
    } else if (/^0/.test(d)) {
      // German, Austrian, British, ... national numbers start with a 0 and an area code.
      if (d.length < (labelled ? 6 : 9) || d.length > 13 || (!spaced && !labelled)) return null;
    } else if (d.length === 9) {
      // A Czech or Slovak number: 9 digits, never starting with 0 or 1.
      if (/^[01]/.test(d) || (!spaced && !labelled)) return null;
    } else if (d.length === 10 && /^(?:\([2-9]\d{2}\)\s?|[2-9]\d{2}[.-])\d{3}[.-]\d{4}$/.test(text)) {
      // North American, written its own way: (555) 123-4567, 555-123-4567, 555.123.4567. With spaces only it is not
      // told from three prices in a row.
    } else if (!(labelled && d.length >= 6 && d.length <= 12)) {
      return null;
    }
  } else if (d.length < 3) {
    return null;
  }
  // tel: href: the number as dialled. A Czech page's 9-digit number gets its country code, so it works from abroad too.
  let dial = intl ? `+${national}` : d;
  if (!intl && d.length === 9 && /^[2-9]/.test(d) && cz()) dial = `+420${d}`;
  const shown = text.length >= 3 ? text : d;
  return { kind: "phone", text: shown, href: `tel:${dial}`, key: phoneKey(intl ? national : d) };
}

/** Numbers compare by their last 9 digits: "+420 377 912 345", "00420377912345" and "377 912 345" are one. */
const phoneKey = (d: string): string => d.slice(-9);

const czechDocs = new WeakMap<Document, boolean>();

/** A Czech page: a .cz address, a cs lang attribute, or (no lang attribute, as on old sites) Czech words. */
function czech(url: string, doc: Document): boolean {
  try { if (/\.cz$/i.test(new URL(url).hostname)) return true; } catch { /* not a URL */ }
  const lang = doc.documentElement?.getAttribute("lang")?.trim() ?? "";
  if (lang) return /^cs\b/i.test(lang);
  let known = czechDocs.get(doc);
  if (known === undefined) {
    known = detectLang((doc.body?.textContent ?? "").slice(0, 20_000)).lang === "cs";
    czechDocs.set(doc, known);
  }
  return known;
}

// ---- e-mails ----

const AT_WORD = String.raw`\s*(?:@|[\[({<]\s*(?:at|zavin[aá][cč]|@)\s*[\])}>])\s*`;
const DOT_WORD = /\s*(?:[\[({<]\s*(?:dot|te[cč]ka|\.)\s*[\])}>])\s*/gi;
const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?`;
const DOT = String.raw`(?:\.|\s*[\[({<]\s*(?:dot|te[cč]ka|\.)\s*[\])}>]\s*)`;
/** An address as written: plain, or with (at)/[zavináč] and (dot)/[tečka] in place of the signs. */
const EMAIL_RE = new RegExp(String.raw`([a-z0-9][a-z0-9._%+-]{0,63})${AT_WORD}(${LABEL}(?:${DOT}${LABEL})*${DOT}[a-z]{2,24})\b`, "gi");
const EMAIL_ONLY = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}$/i;

// ---- addresses ----

/** A postcode and a town: "330 11 Štáhlavy", "33011 Štáhlavy", "10115 Berlin". */
const POSTCODE_RE = /(?<![\d\p{L}])(\d{3}\s?\d{2}|\d{5})\s+(\p{Lu}[\p{L}.-]*(?:[ -](?!(?:Tel|Telefon|Fax|Mobil|E-?mail|IČO?|DIČ|Web|GSM|Kontakt|Phone|Email)\b)(?:\p{Lu}[\p{L}.-]*|nad|pod|u|v|an|am|im|bei|\d{1,2}(?!\d)))*)/u;
/** A street and its number: "Plzeňská 123/45", "Hlavní 5", "Hauptstraße 12a", "nám. Míru 1". */
const STREET_RE = /\p{L}[\p{L}.]+(?:\s+\p{L}[\p{L}.]*){0,3}\s+\d{1,5}[a-z]?(?:\/\d{1,5}[a-z]?)?\b/u;
/** The English order, the number first: "14 Station Road", "221b Baker Street". */
const STREET_EN = /\b\d{1,5}[a-z]?\s+\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+){0,3}\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Way|Boulevard|Blvd|Place|Pl|Court|Ct|Square|Sq|Close|Crescent|Terrace|Row)\b\.?/u;
const MAX_ADDRESS = 110;

function addresses(root: Element, lines: Line[], order: (el: Element) => number): Found[] {
  const out: Found[] = [];
  const keyOf = (s: string) => fold(s).replace(/[^a-z0-9]/g, "");
  const push = (text: string, el: Element | null) => {
    const t = collapse(text).replace(/^[,;:|\s-]+|[,;:|\s-]+$/g, "");
    if (t.length < 8 || t.length > MAX_ADDRESS) return;
    out.push({ kind: "address", text: t, key: keyOf(t), el, at: el ? order(el) : Number.MAX_SAFE_INTEGER });
  };

  // schema.org PostalAddress in microdata.
  for (const el of Array.from(root.querySelectorAll('[itemtype*="PostalAddress" i]'))) {
    const prop = (p: string) => collapse(el.querySelector(`[itemprop="${p}"]`)?.textContent ?? "");
    const street = prop("streetAddress");
    const town = [prop("postalCode"), prop("addressLocality")].filter(Boolean).join(" ");
    if (street || town) push([street, town].filter(Boolean).join(", "), el);
  }
  // ...and in JSON-LD.
  for (const s of Array.from(root.ownerDocument.querySelectorAll('script[type="application/ld+json"]'))) {
    for (const a of jsonLd(s.textContent ?? "", "address")) {
      if (!a || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
      const town = [str("postalCode"), str("addressLocality")].filter(Boolean).join(" ");
      if (str("streetAddress") || town) push([str("streetAddress"), town].filter(Boolean).join(", "), null);
    }
  }
  // <address> elements: their lines that are not a phone, an e-mail or a link.
  for (const el of Array.from(root.querySelectorAll("address"))) {
    if (skipped(el)) continue;
    const parts = linesOf(el).filter((l) => POSTCODE_RE.test(l) || (/\d/.test(l) && !/@|\(at\)|https?:|www\.|tel|fax|phone|mobil|e-?mail|i[čc]o|di[čc]/i.test(l)));
    if (parts.length && parts.some((p) => POSTCODE_RE.test(p) || STREET_RE.test(p) || STREET_EN.test(p))) push(parts.slice(0, 3).join(", "), el);
  }
  // A line with a postcode and a town, with its street (on the same line, or the line before).
  lines.forEach((line, i) => {
    const m = POSTCODE_RE.exec(line.text);
    if (!m) return;
    const at = m.index;
    const end = at + m[0].length;
    const head = line.text.slice(0, at);
    // The address starts after the last label or separator before the postcode ("Adresa:", "|", "•").
    const cut = Math.max(head.lastIndexOf(":"), head.lastIndexOf("|"), head.lastIndexOf("•"), head.lastIndexOf("·"), head.lastIndexOf(";"));
    let street = head.slice(cut + 1);
    const town = line.text.slice(at, end);
    if (!STREET_RE.test(street)) {
      const prev = lines[i - 1]?.text ?? "";
      const s = STREET_RE.exec(prev);
      HOURS_RE.lastIndex = 0;
      if (!s || prev.length > 80 || HOURS_RE.test(prev) || /tel|fax|mobil|i[čc]o|di[čc]|@/i.test(prev)) return; // a postcode without a street is not enough to find the place
      street = s[0];
    } else {
      // Keep the street and what follows it, not the company name before it.
      const s = streetStart(street);
      street = street.slice(s);
    }
    if (DATE_IN.test(street + town) || /\b(i[čc]o|di[čc])\b/i.test(street)) return;
    push(`${collapse(street).replace(/,$/, "")}, ${collapse(town)}`, placeOf(line, at, end - at, order).el);
  });
  return out;
}

/** Where a street name starts in "Autoservis Novák, Plzeňská 12": after the last comma before the house number. */
function streetStart(s: string): number {
  const num = s.search(/\d/);
  const before = num < 0 ? s : s.slice(0, num);
  const comma = before.lastIndexOf(",");
  return comma + 1;
}

// ---- addresses without a postcode ----

/** A street and its house number, the whole of a piece of a line: "Rovná 235", "Přáslavice č.p. 23", "Na Výsluní
 *  1234/5", "U Lípy 12a", "Hauptstraße 12". The name is up to four words. */
const STREET_PIECE = /^(\p{L}[\p{L}.'’-]*(?:\s+\p{L}[\p{L}.'’-]*){0,3})\s+(\d{1,5}[a-zA-Z]?(?:\/\d{1,5}[a-zA-Z]?)?)$/u;
const STREET_EN_PIECE = new RegExp(String.raw`^(?:${STREET_EN.source})$`, "u");
/** Words that can start a street name in lower case: "nám. Míru 1", "třída Svobody 12". */
const LOWER_START = new Set(["nám.", "náměstí", "třída", "tř.", "ul.", "ulice", "nábř.", "nábřeží", "sídl.", "sídliště", "sady"]);
/** Small words inside a street or a town name: "Na Výsluní", "Jablonec nad Nisou", "Frankfurt am Main". */
const SMALL = new Set(["nad", "pod", "na", "u", "v", "ve", "za", "k", "ke", "při", "před", "do", "od", "č.p.", "čp.", "č.", "č.o.",
  "de", "la", "le", "du", "sur", "an", "am", "im", "in", "der", "bei", "zum", "zur", "upon", "on", "of", "the"]);
/** A first word that never starts a street or a town: a label, a price list's column, a sentence, a day or a month. */
const NOT_A_PLACE = new Set(("tel tel. telefon mobil mob. gsm fax email e-mail mail web www mapa map kontakt kontakty contact "
  + "ič ičo dič ič. psč cena ceny kauce nosnost délka šířka výška typ model verze version strana str. kapitola článek odst. "
  + "číslo počet celkem kus ks cca max min od rok roku since seit ab bis from until year jahr "
  + "jsme jsou je najdete sídlíme bydlíme we our wir unsere objednávky otevřeno zavřeno provozní otevírací open opening "
  + "closed foto fotogalerie galerie popis akce sleva info úvod home menu "
  + "pondělí úterý středa čtvrtek pátek sobota neděle po út st čt pá so ne "
  + "monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun "
  + "montag dienstag mittwoch donnerstag freitag samstag sonntag mo di mi do fr sa so "
  + "leden únor březen duben květen červen červenec srpen září říjen listopad prosinec "
  + "ledna února března dubna května června července srpna září října listopadu prosince "
  + "january february march april may june july august september october november december "
  + "januar februar märz juni juli oktober dezember").split(" "));
/** A town: capitalised words, the small words between them, a district after a dash, a district number ("Praha 4"). */
const TOWN_RE = /^\p{Lu}[\p{L}.'’-]*(?:\s+(?:\p{L}[\p{L}.'’-]*|[-–]|\d{1,2}))*$/u;
const POSTCODE_ONLY = /^(?:\d{3}\s?\d{2}|\d{5})$/;
/** Says the lines near it are an address. */
const ADDRESS_WORD = /(?:^|[^\p{L}])(?:adres[aey]|adresa provozovny|sídl[oa]|sídlem|provozovn[ay]|pobočk[ay]|najdete nás|nás najdete|kde nás|address|anschrift|adresse|standort|find us|visit us)(?:[^\p{L}]|$)/iu;
const PRICE_IN = /\d\s*(?:,-|,–|kč|czk|eur|€|\$|£)|(?:€|\$|£)\s*\d/i;
/** How many lines apart a phone may be, in the same block, to vouch for an address beside it. */
const NEAR_PHONE = 6;

/** A street and house number as the page writes it, or null: never a label, a day, a month, a year, a product code. */
function streetPiece(s: string): string | null {
  const t = collapse(s);
  if (t.length > 50) return null;
  if (STREET_EN_PIECE.test(t)) return t;
  const m = STREET_PIECE.exec(t);
  if (!m) return null;
  const words = (m[1] ?? "").split(/\s+/);
  const first = words[0] ?? "";
  if (NOT_A_PLACE.has(first.toLowerCase())) return null;
  if (!/^\p{Lu}/u.test(first) && !LOWER_START.has(first.toLowerCase())) return null;
  // The rest: capitalised words or the small words between them ("Na Výsluní", "Přáslavice č.p.").
  if (!words.slice(1).every((w) => /^\p{Lu}/u.test(w) || SMALL.has(w.toLowerCase()))) return null;
  // A code in capitals beside ordinary words ("Thule Motion XT 800") is a product, not a street.
  const caps = words.filter((w) => /^\p{Lu}{2,}$/u.test(w.replace(/[.'’-]/g, "")));
  if (caps.length && caps.length < words.length) return null;
  if (/\/(?:19|20)\d{2}$/.test(m[2] ?? "")) return null; // "7/2015": a month and a year
  return t;
}

/** A town as the page writes it, or null. */
function townPiece(s: string): string | null {
  const t = collapse(s).replace(/[,.;]$/, "");
  if (t.length < 2 || t.length > 48 || !TOWN_RE.test(t)) return null;
  const words = t.split(/\s+/);
  // Capitalised words and the small words between them: "Jablonec nad Nisou", never "Cena za den" or a sentence.
  if (!words.every((w) => /^(?:\p{Lu}|\d|[-–]$)/u.test(w) || SMALL.has(w.toLowerCase()))) return null;
  if (words.some((w) => NOT_A_PLACE.has(w.toLowerCase()) && /^\p{Lu}/u.test(w))) return null;
  HOURS_RE.lastIndex = 0;
  if (HOURS_RE.test(t)) return null;
  return t;
}

/**
 * Addresses written with no postcode, or with it on a line of its own after the town (round-1 gap G6, the trailer
 * rental's "Rovná 235 / Jablonec nad Nisou - Kokonín / 468 01"): a street and house number that is the whole of its
 * line or of a comma-separated piece of it, then the town in the same line or on the next. Taken only where the page
 * vouches for it: a word that says address before it ("Adresa:", "Sídlo", "Kde nás najdete"), or a phone in the same
 * block a few lines away. Never a line of running text, a date, hours, a price list's row or a product code.
 */
function streetAddresses(lines: Line[], phoneLines: Set<number>, order: (el: Element) => number): Found[] {
  const out: Found[] = [];
  const elOf = (i: number): Element | null => (lines[i]?.parts.find((p) => p.node.data.trim()) ?? lines[i]?.parts[0])?.node.parentElement ?? null;
  const text = (i: number): string => collapse(lines[i]?.text ?? "");
  const priced = (i: number): boolean => PRICE_IN.test(text(i));

  lines.forEach((line, i) => {
    const whole = text(i);
    if (!whole || whole.length > 90 || POSTCODE_RE.test(whole) || DATE_IN.test(whole)) return;
    const el = elOf(i);
    if (el?.closest("address")) return; // the <address> element is read as a whole (see addresses)
    // The label before the address ("Adresa:", "Sídlo firmy:"): what stands before the last colon.
    const colon = Math.max(whole.lastIndexOf(":"), whole.lastIndexOf("|"), whole.lastIndexOf("•"));
    const label = colon >= 0 ? whole.slice(0, colon) : "";
    const body = whole.slice(colon + 1).trim();
    // "Michal Šmíd, Rovná 235, Jablonec nad Nisou, 468 01": a name may stand before the street, the town after it.
    const pieces = body.split(/\s*,\s*/).filter(Boolean);
    const at = pieces.findIndex((p) => !!streetPiece(p));
    if (at < 0 || at > 2 || pieces.length - at > 3) return;
    const street = streetPiece(pieces[at] as string) as string;
    let rest = pieces.slice(at + 1);
    let last = i;
    let postcode = "";
    let town: string | null = null;
    if (rest.length && POSTCODE_ONLY.test(rest[rest.length - 1] as string)) postcode = rest.pop() as string;
    if (rest.length) {
      // The town on the same line: the whole rest of it ("Rovná 235, Jablonec nad Nisou - Kokonín").
      town = rest.length === 1 ? townPiece(rest[0] as string) : null;
      if (!town) return;
    } else {
      // The town on the next line, maybe after a postcode line, maybe followed by one.
      let j = i + 1;
      if (!postcode && POSTCODE_ONLY.test(text(j))) postcode = text(j++);
      town = townPiece(text(j));
      if (!town || POSTCODE_RE.test(text(j))) return;
      last = j;
      if (!postcode && POSTCODE_ONLY.test(text(j + 1))) { postcode = text(j + 1); last = j + 1; }
    }
    // A price list's row is no address, nor a street with a price beside it.
    if ([i - 1, i, last, last + 1].some(priced)) return;
    // One word and a year ("Novinka 2025") is more often news than a street: only a label that says address takes it.
    const yearLike = /^\S+\s+(?:19|20)\d{2}$/.test(street);
    if (!vouched(i, last, label, !yearLike)) return;
    const shown = `${street}, ${postcode ? `${postcode.replace(/^(\d{3})(\d{2})$/, "$1 $2")} ` : ""}${town}`;
    const a = elOf(i);
    const b = elOf(last);
    const box = a && b ? common(a, b) : a;
    out.push({ kind: "address", text: shown, key: fold(shown).replace(/[^a-z0-9]/g, ""), el: box, at: box ? order(box) : Number.MAX_SAFE_INTEGER });
  });
  return out;

  /** The page says it is an address (its label, or a short line just before it), or a phone sits in the same block. */
  function vouched(first: number, last: number, label: string, byPhone: boolean): boolean {
    if (ADDRESS_WORD.test(label)) return true;
    for (const k of [first - 1, first - 2]) if (text(k).length <= 50 && ADDRESS_WORD.test(text(k))) return true;
    if (!byPhone) return false;
    for (const p of phoneLines) {
      if (p < 0) continue;
      const gap = p < first ? first - p : p > last ? p - last : 0;
      if (gap > NEAR_PHONE) continue;
      if (gap <= 2) return true;
      const a = elOf(first);
      const b = elOf(p);
      const box = a && b ? common(a, b) : null;
      if (box && !["body", "html"].includes(box.localName.toLowerCase())) return true;
    }
    return false;
  }
}

/** An element's text split where the page breaks lines (block children, <br>). */
function linesOf(el: Element): string[] {
  return readLines(el).map((l) => collapse(l.text)).filter(Boolean);
}

// ---- opening hours ----

const DAY = String.raw`(?:po(?:ndělí|ndeli)?|út(?:erý)?|ut(?:ery)?|st(?:ředa|reda)?|čt(?:vrtek)?|ct(?:vrtek)?|pá(?:tek)?|pa(?:tek)?|so(?:bota)?|ne(?:děle|dele)?`
  + String.raw`|mo(?:ntag|nday|n)?|di(?:enstag)?|mi(?:ttwoch)?|do(?:nnerstag)?|fr(?:eitag|iday|i)?|sa(?:mstag|turday|t)?|so(?:nntag)?|tu(?:esday|e)?|we(?:dnesday|d)?|th(?:ursday|u)?|su(?:nday|n)?)\.?`;
const TIME = String.raw`\d{1,2}(?:[:.]\d{2})?\s*(?:h|hod\.?|uhr)?`;
const RANGE = String.raw`${TIME}\s*(?:[-–—]|až|bis|to)\s*${TIME}`;
/** "Po-Pá 8-17", "Pondělí: 8:00 - 16:00", "Mo-Fr 9-18 Uhr", "Po, St 8.00 - 12.00, 13.00 - 17.00". */
const HOURS_RE = new RegExp(String.raw`(?<![\p{L}])${DAY}(?:\s*(?:[-–—,+]|až|a|und|bis|to|&)\s*${DAY})*\s*[:\s]\s*${RANGE}(?:\s*[,;/a]?\s*${RANGE})*`, "giu");

function hours(root: Element, lines: Line[], order: (el: Element) => number): Found[] {
  const out: Found[] = [];
  // schema.org openingHours: microdata and JSON-LD.
  for (const el of Array.from(root.querySelectorAll('[itemprop="openingHours"]'))) {
    const t = collapse(el.getAttribute("content") ?? el.textContent ?? "");
    if (t) out.push({ kind: "hours", text: t, key: fold(t), el, at: order(el) });
  }
  for (const s of Array.from(root.ownerDocument.querySelectorAll('script[type="application/ld+json"]'))) {
    for (const h of jsonLd(s.textContent ?? "", "openingHours")) {
      const t = collapse(Array.isArray(h) ? h.filter((x) => typeof x === "string").join("; ") : typeof h === "string" ? h : "");
      if (t) out.push({ kind: "hours", text: t, key: fold(t), el: null, at: Number.MAX_SAFE_INTEGER });
    }
  }
  // Day-and-time lines; lines next to each other (a table, stacked headings) make one item.
  let group: { texts: string[]; el: Element | null; last: number } | null = null;
  const close = () => {
    if (group) {
      const t = group.texts.join("; ");
      if (t.length <= 160) out.push({ kind: "hours", text: t, key: fold(t).replace(/\s+/g, ""), el: group.el, at: group.el ? order(group.el) : Number.MAX_SAFE_INTEGER });
    }
    group = null;
  };
  lines.forEach((line, i) => {
    const texts: string[] = [];
    let first: { at: number; len: number } | null = null;
    let run = -1; // where the run of days written as one ("Po-Pá 8-17, So 8-12") started
    let lastEnd = -1;
    for (const m of line.text.matchAll(HOURS_RE)) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      if (run >= 0 && /^[\s,;]*$/.test(line.text.slice(lastEnd, at))) texts[texts.length - 1] = collapse(line.text.slice(run, end));
      else { texts.push(collapse(m[0])); run = at; }
      first ??= { at, len: m[0].length };
      lastEnd = end;
    }
    if (!texts.length || !first) return;
    const el = placeOf(line, first.at, first.len, order).el;
    const g = group as { texts: string[]; el: Element | null; last: number } | null;
    if (g && i - g.last <= 2 && g.texts.length < 7) {
      g.texts.push(...texts);
      g.last = i;
      if (g.el && el) g.el = common(g.el, el);
    } else {
      close();
      group = { texts, el, last: i };
    }
  });
  close();
  return out;
}

const common = (a: Element, b: Element): Element => {
  for (let e: Element | null = a; e; e = e.parentElement) if (e.contains(b)) return e;
  return a;
};

// ---- the contact page ----

const CONTACT_WORD = /(^|[^\p{L}])(kontakt|kontakty|kontaktujte|contact|contacts|contact-us|contactus|impressum|kapcsolat|kontakta)([^\p{L}]|$)/iu;

function contactPage(root: Element, url: string, order: (el: Element) => number): Found | null {
  let here: URL | null = null;
  try { here = new URL(url); } catch { /* no address */ }
  // This page is the contact page already: nothing to link to.
  if (here && CONTACT_WORD.test(safeDecode(here.pathname))) return null;
  const h1 = root.ownerDocument.querySelector("h1");
  if (h1 && CONTACT_WORD.test(collapse(h1.textContent ?? "")) && collapse(h1.textContent ?? "").length < 40) return null;

  let best: { a: Element; to: URL; score: number } | null = null;
  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    if (skipped(a)) continue;
    const href = (a.getAttribute("href") ?? "").trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let to: URL;
    try { to = new URL(href, here ?? undefined); } catch { continue; }
    if (to.protocol !== "http:" && to.protocol !== "https:") continue;
    if (here && to.origin === here.origin && to.pathname === here.pathname) continue;
    const text = collapse(a.textContent ?? "");
    const byText = text.length <= 30 && CONTACT_WORD.test(fold(text));
    const byPath = CONTACT_WORD.test(fold(safeDecode(to.pathname)));
    if (!byText && !byPath) continue;
    // Same site first, then a short link text that says it.
    const score = (byText ? 2 : 0) + (byPath ? 1 : 0) + (here && to.host === here.host ? 2 : 0);
    if (!best || score > best.score) best = { a, to, score };
  }
  if (!best) return null;
  const text = collapse(best.a.textContent ?? "") || `${best.to.host}${best.to.pathname}`;
  return { kind: "contactPage", text: text.slice(0, 60), href: best.to.href, key: best.to.href, el: best.a, at: order(best.a) };
}

// ---- small helpers ----

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();
const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Every value under `key` in a JSON-LD block (any depth, @graph included). A block that does not parse is skipped. */
function jsonLd(text: string, key: string): unknown[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  const out: unknown[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === key) { if (Array.isArray(x) && key === "address") out.push(...x); else out.push(x); }
      else walk(x, depth + 1);
    }
  };
  walk(data, 0);
  return out;
}

// ---- one piece of text (round 3, r3-09: what this page asks of you) ----

/** A phone, an e-mail address or opening hours written in a piece of text: where it starts and its exact words. */
export interface TextContact { kind: "phone" | "email" | "hours"; at: number; quote: string; text: string; href?: string }

/**
 * Phones, e-mail addresses and opening hours in one piece of text, by the same rules as findContacts (a bank account, a
 * price, a date or a company id is no phone). `czech`: a 9-digit number dials with +420. In order, never overlapping.
 */
export function contactsInText(text: string, czech: boolean): TextContact[] {
  const out: TextContact[] = [];
  const cz = () => czech;
  const free = (at: number, len: number) => !out.some((o) => at < o.at + o.quote.length && o.at < at + len);
  for (const m of text.matchAll(HOURS_RE)) {
    const at = m.index ?? 0;
    const quote = m[0].trim();
    if (free(at, quote.length)) out.push({ kind: "hours", at, quote, text: collapse(quote) });
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    const at = m.index ?? 0;
    const addr = `${m[1]}@${(m[2] ?? "").replace(DOT_WORD, ".")}`.replace(/\s+/g, "");
    if (EMAIL_ONLY.test(addr) && free(at, m[0].length)) out.push({ kind: "email", at, quote: m[0], text: addr, href: `mailto:${addr}` });
  }
  for (const m of text.matchAll(PHONE_RE)) {
    for (const [piece, at] of pieces(m[0], m.index ?? 0, (t, i) => !!phoneOf(t, phoneContext(text, i, t.length), cz))) {
      const p = phoneOf(piece, phoneContext(text, at, piece.length), cz);
      const quote = piece.replace(/[\s./(–-]+$/, "").trim();
      const start = at + piece.indexOf(quote);
      if (p?.href && free(start, quote.length)) out.push({ kind: "phone", at: start, quote, text: p.text, href: p.href });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
