// Small DOM helpers shared by page and form extraction. DOM types only; no browser-only globals are assumed.

export const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "iframe", "canvas", "object", "embed", "head"]);

/** Elements that start a new visual block; used to keep words apart and to split inline runs from blocks. */
export const BLOCKISH = new Set([
  "address", "article", "aside", "blockquote", "details", "dialog", "div", "dl", "dt", "dd", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
  "section", "table", "tbody", "thead", "tfoot", "tr", "td", "th", "caption", "ul", "summary", "img", "picture",
  "legend", "label", "select", "textarea", "input", "button",
]);

const NOISE_TOKENS = new Set([
  "cookie", "cookies", "cookiebanner", "cookienotice", "consent", "gdpr", "advert", "advertisement", "ad", "ads",
  "adsbygoogle", "sponsored", "popup", "modal", "newsletter", "sidebar", "breadcrumb", "breadcrumbs", "share",
  "sharing", "social",
]);
const NOISE_ROLES = new Set(["navigation", "banner", "complementary", "contentinfo", "dialog", "alertdialog", "search"]);

export const tag = (el: Element): string => el.localName.toLowerCase();
export const attr = (el: Element, name: string): string => el.getAttribute(name) ?? "";
export const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

export function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (attr(el, "aria-hidden").toLowerCase() === "true") return true;
  if (tag(el) === "input" && attr(el, "type").toLowerCase() === "hidden") return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attr(el, "style"));
}

/** Noise = navigation, headers/footers, asides, banners, ads, dialogs. A header inside an article or main is content. */
export function isNoise(el: Element): boolean {
  const t = tag(el);
  if (t === "nav" || t === "aside" || t === "footer" || t === "dialog") return true;
  if (t === "header" && !el.parentElement?.closest("article, main")) return true;
  const role = attr(el, "role").toLowerCase();
  if (role === "banner" ? !el.parentElement?.closest("article, main") : NOISE_ROLES.has(role)) return true;
  if (attr(el, "aria-modal").toLowerCase() === "true") return true;
  const tokens = `${attr(el, "class")} ${attr(el, "id")}`.toLowerCase().split(/[\s_-]+/);
  return tokens.some((tok) => NOISE_TOKENS.has(tok));
}

/** The element's parent, or the host of the open shadow root it sits at the top of. */
export function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode as (Node & { host?: Element }) | null;
  return root && root.nodeType === 11 && root.host ? root.host : null;
}

/** The element with this id in the same tree as `el` (its document, or its shadow root). */
export function byId(el: Element, id: string): Element | null {
  const root = el.getRootNode() as Node & { getElementById?: (id: string) => Element | null };
  if (typeof root.getElementById === "function") return root.getElementById(id);
  return null;
}

/** Lower case without diacritics, for comparing words across spellings ("Měsíc" and "mesic"). */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const blockedCache = new WeakMap<Element, boolean>();
/** True when the element or any ancestor (across shadow roots, to the host) is hidden or noise. */
export function blocked(el: Element): boolean {
  const known = blockedCache.get(el);
  if (known !== undefined) return known;
  const tg = tag(el);
  const parent = parentOf(el);
  const result = tg === "html" || tg === "body" ? false : isHidden(el) || isNoise(el) || (parent ? blocked(parent) : false);
  blockedCache.set(el, result);
  return result;
}

/** Visible text of a node with scripts, styles and hidden parts left out. Words never fuse across blocks.
 *  `includeHidden` keeps hidden parts: the accessible-name rules read a hidden element that aria-labelledby names. */
export function textOf(node: Node, skip?: (el: Element) => boolean, includeHidden = false): string {
  const parts: string[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === 3) {
      parts.push(n.nodeValue ?? "");
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const t = tag(el);
    if (SKIP_TAGS.has(t) || (!includeHidden && isHidden(el)) || skip?.(el)) return;
    if (t === "br") {
      parts.push(" ");
      return;
    }
    const block = BLOCKISH.has(t);
    if (block) parts.push(" ");
    for (const c of Array.from(el.childNodes)) walk(c);
    if (block) parts.push(" ");
  };
  walk(node);
  return collapse(parts.join(""));
}

export function pageLang(doc: Document): string {
  const raw = (doc.documentElement.getAttribute("lang") ?? "").trim().toLowerCase();
  const primary = raw.split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(primary) ? primary : "und";
}
