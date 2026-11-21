// Clean: what on a page is not the content the person came for, and what kind of thing it is. Pure DOM reading, like
// page.ts: it never changes the page. The caller (the extension's content script) hides what this returns, lists it
// in "What was removed", and can bring each item back. Layout facts (is it on screen, is it fixed) come from the caller,
// because only a browser knows them; the defaults read attributes and inline styles, which is what a test document has.
import { SKIP_TAGS, attr, collapse, isHidden, tag } from "./dom.js";

export type ClutterKind =
  | "cookie" | "popup" | "ad" | "menu" | "header" | "sidebar" | "footer" | "comments" | "related" | "share" | "newsletter"
  | "other";

export interface ClutterItem {
  /** `c0`, `c1`, ... in document order. Stable within one call. */
  id: string;
  kind: ClutterKind;
  /** What the person sees in "What was removed", in English. */
  label: string;
}

export const CLUTTER_LABELS: Record<ClutterKind, string> = {
  cookie: "Cookie notice",
  popup: "Pop-up",
  ad: "Advert",
  menu: "Menu",
  header: "Site header",
  sidebar: "Sidebar",
  footer: "Footer",
  comments: "Comments",
  related: "Related links",
  share: "Share buttons",
  newsletter: "Newsletter sign-up",
  other: "Other part of the site",
};

export interface ClutterOptions {
  /** The elements the content was read from (extractPage's onSource, plus what the host knows is content: the main
   *  video, the form). They, everything inside them and every ancestor are never clutter. */
  keep: readonly Element[];
  /** What the host knows the page is FOR beyond its text: the main video, the form. Like `keep`, and stronger: never
   *  inside anything returned, whatever that box calls itself. */
  protect?: readonly Element[];
  /** The elements of the running text (paragraphs, lists, tables): where the main column is. Defaults to `keep`. */
  body?: readonly Element[];
  /** Whether the element takes space on screen. Default: not hidden by attribute or inline style. */
  shown?: (el: Element) => boolean;
  /** The element's CSS position ("static", "fixed", "sticky", ...). Default: from the inline style. */
  position?: (el: Element) => string;
  /** The share of the window the element covers (0-1). An empty box over most of the window is a pop-up's backdrop.
   *  Default: 0 (a test document has no layout). */
  covers?: (el: Element) => number;
  /** Called once per item with its id and the element to hide. The element never leaves the page. */
  onElement?: (id: string, el: Element) => void;
}

const SILENT = new Set([...SKIP_TAGS, "link", "meta", "base", "title", "br", "wbr"]);
SILENT.delete("iframe"); // an ad is often an iframe; it is judged like any other element

/** Kinds that name themselves plainly enough to be taken out even when the page reader read their text. */
const STRONG = new Set<ClutterKind>(["comments", "related", "ad", "share", "newsletter", "cookie"]);

/** Characters of running text below which a page is treated as thin (see findClutter). */
const THIN_PAGE = 400;

const MEDIA = "img, picture, video, iframe, canvas, svg, object, embed";

/** Words in an element's class or id that say what it is. Checked in this order; the first kind that matches wins. */
const TOKENS: [ClutterKind, RegExp][] = [
  ["cookie", /^(cookies?|cookiebanner|cookienotice|cookiebar|consent|gdpr|cmp|onetrust|didomi|cookiebot|usercentrics)$/],
  ["newsletter", /^(newsletter|newsletters|subscribe|subscription|odber|signup)$/],
  ["ad", /^(ad|ads|adv|advert|adverts|advertisement|adsbygoogle|sponsored|sponsor|reklama|reklamy|sklik|ssp|adform|branding|bannerad|commercial|dfp|gpt)$/],
  ["comments", /^(comment|comments|discussion|diskuse|diskuze|disqus|replies)$/],
  ["related", /^(related|recommended|recommendations|souvisejici|teaser|teasers|trending|mostread|popular|nejctenejsi|outbrain|taboola|readalso|ctetetaky)$/],
  ["share", /^(share|sharing|social|sharebar|socials)$/],
  ["menu", /^(menu|nav|navbar|navigation|breadcrumb|breadcrumbs|drobecky|megamenu|topbar)$/],
  ["footer", /^(footer|paticka)$/],
  ["header", /^(header|masthead|hlavicka)$/],
  ["sidebar", /^(sidebar|aside|rail|sidebox)$/],
  ["popup", /^(popup|modal|overlay|lightbox|dialog|interstitial)$/],
];

/** Text that names a thing outright, for overlays and short boxes that carry no telling class. */
// Word edges by letters, not \b: \b is ASCII-only and never matches after a Czech "í".
const AD_LABEL = /^(reklama|advertisement|sponsored|sponzorov[aá]no|inzerce|ad)$/iu;
const TEXT_KINDS: [ClutterKind, RegExp][] = [
  ["ad", /^(reklama|advertisement|inzerce|sponzorov[aá]no|sponsored)(?!\p{L})/iu],
  ["related", /^(trending|most read|read more|related|nej[čc]ten[eě]j[šs][ií]|[čc]t[eě]te tak[eé]|souvisej[ií]c[ií])(?!\p{L})/iu],
  ["cookie", /(?<!\p{L})(cookies?|souhlas[ií]m|consent|zpracov[aá]n[ií] osobn[ií]ch [uú]daj[uů])(?!\p{L})/iu],
  ["newsletter", /(?<!\p{L})(newsletter|odeb[ií]rat|k odb[eě]ru|subscribe)(?!\p{L})/iu],
  ["ad", AD_LABEL],
];
/** Consent tools by their own names, wherever they appear in a class or id ("sp_message_container_123"). */
const CONSENT_VENDORS = /(sp_message|qc-cmp|onetrust|didomi|cookiebot|usercentrics|fc-consent|cmpbox|truste|cookie-law|cookieconsent)/i;

const AD_HOSTS = /(doubleclick|googlesyndication|googletagservices|adservice|adform|ssp\.seznam|sklik|criteo|taboola|outbrain|amazon-adsystem|adnxs|rubiconproject|pubmatic|smartadserver)\./i;

function tokens(el: Element): string[] {
  return `${attr(el, "class")} ${attr(el, "id")}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function kindByTokens(el: Element): ClutterKind | null {
  if (CONSENT_VENDORS.test(`${attr(el, "class")} ${attr(el, "id")}`)) return "cookie";
  const toks = tokens(el);
  for (const [kind, re] of TOKENS) if (toks.some((t) => re.test(t))) return kind;
  if (tag(el) === "iframe" && AD_HOSTS.test(attr(el, "src"))) return "ad";
  return null;
}

function kindByRole(el: Element): ClutterKind | null {
  const t = tag(el);
  const role = attr(el, "role").toLowerCase();
  if (t === "nav" || role === "navigation") return "menu";
  if (t === "footer" || role === "contentinfo") return "footer";
  if (t === "aside" || role === "complementary") return "sidebar";
  if (t === "header" || role === "banner") return "header";
  if (t === "dialog" || role === "dialog" || role === "alertdialog" || attr(el, "aria-modal").toLowerCase() === "true") return "popup";
  return null;
}

/** Only the first 600 characters: a cookie notice is short, and an outer box full of text is judged by its class. */
const shortText = (el: Element): string => collapse((el.textContent ?? "").slice(0, 600));

function kindByText(el: Element): ClutterKind | null {
  const text = shortText(el);
  if (!text || text.length >= 600) return null;
  for (const [kind, re] of TEXT_KINDS) if (re.test(text)) return kind;
  return null;
}

/** What an element that is not content is. `overlay`: it floats over the page (fixed or sticky). */
function kindOf(el: Element, overlay: boolean): ClutterKind {
  // A menu, a footer or a dialog says what it is by its element; its words ("Subscribe now") do not change that. A
  // header or an aside is only a box, so what it says comes first ("We use cookies", "Advertisement").
  const role = kindByRole(el);
  const semantic = role === "menu" || role === "footer" || role === "popup" ? role : null;
  return kindByTokens(el) ?? semantic ?? kindByText(el) ?? role ?? (overlay ? "popup" : "other");
}

/** Inside the main column only things that announce themselves are clutter: an ad, a share bar, comments. */
function looksLikeClutter(el: Element): ClutterKind | null {
  // A header inside the main column is the article's own (its title block), whatever its class says.
  const byTokens = kindByTokens(el);
  if (byTokens && byTokens !== "header") return byTokens;
  const role = kindByRole(el);
  if (role && role !== "header") return role;
  const text = shortText(el);
  if (text && text.length < 40 && AD_LABEL.test(text)) return "ad";
  return null;
}

/** Something a person would notice: text, or a picture, a video or a frame. Empty boxes are left alone. */
const hasSubstance = (el: Element): boolean =>
  tag(el) === "iframe" || !!collapse(el.textContent ?? "") || !!el.querySelector(MEDIA);

/** How much of the element's text sits in links (0-1). */
function linkDensity(el: Element): number {
  const all = collapse(el.textContent ?? "").length;
  if (!all) return 0;
  const linked = Array.from(el.querySelectorAll("a")).reduce((n, a) => n + collapse(a.textContent ?? "").length, 0);
  return Math.min(linked / all, 1);
}

const inlinePosition = (el: Element): string => /position\s*:\s*(fixed|sticky)/i.exec(attr(el, "style"))?.[1]?.toLowerCase() ?? "static";

function commonAncestor(a: Element, b: Element): Element {
  for (let el: Element | null = a; el; el = el.parentElement) if (el.contains(b)) return el;
  return b.ownerDocument.documentElement;
}

/**
 * The parts of `doc` that are not its content, outermost first, each once. Three passes:
 * 1. anything that floats over the page (fixed or sticky) and holds no content: cookie walls, pop-ups, sticky bars;
 * 2. outside the main column, every box beside the path to the content: menus, headers, sidebars, footers;
 * 3. inside the main column, only boxes that announce themselves as clutter (ads, share bars, comments, related).
 * Nothing that holds a `keep` element is returned, with one exception: a box inside the main column that names itself
 * comments, related links, an ad, a share bar, a sign-up or a cookie notice, and holds less than half of the running
 * text (`body`) or is mostly links without the headline. Nothing that holds a `protect` element is ever returned. With no `keep` there is nothing to protect, so nothing is returned.
 */
export function findClutter(doc: Document, opts: ClutterOptions): ClutterItem[] {
  const body = doc.body;
  if (!body || opts.keep.length === 0) return [];
  const shown = opts.shown ?? ((el: Element) => !isHidden(el));
  const position = opts.position ?? inlinePosition;

  const covers = opts.covers ?? (() => 0);
  const protect = opts.protect ?? [];
  // The headline is content even when the page reader left it out (it drops an h1 that only repeats the title).
  const headline = Array.from(body.querySelectorAll("h1")).find((h) => shown(h) && !!collapse(h.textContent ?? ""));
  const keep = new Set([...opts.keep, ...protect, ...(headline ? [headline] : [])]);
  const holdsProtected = (el: Element): boolean => protect.some((p) => el.contains(p));
  const chain = new Set<Element>();
  for (const k of keep) for (let e: Element | null = k; e && !chain.has(e); e = e.parentElement) chain.add(e);
  const insideKeep = (el: Element): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) if (keep.has(e)) return true;
    return false;
  };
  const text = opts.body?.length ? opts.body : opts.keep;
  const main = text.reduce<Element>((a, b) => commonAncestor(a, b), text[0] as Element);

  const found = new Map<Element, ClutterKind>();
  const add = (el: Element, kind: ClutterKind) => { if (!found.has(el)) found.set(el, kind); };
  const eligible = (el: Element): boolean =>
    !SILENT.has(tag(el)) && !chain.has(el) && !insideKeep(el) && hasSubstance(el) && shown(el);

  /** Running text per element, and in all: how much of the page is text to read. */
  const textLen = new Map<Element, number>();
  for (const t of text) textLen.set(t, collapse(t.textContent ?? "").length);
  const total = [...textLen.values()].reduce((a, b) => a + b, 0) || 1;

  // 1. Overlays, anywhere.
  for (const el of Array.from(body.querySelectorAll("*"))) {
    if (SILENT.has(tag(el))) continue;
    const pos = position(el);
    if (pos !== "fixed" && pos !== "sticky") continue;
    if (eligible(el)) add(el, kindOf(el, true));
    // A backdrop: nothing in it, but it greys out the page behind a dialog.
    else if (!chain.has(el) && !insideKeep(el) && !hasSubstance(el) && covers(el) >= 0.3 && shown(el)) add(el, "popup");
  }

  // 2 and 3. Beside the path to the content. What sits between the headline and the main text (the lead paragraph,
  // the lead photo, the byline) is the article's own, even when the page reader started the text below it: there only
  // self-named clutter goes, as inside the main column.
  const h1 = headline;
  const corridor = h1 && !main.contains(h1) ? commonAncestor(h1, main) : null;
  const between = (el: Element): boolean =>
    !!corridor && !!h1 && corridor.contains(el) && !el.contains(main) && !el.contains(h1)
    && !!(h1.compareDocumentPosition(el) & 4 /* el follows h1 */) && !!(el.compareDocumentPosition(main) & 4 /* main follows el */);
  const inside = (el: Element) => main.contains(el);
  // A page with almost no text of its own (an old small-business site: a picture and a menu) is navigated, not read:
  // its menu IS the way to its content. There only what announces itself goes, as inside a main column.
  // A page that holds a form or a video is there for it, not navigated: never thin.
  const thin = total < THIN_PAGE && protect.length === 0;
  /** `strongOnly`: on a thin page only what names itself plainly (ads, cookie notices, share bars...) goes. */
  const scanInside = (el: Element, strongOnly = false): void => {
    const kind = looksLikeClutter(el);
    if (kind && (!strongOnly || STRONG.has(kind))) { if (eligible(el)) add(el, kind); return; }
    for (const c of Array.from(el.children)) if (!SILENT.has(tag(c))) scanInside(c, strongOnly);
  };
  // A box inside the main column that calls itself comments, related links, an ad, a share bar or a sign-up is
  // clutter even though the page reader took its text in (a "412 comments" heading, the comments themselves), as long
  // as it holds less than half of the running text: the article itself never goes.
  const share = (el: Element): number => {
    let n = 0;
    for (const [t, len] of textLen) if (el.contains(t)) n += len;
    return n / total;
  };
  // Or when it is mostly links (a column of recommendations is all titles that link away; an article is not).
  // Beside the main column (neither inside it nor around it), a box that names itself anything at all goes, as long as
  // it holds neither the headline nor protected media: the page reader took its titles in, but it is not the content.
  for (const e of chain) {
    // A block itself can be such a box: a page reader takes a whole column of titles in as one paragraph.
    if (e === main || holdsProtected(e) || !shown(e)) continue;
    if (main.contains(e)) {
      const kind = looksLikeClutter(e);
      if (kind && STRONG.has(kind) && (share(e) < 0.5 || (linkDensity(e) >= 0.5 && !e.querySelector("h1")))) add(e, kind);
    } else if (!e.contains(main) && !e.querySelector("h1")) {
      const kind = kindByTokens(e) ?? kindByRole(e);
      if (kind) add(e, kind);
    }
  }

  for (const e of chain) {
    if (e === doc.documentElement || keep.has(e)) continue;
    for (const c of Array.from(e.children)) {
      if (chain.has(c) || SILENT.has(tag(c))) continue;
      if (thin) scanInside(c, true);
      else if (inside(e) || between(c)) scanInside(c);
      else if (eligible(c)) add(c, kindOf(c, false));
    }
  }

  // Outermost only, in document order.
  const isCovered = (el: Element): boolean => {
    for (let p = el.parentElement; p; p = p.parentElement) if (found.has(p)) return true;
    return false;
  };
  const items = Array.from(found.keys())
    .filter((el) => !isCovered(el))
    .sort((a, b) => (a.compareDocumentPosition(b) & 4 /* b follows a */ ? -1 : 1));
  return items.map((el, i) => {
    const id = `c${i}`;
    const kind = found.get(el) as ClutterKind;
    opts.onElement?.(id, el);
    return { id, kind, label: CLUTTER_LABELS[kind] };
  });
}

/** "17 distractions" in plain words, for the caption's status line. */
export function clutterSummary(items: readonly ClutterItem[]): string {
  const n = items.length;
  return n === 0 ? "Nothing to remove" : `Removed ${n} ${n === 1 ? "distraction" : "distractions"}`;
}
