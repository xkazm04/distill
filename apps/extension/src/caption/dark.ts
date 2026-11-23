// Round 3, card 6 (r3-06): dark page. The page's own colours darkened with care, never by inverting everything:
// - a light background becomes a dark one of the same hue (a pale yellow note stays a dark yellowish note);
// - text whose contrast on its new background falls below 4.5:1 (engine contrast.ts) turns light, keeping its hue, only
//   as far as it must; text that already reads (white on a dark header) keeps its colour;
// - photos, videos, maps (frames), canvases, SVG (logos, icons) and background images keep their colours: nothing is
//   filtered, those elements are never marked, and text over a picture is left as the page made it;
// - a page that is already dark is left alone (`alreadyDark`).
// Every change is one Distill stylesheet plus a `data-distill-dark` attribute per changed element, under
// html[data-distill-dark-on]:not([data-distill-original]): Original shows the page's own colours, and off (or close)
// removes the stylesheet and every attribute, so the page is back exactly. New parts of the page (a single-page app's
// next view, a lazy list) are darkened as they come in.
import { composite, contrastRatio, cssColor, luminance, parseColor, readableOn, type Rgba } from "@distill/engine";

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** On each element given new colours: its rule's id ("d0"). */
const MARK = "data-distill-dark";
/** On <html> while the page is dark. */
const ON = "data-distill-dark-on";
const ORIGINAL = "data-distill-original";
/** Body text must read at least this well on its new background (WCAG AA). */
export const MIN_CONTRAST = 4.5;
/** A page whose background under its main text is darker than this is dark already (relative luminance). */
const DARK_ALREADY = 0.2;
/** At most this many elements are looked at in one pass (a huge page stays responsive). */
const MAX_ELEMENTS = 20_000;

/** Never marked and never looked into: they keep their own colours. */
const KEEP = new Set(["img", "picture", "video", "audio", "canvas", "svg", "iframe", "frame", "object", "embed", "math", "map", "script", "style", "noscript", "template", "head", "meta", "link", "distill-caption"]);

// ---- Colours (pure) ---------------------------------------------------------------------------------------------------

function toHsl(c: Rgba): [number, number, number] {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number, a = 1): Rgba {
  const k = (n: number) => (n + h / 30) % 12;
  const x = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - x * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return { r: f(0), g: f(8), b: f(4), a };
}

/** A light background made dark, same hue, a little less vivid; null when it is dark enough already (kept). White
 *  becomes about #181a1b; a light grey panel stays a step lighter than the page around it. */
export function darkBackground(c: Rgba): Rgba | null {
  const [h, s, l] = toHsl(c);
  if (l < 0.4) return null;
  return fromHsl(h, s * (l > 0.9 ? 0.5 : 0.75), 0.09 + (1 - l) * 0.55, c.a);
}

/** A light border made dark the same way, a little lighter than a background so it still shows. */
export function darkBorder(c: Rgba): Rgba | null {
  const [h, s, l] = toHsl(c);
  if (l < 0.4) return null;
  return fromHsl(h, s * 0.6, 0.2 + (1 - l) * 0.45, c.a);
}

/** Text for a dark background: kept when it reads (>= 4.5:1), else its lightness turned around (dark grey -> light
 *  grey, a dark link blue -> a light blue) and then made just light enough to pass. `bg` is opaque. */
export function darkText(fg: Rgba, bg: Rgba): Rgba | null {
  if (contrastRatio(fg, bg) >= MIN_CONTRAST) return null;
  const [h, s, l] = toHsl(fg.a < 1 ? composite(fg, WHITE) : fg);
  const turned = fromHsl(h, s, Math.max(1 - l, 0.6));
  return readableOn(turned, bg, MIN_CONTRAST) ?? turned;
}

/** Light enough to count as a light background (one a person reads dark text on). */
const isLight = (c: Rgba): boolean => luminance(c) > 0.35;

const same = (a: Rgba, b: Rgba): boolean => Math.round(a.r) === Math.round(b.r) && Math.round(a.g) === Math.round(b.g) && Math.round(a.b) === Math.round(b.b) && Math.abs(a.a - b.a) < 0.01;

// ---- The page -----------------------------------------------------------------------------------------------------------

/** What one element looked like and looks like now: the backgrounds under its text (opaque), and its text colour. */
interface Seen { origBg: Rgba; newBg: Rgba; overPicture: boolean; origFg: Rgba | null; newFg: Rgba | null }

interface State {
  doc: Document;
  style: HTMLStyleElement;
  rules: Map<string, string>;
  seen: WeakMap<Element, Seen>;
  marked: Set<Element>;
  observer: MutationObserver | null;
  timer: number;
  /** The page's dark base: what a white page becomes. */
  base: Rgba;
}
let state: State | null = null;

/** What is behind `el` as the person sees it: its own and its ancestors' backgrounds composited over the canvas (white,
 *  unless the page asked for a dark scheme only and set no colour: the browser's dark). Null over a picture. */
function behind(doc: Document, win: Window, el: Element): Rgba | null {
  const layers: Rgba[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = win.getComputedStyle(e);
    const c = parseColor(cs.backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    if (/url\(/i.test(cs.backgroundImage ?? "")) return null;
  }
  const scheme = win.getComputedStyle(doc.documentElement).colorScheme ?? "";
  let bg: Rgba = /dark/.test(scheme) && !/light/.test(scheme) ? { r: 18, g: 18, b: 18, a: 1 } : WHITE;
  for (let i = layers.length - 1; i >= 0; i--) bg = composite(layers[i] as Rgba, bg);
  return bg;
}

/**
 * The page's background under its main text: the median (by luminance) of what is behind its text blocks (paragraphs,
 * list items, cells, headings with 30+ characters, up to 40 of them). Never the point at the middle of the window, which
 * on a video page is the black player. Without text: the body's.
 */
export function pageBackground(doc: Document, win: Window): Rgba {
  const found: Rgba[] = [];
  for (const el of Array.from(doc.querySelectorAll("p, li, td, dd, blockquote, h1, h2, h3"))) {
    if (found.length >= 40) break;
    if ((el.textContent ?? "").trim().length < 30 || el.closest("distill-caption, [data-distill-hide]")) continue;
    if (win.getComputedStyle(el).display === "none" || !el.getClientRects().length) continue;
    const bg = behind(doc, win, el);
    if (bg) found.push(bg);
  }
  if (!found.length) return behind(doc, win, doc.body ?? doc.documentElement) ?? WHITE;
  found.sort((a, b) => luminance(a) - luminance(b));
  return found[Math.floor(found.length / 2)] as Rgba;
}

/** The page is dark already: the background under its main text is dark. */
export const isAlreadyDark = (doc: Document, win: Window): boolean => luminance(pageBackground(doc, win)) < DARK_ALREADY;

/** True while the page is dark (Distill's darkening is on). */
export const darkOn = (doc: Document): boolean => doc.documentElement.hasAttribute(ON);

/** The element holds text of its own (a text node with letters or digits as a direct child), or is a form field. */
function ownText(el: Element): boolean {
  if (/^(input|textarea|select|button)$/.test(el.localName)) return true;
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.nodeValue ?? "")) return true;
  return false;
}

/** A background image: a picture (url) keeps its colours; a gradient's light colours are darkened in place. */
function gradientDark(image: string): string | null {
  if (image === "none" || /url\(/i.test(image) || !/gradient\(/i.test(image)) return null;
  const colours = image.match(/rgba?\([^)]*\)/gi) ?? [];
  const parsed = colours.map(parseColor).filter((c): c is Rgba => !!c);
  if (!parsed.length || parsed.reduce((n, c) => n + luminance(c), 0) / parsed.length < 0.35) return null;
  return image.replace(/rgba?\([^)]*\)/gi, (m) => {
    const c = parseColor(m);
    const d = c ? darkBackground(c) : null;
    return d ? cssColor(d) : m;
  });
}

/** One rule per distinct set of new colours: elements share it by id. */
function ruleId(s: State, decl: string): string {
  let id = s.rules.get(decl);
  if (!id) {
    id = `d${s.rules.size}`;
    s.rules.set(decl, id);
    s.style.textContent += `html[${ON}]:not([${ORIGINAL}]) [${MARK}="${id}"][${MARK}="${id}"] { ${decl} }\n`;
  }
  return id;
}

/** Looks at `el` and below, under a parent that looked like `parent`. Marks what must change. */
function visit(s: State, win: Window, el: Element, parent: Seen, budget: { n: number }): void {
  if (budget.n-- <= 0 || KEEP.has(el.localName) || el.hasAttribute("data-distill-spacer")) return;
  const cs = win.getComputedStyle(el);
  if (cs.display === "none") return; // not looked at until it shows (a menu that opens later stays as it is)
  const decl: string[] = [];

  // The background.
  const bg = parseColor(cs.backgroundColor);
  const image = cs.backgroundImage;
  const picture = /url\(/i.test(image);
  let origBg = parent.origBg;
  let newBg = parent.newBg;
  let overPicture = parent.overPicture;
  if (bg && bg.a > 0) {
    origBg = composite(bg, parent.origBg);
    const d = isLight(composite(bg, WHITE)) ? darkBackground(bg) : null;
    newBg = composite(d ?? bg, parent.newBg);
    if (d) decl.push(`background-color: ${cssColor(d)} !important;`);
    if (bg.a >= 0.9) overPicture = false;
  }
  const grad = gradientDark(image);
  if (grad) decl.push(`background-image: ${grad} !important;`);
  if (picture) overPicture = true;

  // The borders that show.
  for (const side of ["top", "right", "bottom", "left"] as const) {
    if (cs.getPropertyValue(`border-${side}-style`) === "none" || parseFloat(cs.getPropertyValue(`border-${side}-width`)) === 0) continue;
    const c = parseColor(cs.getPropertyValue(`border-${side}-color`));
    const d = c && c.a > 0 && isLight(composite(c, WHITE)) ? darkBorder(c) : null;
    if (d) decl.push(`border-${side}-color: ${cssColor(d)} !important;`);
  }

  // The text: what it would inherit now, and what reads on its new background.
  const origFg = parseColor(cs.color);
  let newFg = origFg;
  if (origFg) {
    // Over a picture the page's own colour stays (its background is the picture, not a colour); else it must read.
    const fixed = overPicture ? null : darkText(origFg, newBg);
    newFg = fixed ?? origFg;
    // Set here when it changes, and also when it stays but would otherwise inherit the parent's new colour.
    const inherits = !!parent.origFg && !!parent.newFg && same(origFg, parent.origFg) && !same(parent.newFg, parent.origFg);
    if (!same(newFg, origFg) || (inherits && (ownText(el) || el.firstElementChild))) decl.push(`color: ${cssColor(newFg)} !important;`);
    if (fixed && /^(input|textarea|select)$/.test(el.localName)) decl.push(`caret-color: ${cssColor(newFg)} !important;`);
  }

  const seen: Seen = { origBg, newBg, overPicture, origFg, newFg };
  s.seen.set(el, seen);
  if (decl.length) {
    el.setAttribute(MARK, ruleId(s, decl.join(" ")));
    s.marked.add(el);
  }
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) visit(s, win, c, seen, budget);
  if (el.shadowRoot) for (let c = el.shadowRoot.firstElementChild; c; c = c.nextElementSibling) visit(s, win, c, seen, budget);
}

/** What the nearest looked-at ancestor saw (a part that came in later starts from there). */
function seenAbove(s: State, el: Element): Seen | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const got = s.seen.get(p);
    if (got) return got;
  }
  return null;
}

function darken(doc: Document, win: Window): void {
  const style = doc.createElement("style");
  style.setAttribute("data-distill", "dark");
  const base = darkBackground(WHITE) ?? BLACK;
  // The canvas and the browser's own controls (scroll bars, form fields) go dark too.
  style.textContent = `html[${ON}]:not([${ORIGINAL}]) { color-scheme: dark !important; background-color: ${cssColor(base)} !important; }\n`;
  (doc.head ?? doc.documentElement).append(style);
  const s: State = { doc, style, rules: new Map(), seen: new WeakMap(), marked: new Set(), observer: null, timer: 0, base };
  state = s;

  // The root: the page's canvas as it is now (white unless coloured), and what it becomes.
  const rootBg = pageCanvas(doc, win);
  const root: Seen = { origBg: rootBg, newBg: isLight(rootBg) ? base : rootBg, overPicture: false, origFg: null, newFg: null };
  const budget = { n: MAX_ELEMENTS };
  const html = doc.documentElement;
  // <html> itself: its own text colour, if any, is handled with the body's children.
  s.seen.set(html, root);
  if (doc.body) visit(s, win, doc.body, root, budget);
  html.setAttribute(ON, "");

  // New parts of the page, and parts that change later (a menu that opens, a box whose class or style changes), are
  // darkened as they come in or change (batched).
  const pending = new Set<Element>();
  s.observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") { if (r.target.nodeType === 1) pending.add(r.target as Element); continue; }
      for (const n of Array.from(r.addedNodes)) if (n.nodeType === 1) pending.add(n as Element);
    }
    if (!pending.size || s.timer) return;
    s.timer = win.setTimeout(() => {
      s.timer = 0;
      if (state !== s) return;
      const list = Array.from(pending);
      pending.clear();
      lookAgain(s, win, list);
    }, 200);
  });
  if (doc.body) s.observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: FOLLOW });
}

/** The attributes whose change can change an element's colours or whether it shows. */
const FOLLOW = ["class", "style", "hidden", "open"];
/** A changed part with at most this many elements inside is looked at again whole; a bigger one (the body taking a
 *  class on scroll) only itself and the parts inside it that were never looked at (they were hidden then). */
const WHOLE_AGAIN = 400;

/**
 * Looks again at parts that came in or changed (r4-01). A part never looked at starts from the highest part above it
 * that was not looked at either (a link inside a menu that was closed starts from the menu). A changed part that was
 * looked at loses its marks first, so its colours are read as the page now makes them.
 */
function lookAgain(s: State, win: Window, els: readonly Element[]): void {
  const roots = new Set<Element>();
  for (const el of els) {
    if (!el.isConnected || el.closest("distill-caption") || KEEP.has(el.localName)) continue;
    let top = el;
    while (top.parentElement && !s.seen.has(top) && !s.seen.has(top.parentElement)) top = top.parentElement;
    if (!top.parentElement || !s.seen.has(top.parentElement)) continue; // outside what was looked at (a detached tree)
    roots.add(top);
  }
  // A part inside another that is looked at again goes with it.
  const all = Array.from(roots);
  const list = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
  const budget = { n: MAX_ELEMENTS };
  for (const el of list) {
    const above = seenAbove(s, el);
    if (!above) continue;
    if (!s.seen.has(el) || el.getElementsByTagName("*").length <= WHOLE_AGAIN) {
      unmark(s, el, true);
      visit(s, win, el, above, budget);
      continue;
    }
    // A big part: itself again, its children as they were, and inside it what shows now but was never looked at.
    unmark(s, el, false);
    visit(s, win, el, above, { n: 1 });
    if (!s.seen.has(el)) continue; // it no longer shows
    const walk = (p: Element) => {
      for (let c = p.firstElementChild; c; c = c.nextElementSibling) {
        if (budget.n <= 0) return;
        if (s.seen.has(c)) walk(c);
        else { const up = seenAbove(s, c); if (up) visit(s, win, c, up, budget); }
      }
    };
    walk(el);
  }
}

/** Takes Distill's mark off `el` (and below when `deep`) and forgets what was seen there. */
function unmark(s: State, el: Element, deep: boolean): void {
  const all = deep ? [el, ...Array.from(el.querySelectorAll(`[${MARK}]`))] : [el];
  for (const e of all) {
    e.removeAttribute(MARK);
    s.marked.delete(e);
    s.seen.delete(e);
  }
}

/** The canvas colour: the root's background, else body's (CSS propagates it), else white. */
function pageCanvas(doc: Document, win: Window): Rgba {
  const root = parseColor(win.getComputedStyle(doc.documentElement).backgroundColor);
  if (root && root.a > 0) return composite(root, WHITE);
  return WHITE;
}

/** Off: the stylesheet and every attribute go; the page has its own colours back exactly. */
export function clearDark(doc: Document): void {
  if (state) {
    state.observer?.disconnect();
    if (state.timer) clearTimeout(state.timer);
    for (const el of state.marked) el.removeAttribute(MARK);
    state.style.remove();
    state = null;
  }
  // Anything left from an earlier content script on this page (re-injected): the same marks.
  for (const el of Array.from(doc.querySelectorAll(`[${MARK}]`))) el.removeAttribute(MARK);
  doc.querySelectorAll(`style[data-distill="dark"]`).forEach((el) => el.remove());
  doc.documentElement.removeAttribute(ON);
}

/**
 * Dark page on (true) or off (false). A page that is dark already is left alone: `{ dark: false, alreadyDark: true }`.
 * Turning it on twice changes nothing more.
 */
export function setDark(doc: Document, win: Window, on: boolean): { dark: boolean; alreadyDark: boolean } {
  if (!on) {
    clearDark(doc);
    return { dark: false, alreadyDark: false };
  }
  if (state && state.doc === doc && darkOn(doc)) return { dark: true, alreadyDark: false };
  // Judged on the page's own colours (Original showing or not, the reading stays the page's).
  if (isAlreadyDark(doc, win)) return { dark: false, alreadyDark: true };
  darken(doc, win);
  return { dark: true, alreadyDark: false };
}
