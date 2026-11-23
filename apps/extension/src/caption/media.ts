// r5-06 Pictures in the cleaned page. After first sight (page.ts afterFirstSight) and again when Stay clean follows the
// page, on the main column only:
// - a picture wider than the column fits it, its shape kept (a stretched one gets its own proportions back);
// - a caption under a picture gets a readable size and a little room;
// - a gallery (four or more pictures side by side, in a row or a grid) shows its first picture and "+29 photos", which
//   opens the rest in place;
// - a lazy picture that never loaded gets the address the page itself keeps for it (data-src / data-srcset: what the page
//   does on scroll), a native lazy one with no box yet loads now (it would jump in later), and a picture that never
//   loaded and has nothing to load leaves no empty box;
// - space is reserved from the picture's own width and height, so nothing jumps as it arrives.
// Logos and icons are left as they are. Original shows the page as it was (every rule is scoped off it, and the gallery's
// button hides); Close puts back every attribute Distill set, the pictures' addresses included.

const MEDIA = "data-distill-media";
/** On a picture whose space Distill reserves: its rule id (aspect-ratio from its own width and height). */
const RATIO = "data-distill-media-ratio";
/** On a caption Distill spaces or sizes: its rule id. */
const CAPTION = "data-distill-media-caption";
/** On a gallery Distill folded: its id ("g0"). */
const GALLERY = "data-distill-gallery";
/** On the button (or the list item holding it) that opens a folded gallery. */
const OPEN = "data-distill-gallery-open";
/** On a picture (or a <source>) whose address Distill set from the page's own lazy attributes. */
const LAZY = "data-distill-lazy";
const ORIGINAL = "data-distill-original";
const HIDE = "data-distill-hide";
const ON = `html:not([${ORIGINAL}])`;

/** A gallery folds from this many pictures side by side. */
export const GALLERY_MIN = 4;
/** A picture smaller than this both ways (px) is an icon, a badge or a logo. */
const ICON_MAX = 120;
/** A caption smaller than this (px) is raised to it. */
const CAPTION_MIN = 14;
const ICON_WORDS = /logo|icon|avatar|emoji|badge|sprite|spinner|loader|pixel|tracking|flag|button|rating|stars?(?![a-z])/i;
const PLACEHOLDER = /(^|[/_.-])(blank|placeholder|spacer|transparent|lazy|loading|grey|gray|empty|1x1|pixel|dummy)[^/]*\.(gif|png|jpe?g|svg|webp)(\?|$)/i;
const LAZY_SRC = ["data-src", "data-lazy-src", "data-original", "data-lazy"];
const LAZY_SRCSET = ["data-srcset", "data-lazy-srcset"];

const CSS = [
  `${ON} [${MEDIA}~="fit"], ${ON} [${MEDIA}~="box"] { max-width: 100% !important; }`,
  `${ON} [${MEDIA}~="shape"] { height: auto !important; }`,
  `${ON} [${MEDIA}~="more"], ${ON} [${MEDIA}~="empty"] { display: none !important; }`,
  `${ON} [${MEDIA}~="first"] { grid-column: 1 / -1 !important; flex: 1 1 100% !important; max-width: 100% !important; }`,
  `html[${ORIGINAL}] [${OPEN}] { display: none !important; }`,
].join("\n");

interface Lazy { el: Element; was: Record<string, string | null>; set: Record<string, string> }
interface Gallery { id: string; container: Element; items: Element[]; opener: Element; pictures: number }

let state: {
  doc: Document;
  style: HTMLStyleElement;
  rules: Map<string, string>;
  galleries: Gallery[];
  lazy: Lazy[];
  listeners: { el: Element; type: string; fn: () => void }[];
  counts: { fit: number; shape: number; captions: number; ratio: number; empty: number };
  /** The column the last pass ran on, and its pictures (wakeMedia goes through them). */
  scope?: Element;
  pics: Element[];
  /** The last pass's context, and the window's resize listener that runs the pass again (a phone turned, a window
   *  narrowed: a picture that fits at 1440 can overflow or be squeezed at 390). */
  ctx?: Parameters<typeof applyMedia>[0];
  onResize?: () => void;
  timer?: number;
} | null = null;
/** Galleries the person opened: they stay open when Stay clean runs the pass again. */
let opened = new WeakSet<Element>();

const tokens = (el: Element): string[] => (el.getAttribute(MEDIA) ?? "").split(" ").filter(Boolean);
function token(el: Element, t: string): void {
  const now = tokens(el);
  if (!now.includes(t)) el.setAttribute(MEDIA, [...now, t].join(" "));
}
function untoken(el: Element, t: string): void {
  const now = tokens(el).filter((x) => x !== t);
  if (now.length) el.setAttribute(MEDIA, now.join(" "));
  else el.removeAttribute(MEDIA);
}
const attrNum = (el: Element, ...names: string[]): number => {
  for (const n of names) { const v = Number.parseFloat(el.getAttribute(n) ?? ""); if (v > 0) return v; }
  return 0;
};

/** One rule per look, keyed on an attribute value (like comfort.ts). */
function ruleFor(attr: string, prefix: string, body: string): string {
  const s = state as NonNullable<typeof state>;
  const key = `${attr}|${body}`;
  let id = s.rules.get(key);
  if (!id) {
    id = `${prefix}${s.rules.size}`;
    s.rules.set(key, id);
    s.style.textContent += `\n${ON} [${attr}="${id}"] { ${body} }`;
  }
  return id;
}

/** A logo, an icon, a badge: small, named so, or in the page's header, menu or footer. */
function iconLike(el: Element, win: Window): boolean {
  if (el.closest("header, nav, footer, [role=banner], [role=navigation], [role=contentinfo]")) return true;
  const src = el.getAttribute("src") ?? "";
  const words = `${src.split(/[?#]/)[0]?.split("/").pop() ?? ""} ${el.getAttribute("class") ?? ""} ${el.id} ${el.getAttribute("alt") ?? ""}`;
  if (ICON_WORDS.test(words)) return true;
  // A lazy picture still showing its stand-in: its size now says nothing about the picture.
  if (el.localName === "img" && [...LAZY_SRC, ...LAZY_SRCSET].some((a) => el.hasAttribute(a)) && placeholder(el as HTMLImageElement)) return false;
  const r = el.getBoundingClientRect();
  const w = Math.max(r.width, attrNum(el, "width", "data-width")), h = Math.max(r.height, attrNum(el, "height", "data-height"));
  if ((w > 0 || h > 0) && w < ICON_MAX && h < ICON_MAX) return true;
  if (/\.svg(\?|#|$)/i.test(src) && w < 200) return true;
  return win.getComputedStyle(el).display === "none";
}

/** The picture's address is a stand-in: none, a data: picture, a blank or spacer file, or a picture of a pixel. */
function placeholder(img: HTMLImageElement): boolean {
  const src = (img.getAttribute("src") ?? "").trim();
  if (!src || src === "about:blank" || src.startsWith("data:") || PLACEHOLDER.test(src)) return true;
  return img.complete && img.naturalWidth > 0 && img.naturalWidth <= 2;
}

/** The page's own address for a lazy attribute, when it is an ordinary web address (never a script or a data blob). */
function pageUrl(el: Element, value: string | null, set: boolean): string | null {
  if (!value?.trim()) return null;
  if (set) {
    // A srcset: every candidate's address must be a web address.
    const ok = value.split(",").every((c) => { const u = c.trim().split(/\s+/)[0] ?? ""; return !u || webUrl(el, u); });
    return ok ? value.trim() : null;
  }
  return webUrl(el, value.trim()) ? value.trim() : null;
}
function webUrl(el: Element, u: string): boolean {
  try { return /^https?:$/.test(new URL(u, el.ownerDocument.baseURI).protocol); } catch { return false; }
}

/** Sets the page's own lazy addresses on `el` (an <img> or a <source>); true when it did. */
function wake(el: Element): boolean {
  const s = state as NonNullable<typeof state>;
  if (s.lazy.some((l) => l.el === el)) return false;
  const src = pageUrl(el, LAZY_SRC.map((a) => el.getAttribute(a)).find((v) => v?.trim()) ?? null, false);
  const srcset = pageUrl(el, LAZY_SRCSET.map((a) => el.getAttribute(a)).find((v) => v?.trim()) ?? null, true);
  const set: Record<string, string> = {};
  if (srcset && el.getAttribute("srcset") !== srcset) set.srcset = srcset;
  if (src && el.localName === "img" && el.getAttribute("src") !== src) set.src = src;
  if (!Object.keys(set).length) return false;
  const was: Record<string, string | null> = {};
  for (const k of Object.keys(set)) was[k] = el.getAttribute(k);
  for (const [k, v] of Object.entries(set)) el.setAttribute(k, v);
  el.setAttribute(LAZY, "");
  s.lazy.push({ el, was, set });
  return true;
}

function listen(el: Element, type: string, fn: () => void): void {
  const s = state as NonNullable<typeof state>;
  const once = () => { fn(); el.removeEventListener(type, once); };
  el.addEventListener(type, once);
  s.listeners.push({ el, type, fn: once });
}

/** The column's inner box (px): its content width and left edge, at most the window. */
function columnOf(main: Element, win: Window): { left: number; right: number; width: number } {
  const r = main.getBoundingClientRect();
  const cs = win.getComputedStyle(main);
  const left = Math.max(0, r.left + (parseFloat(cs.paddingLeft) || 0));
  const right = Math.min(win.innerWidth, r.right - (parseFloat(cs.paddingRight) || 0));
  return { left, right, width: Math.max(0, right - left) };
}

/** Fits one picture to the column and keeps its shape; reserves its space when it has not arrived. */
function fit(el: Element, main: Element, win: Window): void {
  const s = state as NonNullable<typeof state>;
  const col = columnOf(main, win);
  if (col.width < 50) return;
  const r = el.getBoundingClientRect();
  const cs = win.getComputedStyle(el);
  const attrW = attrNum(el, "width"), attrH = attrNum(el, "height");
  const img = el.localName === "img" ? el as HTMLImageElement : null;
  const loaded = img ? img.complete && img.naturalWidth > 0 && !lazyStandIn(img) : true;
  const wide = r.width > col.width + 1 || r.right > Math.min(col.right, win.innerWidth) + 1 || (r.width < 2 && attrW > col.width);
  const fill = cs.objectFit === "fill";
  let shape = false;
  if (img && loaded && fill && r.width > 1 && r.height > 1) {
    const want = img.naturalWidth / img.naturalHeight, has = r.width / r.height;
    shape = Math.abs(has - want) / want > 0.05;
  }
  if (wide) {
    token(el, "fit");
    s.counts.fit++;
    // A box around it wider than the column (a figure set in px) narrows too.
    for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
      if (p.getBoundingClientRect().width > col.width + 1) token(p, "box");
    }
  }
  if ((wide && fill && cs.height !== "auto") || shape) {
    token(el, "shape");
    s.counts.shape++;
  }
  // Its space before it arrives: from its width and height (or the ones a lazy script keeps), when CSS leaves the
  // height to the picture. Chrome reserves it by itself for width and height attributes; not for data-width.
  const dw = attrW || attrNum(el, "data-width"), dh = attrH || attrNum(el, "data-height");
  // A stand-in that loaded (a 1x1 gif) gives "auto w / h" its own square shape: a lazy one is reserved explicitly.
  const standIn = !!img && lazyStandIn(img);
  const reserved = !standIn && (/\d/.test(cs.aspectRatio) || (attrW > 0 && attrH > 0));
  if (!loaded && dw > 0 && dh > 0 && !reserved) {
    el.setAttribute(RATIO, ruleFor(RATIO, "r", `aspect-ratio: ${dw} / ${dh} !important; height: auto !important;`));
    token(el, "fit");
    s.counts.ratio++;
  } else if (el.localName === "iframe" && wide && attrW > 0 && attrH > 0) {
    // An embedded player set in px: it narrows to the column at its own proportions.
    el.setAttribute(RATIO, ruleFor(RATIO, "r", `aspect-ratio: ${attrW} / ${attrH} !important; height: auto !important;`));
    s.counts.ratio++;
  }
}

/** A caption under a picture: a readable size, room between its lines, and a little room from the picture. */
function caption(cap: Element, win: Window): void {
  const s = state as NonNullable<typeof state>;
  const text = (cap.textContent ?? "").trim();
  if (!text || text.length > 400 || cap.closest(`[${HIDE}]`)) return;
  const cs = win.getComputedStyle(cap);
  const size = parseFloat(cs.fontSize) || 16;
  const decl: string[] = [];
  const grown = Math.max(size, CAPTION_MIN);
  if (size < CAPTION_MIN - 0.5) decl.push(`font-size: ${CAPTION_MIN}px !important`);
  const lh = cs.lineHeight === "normal" ? 1.2 * size : parseFloat(cs.lineHeight);
  if (lh / size < 1.3 || size < CAPTION_MIN - 0.5) decl.push(`line-height: ${Math.round(Math.max(lh / size, 1.4) * grown * 10) / 10}px !important`);
  const pic = cap.parentElement?.querySelector("img, picture, video");
  if (pic && !cap.contains(pic)) {
    const gap = cap.getBoundingClientRect().top - pic.getBoundingClientRect().bottom;
    if (gap >= -1 && gap < 4) decl.push("padding-top: 0.4em !important");
  }
  if (!decl.length) return;
  cap.setAttribute(CAPTION, ruleFor(CAPTION, "c", decl.join("; ") + ";"));
  s.counts.captions++;
}

/** The main column's galleries: four or more children, each a picture with little text, side by side. */
function findGalleries(main: Element, pics: Element[], body: readonly Element[], protect: readonly Element[], win: Window): { container: Element; items: Element[]; pictures: number }[] {
  const found: { container: Element; items: Element[]; pictures: number }[] = [];
  const tried = new Set<Element>();
  const big = new Set(pics.filter((p) => p.localName === "img"));
  for (const pic of big) {
    for (let e = pic.parentElement, d = 0; e && d < 4; e = e.parentElement, d++) {
      if (tried.has(e)) break;
      tried.add(e);
      if (!main.contains(e) && e !== main) break;
      if (body.some((b) => e.contains(b) && b !== e && b.localName !== "table") || protect.some((p) => e.contains(p) || p.contains(e))) break;
      const kids = Array.from(e.children).filter((k) => {
        const cs = win.getComputedStyle(k);
        return cs.display !== "none" && !k.hasAttribute(HIDE) && !k.hasAttribute(OPEN);
      });
      if (kids.length < GALLERY_MIN) continue;
      const items = kids.filter((k) => [...big].some((p) => k === p || k.contains(p)) && (k.textContent ?? "").trim().length <= 160);
      if (items.length < GALLERY_MIN || items.length < 0.8 * kids.length) continue;
      const rects = items.map((k) => k.getBoundingClientRect());
      const sideBySide = rects.some((a, i) => rects.some((b, j) => j > i && Math.abs(a.top - b.top) < 8 && Math.abs(a.left - b.left) > 20));
      if (!sideBySide) continue;
      const pictures = items.reduce((n, k) => n + (k.localName === "img" ? 1 : k.querySelectorAll("img").length), 0);
      found.push({ container: e, items, pictures });
      break;
    }
  }
  // The innermost of nested ones.
  return found.filter((g) => !found.some((o) => o !== g && g.container.contains(o.container)));
}

/** Folds a gallery: its first picture, then a button "+N photos" that opens the rest in place. */
function fold(g: { container: Element; items: Element[] }, doc: Document): void {
  const s = state as NonNullable<typeof state>;
  const id = `g${s.galleries.length}`;
  const rest = g.items.slice(1);
  const n = rest.length;
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = `+${n} ${n === 1 ? "photo" : "photos"}`;
  button.setAttribute("aria-label", `Show ${n} more ${n === 1 ? "photo" : "photos"}`);
  button.setAttribute("aria-expanded", "false");
  for (const [k, v] of Object.entries({
    font: "inherit", "font-size": "1em", "line-height": "1.4", color: "inherit", background: "transparent",
    border: "1px solid currentColor", "border-radius": "999px", padding: "0.35em 0.9em", margin: "0.5em 0", cursor: "pointer",
    display: "inline-block", width: "auto", height: "auto", "min-height": "44px", "align-self": "start", "justify-self": "start",
    "text-transform": "none", "letter-spacing": "normal", opacity: "1", visibility: "visible", position: "static",
  })) button.style.setProperty(k, v, "important");
  // In a list, a list item holds the button.
  const list = /^(ul|ol)$/.test(g.container.localName);
  const opener = list ? doc.createElement("li") : button;
  if (list) { opener.append(button); (opener as HTMLElement).style.setProperty("list-style", "none", "important"); }
  opener.setAttribute(OPEN, id);
  (g.items[0] as Element).after(opener);
  for (const el of rest) token(el, "more");
  // In a grid or a row, the first picture takes the whole row while the rest is folded, when its file is large enough
  // to be shown that wide without blurring (a thumbnail stays its size).
  const win = doc.defaultView as Window;
  const first = g.items[0] as Element;
  const pic = first.localName === "img" ? first as HTMLImageElement : first.querySelector("img");
  if (/grid|flex/.test(win.getComputedStyle(g.container).display) && pic && pic.naturalWidth >= 0.6 * g.container.getBoundingClientRect().width) token(first, "first");
  g.container.setAttribute(GALLERY, id);
  const gallery: Gallery = { id, container: g.container, items: g.items, opener, pictures: n };
  button.addEventListener("click", () => {
    for (const el of rest) untoken(el, "more");
    untoken(first, "first");
    opened.add(g.container);
    opener.remove();
    // The first picture it opened takes the focus, so a keyboard reader goes on from there.
    const next = rest[0]?.matches("a, button, [tabindex]") ? rest[0] : rest[0]?.querySelector("a, button, [tabindex]");
    (next as HTMLElement | null | undefined)?.focus({ preventScroll: true });
  });
  s.galleries.push(gallery);
}

/** Runs the pass on the main column; run again (Stay clean), it keeps opened galleries open and pictures it woke. */
export function applyMedia(ctx: { doc: Document; win: Window; main: Element | null; body: readonly Element[]; protect: readonly Element[] }): void {
  const { doc, win, main } = ctx;
  unmark(doc);
  if (!main || main === doc.documentElement) return;
  if (!state) {
    const style = doc.createElement("style");
    style.setAttribute("data-distill", "media");
    style.textContent = CSS;
    (doc.head ?? doc.documentElement).append(style);
    state = { doc, style, rules: new Map(), galleries: [], lazy: [], listeners: [], counts: { fit: 0, shape: 0, captions: 0, ratio: 0, empty: 0 }, pics: [] };
  }
  const s = state;
  s.counts = { fit: 0, shape: 0, captions: 0, ratio: 0, empty: 0 };
  s.ctx = ctx;
  if (!s.onResize) {
    const onResize = () => {
      win.clearTimeout(s.timer);
      s.timer = win.setTimeout(() => { if (state === s && s.ctx) applyMedia(s.ctx); }, 200);
    };
    s.onResize = onResize;
    win.addEventListener("resize", onResize);
  }
  // The column of a page without a column of its own (the body) still counts: its pictures are the page's.
  const scope = main === doc.body ? doc.body : main;
  const shown = (el: Element) => !el.closest(`[${HIDE}]`) && !ctx.protect.some((p) => p.contains(el));
  const pics = picturesOf(scope, shown, win);
  s.scope = scope;
  s.pics = pics;

  // Never loaded and nothing to load: its empty box goes (only once the page has loaded: before, it may be on its way).
  const done = doc.readyState === "complete";
  for (const el of pics) {
    if (el.localName !== "img") continue;
    const img = el as HTMLImageElement;
    if (lazyStandIn(img) || s.lazy.some((l) => l.el === img)) continue;
    // A broken picture whose words show instead (its alt text, a link's only words) is not empty: it stays.
    if (done && img.complete && img.naturalWidth === 0 && img.getBoundingClientRect().height >= 2 && !(img.getAttribute("alt") ?? "").trim()) {
      token(img, "empty");
      s.counts.empty++;
    }
  }
  for (const el of pics) {
    if (tokens(el).includes("empty")) continue;
    fit(el, scope, win);
    // A picture still on its way is measured again once it is there.
    if (el.localName === "img" && !(el as HTMLImageElement).complete) listen(el, "load", () => { if (state === s && el.isConnected) fit(el, scope, win); });
  }
  for (const cap of Array.from(scope.querySelectorAll("figcaption, .wp-caption-text, [class*=caption]:not(figure):not(img), [class*=Caption]:not(figure):not(img), [class*=popisek]")).filter(shown)) {
    if (cap.closest("figcaption") !== cap && cap.closest("figcaption")) continue;
    if (cap.querySelector("img, video, p + p")) continue;
    caption(cap, win);
  }
  for (const g of findGalleries(scope, pics, ctx.body, ctx.protect, win)) {
    if (opened.has(g.container)) continue;
    fold(g, doc);
  }
}

/** The column's pictures, videos and embeds that are not logos or icons. */
function picturesOf(scope: Element, shown: (el: Element) => boolean, win: Window): Element[] {
  return Array.from(scope.querySelectorAll("img, video, iframe")).filter((el) => shown(el) && !iconLike(el, win));
}

/** A lazy picture showing its stand-in, with the page's own address for it waiting in a data attribute. */
const lazyStandIn = (img: HTMLImageElement): boolean => [...LAZY_SRC, ...LAZY_SRCSET].some((a) => img.hasAttribute(a)) && placeholder(img);

/**
 * The network part, after first sight: lazy pictures that never loaded get the page's own address for them (their
 * space was reserved by the layout pass, so they arrive without a jump), and a native lazy one with no box yet loads
 * now, while it is far below, rather than jumping in when the reader gets there. Run again, it wakes only new ones.
 */
export function wakeMedia(): number {
  const s = state;
  if (!s?.scope?.isConnected) return 0;
  let woke = 0;
  for (const el of s.pics) {
    if (el.localName !== "img" || !el.isConnected || el.closest(`[${HIDE}]`)) continue;
    const img = el as HTMLImageElement;
    if (lazyStandIn(img)) {
      if (img.parentElement?.localName === "picture") img.parentElement.querySelectorAll("source").forEach((so) => wake(so));
      if (wake(img)) {
        woke++;
        listen(img, "error", () => { if (state === s) token(img, "empty"); });
        listen(img, "load", () => { if (state === s && img.isConnected && s.scope) fit(img, s.scope, s.doc.defaultView as Window); });
      }
      continue;
    }
    if (img.loading === "lazy" && !img.complete && img.getBoundingClientRect().height < 2 && !(attrNum(img, "width") && attrNum(img, "height"))
      && !s.lazy.some((l) => l.el === img)) {
      s.lazy.push({ el: img, was: { loading: "lazy" }, set: { loading: "eager" } });
      img.loading = "eager";
      img.setAttribute(LAZY, "");
      woke++;
    }
  }
  return woke;
}

/** Takes off the marks a pass made (not the pictures it woke: a run again keeps them). */
function unmark(doc: Document): void {
  if (state) {
    for (const g of state.galleries) g.opener.remove();
    state.galleries = [];
    for (const l of state.listeners) l.el.removeEventListener(l.type, l.fn);
    state.listeners = [];
  }
  doc.querySelectorAll(`[${OPEN}]`).forEach((el) => el.remove());
  for (const attr of [MEDIA, RATIO, CAPTION, GALLERY]) doc.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
}

/** What the pass did, for the live probe and the e2e. */
export function mediaReport(): { fit: number; shape: number; captions: number; ratio: number; empty: number; lazy: number; galleries: { id: string; pictures: number; open: boolean }[] } {
  if (!state) return { fit: 0, shape: 0, captions: 0, ratio: 0, empty: 0, lazy: 0, galleries: [] };
  return {
    ...state.counts, lazy: state.lazy.length,
    galleries: state.galleries.map((g) => ({ id: g.id, pictures: g.pictures, open: !g.opener.isConnected })),
  };
}

/** Takes every change back (close): the marks, the buttons, the style, and each address Distill set. */
export function clearMedia(doc: Document): void {
  unmark(doc);
  if (state) {
    for (const l of state.lazy) {
      // Only what is still Distill's: an address the page itself changed since stays the page's.
      for (const [k, v] of Object.entries(l.set)) {
        if (l.el.getAttribute(k) !== v) continue;
        const was = l.was[k];
        if (was == null) l.el.removeAttribute(k);
        else l.el.setAttribute(k, was);
      }
      l.el.removeAttribute(LAZY);
    }
    const win = state.doc.defaultView;
    if (win && state.onResize) { win.removeEventListener("resize", state.onResize); win.clearTimeout(state.timer); }
    state.style.remove();
    state = null;
  }
  opened = new WeakSet();
  doc.querySelectorAll('style[data-distill="media"]').forEach((s) => s.remove());
  doc.querySelectorAll(`[${LAZY}]`).forEach((el) => el.removeAttribute(LAZY));
}
