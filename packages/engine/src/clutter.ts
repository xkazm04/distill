// Clean: what on a page is not the content the person came for, and what kind of thing it is. Pure DOM reading, like
// page.ts: it never changes the page. The caller (the extension's content script) hides what this returns, lists it
// in "What was removed", and can bring each item back. Layout facts (is it on screen, is it fixed) come from the caller,
// because only a browser knows them; the defaults read attributes and inline styles, which is what a test document has.
import { BLOCKISH, SKIP_TAGS, attr, collapse, isHidden, isNoise, tag } from "./dom.js";

export type ClutterKind =
  | "cookie" | "popup" | "ad" | "menu" | "header" | "sidebar" | "footer" | "comments" | "related" | "share" | "newsletter"
  | "other"
  // Things that float over the page (#4): small widgets docked to an edge or a corner of the window.
  | "chat" | "feedback" | "player" | "appBanner" | "backToTop";

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
  chat: "Chat button",
  feedback: "Feedback tab",
  player: "Floating video",
  appBanner: "App banner",
  backToTop: "Back to top button",
};

/** Where a box sits in the window, in CSS px (getBoundingClientRect plus the window's size). */
export interface ClutterBox { left: number; top: number; width: number; height: number; winWidth: number; winHeight: number }

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
  /** False when the element draws nothing, and nothing inside it does either (CSS display: none): its inside is not
   *  looked at for things that float. Lets a big page skip its hidden parts. Default: true. */
  rendered?: (el: Element) => boolean;
  /** The share of the window the element covers (0-1). An empty box over most of the window is a pop-up's backdrop.
   *  Default: 0 (a test document has no layout). */
  covers?: (el: Element) => number;
  /** Where the element sits in the window. Lets a small fixed box docked to a corner or an edge be told apart from a
   *  bar across the page (a chat bubble, not a site header). Default: unknown (a test document has no layout). */
  box?: (el: Element) => ClutterBox | null;
  /** Called once per item with its id and the element to hide. The element never leaves the page. */
  onElement?: (id: string, el: Element) => void;
}

const SILENT = new Set([...SKIP_TAGS, "link", "meta", "base", "title", "br", "wbr"]);
SILENT.delete("iframe"); // an ad is often an iframe; it is judged like any other element
/** Elements whose inside is never a box on the page: code, styles, a template, a canvas's fallback, an svg drawing
 *  (unless it holds HTML in a foreignObject). Nothing inside them floats over the page. */
const CLOSED = new Set(["script", "style", "noscript", "template", "canvas", "svg"]);

/** Kinds that name themselves plainly enough to be taken out even when the page reader read their text. */
const STRONG = new Set<ClutterKind>(["comments", "related", "ad", "share", "newsletter", "cookie", "chat", "feedback", "appBanner", "backToTop"]);

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

/** Floating widgets by the names their makers give them, matched on the class and id words joined by "-" (so
 *  "hubspot-messages-iframe-container", "_hj_feedback_container" and "backToTop" all read alike). A leading "-" is a
 *  word edge; a vendor's name may run on ("intercom-launcher"), a plain phrase ends at a word edge. */
const WIDGETS: [ClutterKind, RegExp][] = [
  ["chat", /-(intercom|zendesk|ze-?snippet|webwidget|tawk|livechat|live-chat|crisp-client|drift-(widget|frame|conductor)|hubspot-messages|smartsupp|tidio|olark|freshchat|fb-customerchat|chatbot|webchat|chat-?(widget|bubble|button|launcher|box|icon)-)/],
  ["feedback", /-(feedback|usabilla|hotjar|hj-(widget|feedback|survey)|survicate|mopinion|qualaroo)/],
  ["player", /-((sticky|floating|float|mini|docked|pip)-?(video-?)?player|player-?(sticky|floating|float|mini|docked)|video-?(sticky|floating|float|docked|dock))-/],
  ["appBanner", /-(smartbanner|smart-banner|app-?banner|app-?promo|install-?app|get-?the-?app|branch-banner)/],
  // Not "scroll-up": a header that shows again on scrolling up is named so ("header--scroll-up").
  ["backToTop", /-(back-?to-?top|scroll-?to-?top|scrolltop|go-?top|to-?top|nahoru)-/],
];

/** What a small floating box says it is, by its words or its labels (an icon button has only aria-label or title). */
const FLOAT_WORDS: [ClutterKind, RegExp][] = [
  ["backToTop", /^(\^|↑|⬆|▲|top|nahoru|na za[čc][áa]tek)$|(?<!\p{L})(back to top|scroll to top|go to top|zp[ěe]t nahoru|nahoru)(?!\p{L})/iu],
  ["feedback", /(?<!\p{L})(feedback|zp[ěe]tn[áa] vazba|v[áa][šs] n[áa]zor|ohodno[tť]te|rate us)(?!\p{L})/iu],
  ["chat", /(?<!\p{L})(chat|live chat|chatujte|napi[šs]te n[áa]m|need help|can we help|how can we help|pot[řr]ebujete poradit|m[áa]te dotaz|zeptejte se)(?!\p{L})/iu],
];
const APP_WORDS = /(?<!\p{L})(get the app|download the app|open in (the )?app|use the app|install the app|app store|google play|st[áa]hn[ěe]te si (na[šs]i )?aplikaci|otev[řr][íi]t v aplikaci)(?!\p{L})/iu;

/** A video host's player in a frame: a floating box holding one is a floating video. */
const VIDEO_HOSTS = /(youtube(-nocookie)?\.com\/embed|player\.vimeo\.com|dailymotion\.com\/embed|jwplayer|jwplatform|brightcove|videoplayer)/i;

const AD_HOSTS = /(doubleclick|googlesyndication|googletagservices|adservice|adform|ssp\.seznam|sklik|criteo|taboola|outbrain|amazon-adsystem|adnxs|rubiconproject|pubmatic|smartadserver)\./i;

function tokens(el: Element): string[] {
  return `${attr(el, "class")} ${attr(el, "id")}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function kindByTokens(el: Element): ClutterKind | null {
  if (CONSENT_VENDORS.test(`${attr(el, "class")} ${attr(el, "id")}`)) return "cookie";
  const toks = tokens(el);
  const joined = `-${toks.join("-")}-`;
  for (const [kind, re] of WIDGETS) if (re.test(joined)) return kind;
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

/** The start of the element's text (its textContent), at least `min` characters of it when it has that many. Reads
 *  text node by text node and stops there: a box around a whole page is not read whole to judge its first words. */
function textStart(el: Element, min: number): string {
  let out = "";
  const walker = el.ownerDocument.createTreeWalker(el, 12 /* NodeFilter.SHOW_TEXT | SHOW_CDATA_SECTION */);
  for (let n = walker.nextNode(); n && out.length < min; n = walker.nextNode()) out += n.nodeValue ?? "";
  return out;
}

/** Whether the element has any text that is not white space (as `collapse(el.textContent)` would say, without reading
 *  all of it). */
function hasText(el: Element): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, 12 /* NodeFilter.SHOW_TEXT | SHOW_CDATA_SECTION */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\S/.test(n.nodeValue ?? "")) return true;
  return false;
}

/** Only the first 600 characters: a cookie notice is short, and an outer box full of text is judged by its class. */
const shortText = (el: Element): string => collapse(textStart(el, 600).slice(0, 600));

function kindByText(el: Element): ClutterKind | null {
  const text = shortText(el);
  if (!text || text.length >= 600) return null;
  for (const [kind, re] of TEXT_KINDS) if (re.test(text)) return kind;
  return null;
}

/** The words a person or a screen reader gets from a small box: its text, then its labels. */
function floatWords(el: Element): string {
  // Text node by text node, so "aplikaci</p><a>Otevřít" stays two words.
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(), len = 0; n && len < 600; n = walker.nextNode()) { parts.push(n.nodeValue ?? ""); len += (n.nodeValue ?? "").length; }
  const labels = [el, ...Array.from(el.querySelectorAll("[aria-label], [title], img[alt]")).slice(0, 8)]
    .map((e) => `${attr(e, "aria-label")} ${attr(e, "title")} ${tag(e) === "img" ? attr(e, "alt") : ""}`).join(" ");
  return collapse(`${parts.join(" ")} ${labels}`).slice(0, 300);
}

/** A video in the box: a <video>, or a video host's player in a frame. */
const holdsVideo = (el: Element): boolean =>
  !!el.querySelector("video") || [el, ...Array.from(el.querySelectorAll("iframe"))].some((f) => tag(f) === "iframe" && VIDEO_HOSTS.test(attr(f, "src")));

type Place = "corner" | "edge" | "bar" | "free";

/** How a fixed box sits in the window: docked to a corner (a chat bubble, a mini player), to a side edge (a feedback
 *  tab), a bar across the window (a header, an app banner), or anything else. Null without layout. */
function placeOf(b: ClutterBox | null): Place | null {
  if (!b || b.winWidth <= 0 || b.winHeight <= 0 || b.width <= 0 || b.height <= 0) return null;
  if (b.width >= b.winWidth * 0.6) return "bar";
  const small = b.width <= Math.min(460, b.winWidth * 0.5) && b.height <= b.winHeight * 0.5
    && (b.width * b.height) / (b.winWidth * b.winHeight) <= 0.15;
  if (!small) return "free";
  const near = 140; // px from an edge of the window
  const side = b.left <= near || b.winWidth - (b.left + b.width) <= near;
  const end = b.top <= near || b.winHeight - (b.top + b.height) <= near;
  if (side && end) return "corner";
  if (side && b.width <= 72) return "edge";
  return "free";
}

/** A fixed box with no telling name: what it is by what it holds, its words and its place. Null: nothing says. */
function floatKind(el: Element, place: Place | null): ClutterKind | null {
  const words = floatWords(el);
  // An app banner is a bar across the top or the bottom of the window; its words say it ("Get the app").
  if (place === "bar") return APP_WORDS.test(words) ? "appBanner" : null;
  if (place !== "corner" && place !== "edge") return null;
  if (holdsVideo(el)) return "player";
  for (const [kind, re] of FLOAT_WORDS) if (re.test(words)) return kind;
  if (APP_WORDS.test(words)) return "appBanner";
  // No words at all: a link to the top of the page is a back-to-top arrow; a frame in a corner is a chat window.
  if (!hasText(el)) {
    const link = tag(el) === "a" ? el : el.querySelector("a[href]");
    if (link && /^#(top|page|header|main|content|body|nahoru)?$/i.test(attr(link, "href"))) return "backToTop";
    if (place === "corner" && (tag(el) === "iframe" || el.querySelector("iframe"))) return "chat";
  }
  return null;
}

/** What an element that is not content is. `overlay`: it floats over the page (fixed or sticky); `place`: where a
 *  fixed one sits in the window (null when unknown). */
function kindOf(el: Element, overlay: boolean, place: Place | null = null): ClutterKind {
  // A menu, a footer or a dialog says what it is by its element; its words ("Subscribe now") do not change that. A
  // header or an aside is only a box, so what it says comes first ("We use cookies", "Advertisement").
  const role = kindByRole(el);
  const semantic = role === "menu" || role === "footer" || role === "popup" ? role : null;
  return kindByTokens(el) ?? semantic ?? kindByText(el) ?? (overlay ? floatKind(el, place) : null) ?? role ?? (overlay ? "popup" : "other");
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
  tag(el) === "iframe" || hasText(el) || !!el.querySelector(MEDIA);

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
 * text (`body`) or is mostly links without the headline. Inside a `keep` element that has blocks of its own, only such
 * a self-named block that holds no content goes. Nothing that holds a `protect` element is ever returned. With no
 * `keep` there is nothing to protect, so nothing is returned.
 */
export function findClutter(doc: Document, opts: ClutterOptions): ClutterItem[] {
  const body = doc.body;
  if (!body || opts.keep.length === 0) return [];
  const shown = opts.shown ?? ((el: Element) => !isHidden(el));
  const position = opts.position ?? inlinePosition;
  const rendered = opts.rendered ?? (() => true);

  const covers = opts.covers ?? (() => 0);
  const box = opts.box ?? (() => null);
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

  // 1. Overlays, anywhere. Every element of the body is asked its position, except where nothing can be found: inside
  // content (nothing inside a `keep` element is an overlay), inside what draws nothing (display: none, a script, an
  // icon's drawing), so a big page is not asked about its thousands of hidden and icon parts.
  const walker = doc.createTreeWalker(body, 1 /* NodeFilter.SHOW_ELEMENT */);
  /** Moves past the current element's inside, to what follows it; null at the end of the body. */
  const skipInside = (): Node | null => {
    for (let n: Node | null = walker.currentNode; n && n !== body; n = walker.parentNode()) {
      const next = walker.nextSibling();
      if (next) return next;
    }
    return null;
  };
  for (let n: Node | null = walker.firstChild(); n;) {
    const el = n as Element;
    const t = tag(el);
    if (keep.has(el) || (CLOSED.has(t) && !(t === "svg" && el.querySelector("foreignObject")))) { n = skipInside(); continue; }
    if (SILENT.has(t)) { n = walker.nextNode(); continue; }
    if (!rendered(el)) { n = skipInside(); continue; }
    const pos = position(el);
    if (pos === "fixed" || pos === "sticky") {
      if (eligible(el)) add(el, kindOf(el, true, pos === "fixed" ? placeOf(box(el)) : null));
      // A backdrop: nothing in it, but it greys out the page behind a dialog.
      else if (!chain.has(el) && !insideKeep(el) && !hasSubstance(el) && covers(el) >= 0.3 && shown(el)) add(el, "popup");
    }
    n = walker.nextNode();
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
  /** `strongOnly`: on a thin page only what names itself plainly (ads, cookie notices, share bars...) goes. `inRead`:
   *  `el` sits inside a box the page reader read text from, and holds none of its content (it is off the chain). */
  const scanInside = (el: Element, strongOnly = false, inRead = false): void => {
    const kind = looksLikeClutter(el);
    if (kind && (!strongOnly || STRONG.has(kind))) {
      if (inRead ? !chain.has(el) && hasSubstance(el) && shown(el) : eligible(el)) add(el, kind);
      return;
    }
    for (const c of Array.from(el.children)) if (!SILENT.has(tag(c))) scanInside(c, strongOnly, inRead);
  };
  // A box the page reader read text from (an <article> with a bare line of text of its own, a box around an inline
  // <marquee>) is content, and so is all of it; but what names itself plainly among its blocks (an ad, a share bar, a
  // sign-up) still goes, as inside the main column. Only its blocks and what the reader skipped as noise: what the
  // reader ran into the box's own text (an inline "Advertisement" word) is that text. A box with no blocks of its own
  // (a paragraph) is text only. A block that holds any content is on the chain, so it never goes this way.
  const scanRead = (e: Element): void => {
    if (keep.has(e) && !Array.from(e.children).some((c) => BLOCKISH.has(tag(c)))) return;
    for (const c of Array.from(e.children)) {
      if (chain.has(c) || SILENT.has(tag(c)) || !(BLOCKISH.has(tag(c)) || isNoise(c))) continue;
      scanInside(c, true, true);
    }
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
    if (e === doc.documentElement) continue;
    if (insideKeep(e)) { scanRead(e); continue; }
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
