// Round 4, card 8 (r4-08): tours started by hand, the page side. One step scrolls to something Distill already found
// (a sentence of the main text, a thing to do, a way to reach someone, a product fact) and highlights its exact words
// until the next step; null ends the tour and takes the highlight off. Nothing new is found here and no AI runs: the
// targets come from the readers that found them (claims' textTarget, actions' actionTarget, contact's contactPlace).
//
// The highlight is a CSS Custom Highlight (as caption/claims.ts): a range over the page's own text nodes, no element
// added or split. When the words are not there as written (a translation shows) the place itself is outlined, by a
// data-distill-tour attribute. The step is found again when the page's text under it changes, and on the
// distill:textsplit event (prices and dates in your terms split a node: caption/textSplit.ts). Original shows the page
// without it; close takes it away (page.ts calls tourStep(doc, null)).
import type { TourStep } from "../messages";
import { actionTarget } from "./actions";
import { textTarget } from "./claims";
import { contactPlace } from "./contact";
import { ACTIVE_PRIORITY, activeCss, ringCss } from "./marks";
import { showProduct } from "./product";
import { TEXT_SPLIT_EVENT } from "./textSplit";

export const TOUR_HIGHLIGHT = "distill-tour";
export const TOUR_ATTR = "data-distill-tour";
const STYLE_ID = "distill-tour-style";
const ORIGINAL = "data-distill-original";
const REPAINT_MS = 120;
/** A contact's element whose text is at most this long is highlighted whole when its listed words are not in it as
 *  written (the finder joins lines of hours). A longer one is outlined. */
const WHOLE_MAX = 160;

// r5-07: the active mark of caption/marks.ts, as Show me's: the system's find-in-page colours on the words (no colour of
// Distill's on the page), above the claims' and actions' quiet marks; the ring on a place without exact words.
const CSS = [activeCss(TOUR_HIGHLIGHT), ringCss(`html:not([${ORIGINAL}]) [${TOUR_ATTR}]`)].join("\n");

type Target = { range: Range } | { el: Element };
interface Current {
  step: TourStep;
  observer: MutationObserver | null;
  timer: ReturnType<typeof setTimeout> | null;
  onSplit: () => void;
  /** Where the step was found last: the element its words are in. */
  at: Element | null;
}
let current: Current | null = null;

type Registry = Map<string, Highlight>;
const registry = (doc: Document): Registry | null =>
  ((doc.defaultView as (Window & { CSS?: { highlights?: Registry } }) | null)?.CSS?.highlights) ?? null;
const HighlightOf = (doc: Document): typeof Highlight | null =>
  ((doc.defaultView as (Window & { Highlight?: typeof Highlight }) | null)?.Highlight) ?? null;

/** The text nodes of `el` in order, without scripts and styles: all of them, so words split by a price or a date
 *  written your way (r3-07) read as one. */
function textNodes(el: Element): Text[] {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* SHOW_TEXT */);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest("script, style, noscript")) out.push(n as Text);
  return out;
}

/** A range over `quote` in `el` (any run of spaces matching any other), or null. Exported for the tests. */
export function quoteRange(doc: Document, el: Element, quote: string): Range | null {
  // First as the nodes run on; then with a space between nodes, for words over lines (a <br>, a block child).
  return rangeIn(doc, el, quote, false) ?? rangeIn(doc, el, quote, true);
}

function rangeIn(doc: Document, el: Element, quote: string, lines: boolean): Range | null {
  let flat = "";
  const at: { node: Text; offset: number }[] = [];
  for (const node of textNodes(el)) {
    const value = node.nodeValue ?? "";
    if (lines && flat && !flat.endsWith(" ")) { flat += " "; at.push({ node, offset: 0 }); }
    for (let i = 0; i < value.length; i++) {
      const ch = /\s/.test(value[i] as string) ? " " : (value[i] as string);
      if (ch === " " && (flat === "" || flat.endsWith(" "))) continue;
      flat += ch;
      at.push({ node, offset: i });
    }
  }
  const want = quote.replace(/\s+/g, " ").trim();
  const start = want ? flat.indexOf(want) : -1;
  if (start < 0) return null;
  const first = at[start];
  const last = at[start + want.length - 1];
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, Math.min(last.offset + 1, last.node.length));
  return range;
}

function contactTarget(doc: Document, id: string): Target | null {
  const place = contactPlace(doc, id);
  if (!place) return null;
  const range = quoteRange(doc, place.el, place.text);
  if (range) return { range };
  if ((place.el.textContent ?? "").trim().length <= WHOLE_MAX && textNodes(place.el).length) {
    const whole = doc.createRange();
    whole.selectNodeContents(place.el);
    return { range: whole };
  }
  return { el: place.el };
}

function targetOf(doc: Document, step: TourStep): Target | null {
  switch (step.kind) {
    case "text": return textTarget(doc, step.blockId, step.sentence);
    case "action": return actionTarget(doc, step.id);
    case "contact": return contactTarget(doc, step.id);
    case "product": return null; // shown by product.ts's showProduct
  }
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).append(style);
}

function unpaint(doc: Document): void {
  registry(doc)?.delete(TOUR_HIGHLIGHT);
  doc.querySelectorAll(`[${TOUR_ATTR}]`).forEach((el) => el.removeAttribute(TOUR_ATTR));
}

/** Into the upper third of the window when it is not in the top half (the strip covers the bottom, up to 45% with More
 *  open). */
function bringIntoView(doc: Document, r: DOMRect): void {
  const win = doc.defaultView;
  if (!win || (r.top >= 8 && r.bottom <= win.innerHeight * 0.5)) return;
  const instant = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  win.scrollTo({ top: Math.max(0, r.top + win.scrollY - win.innerHeight / 3), behavior: instant ? "auto" : "smooth" });
}

const LETTER = /[\p{L}\p{N}]/u;
/** Widens `range` to whole words inside its end nodes: a quote cut mid-word ("9-18 h" of "9-18 hodin", as the hours
 *  finder words it) is highlighted to the word's end. Exported for the tests. */
export function wholeWords(range: Range): void {
  const s = range.startContainer;
  if (s.nodeType === 3) {
    const v = s.nodeValue ?? "";
    let i = range.startOffset;
    while (i > 0 && LETTER.test(v[i - 1] as string) && LETTER.test(v[i] ?? "")) i--;
    if (i !== range.startOffset) range.setStart(s, i);
  }
  const e = range.endContainer;
  if (e.nodeType === 3) {
    const v = e.nodeValue ?? "";
    let i = range.endOffset;
    while (i < v.length && i > 0 && LETTER.test(v[i - 1] as string) && LETTER.test(v[i] as string)) i++;
    if (i !== range.endOffset) range.setEnd(e, i);
  }
}

/** Highlights the current step as the page stands now; scrolls to it when asked. False when it is not on the page. */
function paint(doc: Document, scroll: boolean): boolean {
  unpaint(doc);
  if (!current) return false;
  const target = targetOf(doc, current.step);
  if (!target) { current.at = null; return false; }
  const reg = registry(doc);
  const H = HighlightOf(doc);
  if ("range" in target && reg && H) {
    wholeWords(target.range);
    const h = new H(target.range);
    h.priority = ACTIVE_PRIORITY;
    reg.set(TOUR_HIGHLIGHT, h);
    const c = target.range.commonAncestorContainer;
    current.at = c.nodeType === 1 ? (c as Element) : c.parentElement;
    if (scroll && typeof target.range.getBoundingClientRect === "function") bringIntoView(doc, target.range.getBoundingClientRect());
    return true;
  }
  // No highlight registry, or the words are not there as written: outline the place.
  let el: Element | null;
  if ("el" in target) el = target.el;
  else {
    const c = target.range.commonAncestorContainer;
    el = c.nodeType === 1 ? (c as Element) : c.parentElement;
  }
  if (!el) return false;
  el.setAttribute(TOUR_ATTR, "");
  current.at = el;
  if (scroll) bringIntoView(doc, el.getBoundingClientRect());
  return true;
}

/** The step is found again once the page's text under it is quiet (a translation went in, the page rewrote it), or a
 *  price or a date written your way split or rejoined a node (r3-07). Original needs nothing: the highlight registry is
 *  emptied below while it shows, and the outline's style does not apply. */
function watch(doc: Document, c: Current): void {
  const again = () => {
    if (current !== c) return;
    if (c.timer) clearTimeout(c.timer);
    c.timer = setTimeout(() => { c.timer = null; if (current === c) paintFor(doc); }, REPAINT_MS);
  };
  c.onSplit = again;
  doc.addEventListener(TEXT_SPLIT_EVENT, again);
  const observer = new MutationObserver((records) => {
    if (current !== c) return;
    const touched = records.some((r) =>
      (r.type === "attributes" && r.target === doc.documentElement && r.attributeName === ORIGINAL)
      || (r.type !== "attributes" && !!c.at && (c.at.contains(r.target) || r.target.contains(c.at))));
    if (touched) again();
  });
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: [ORIGINAL] });
  if (doc.body) observer.observe(doc.body, { characterData: true, childList: true, subtree: true });
  c.observer = observer;
}

/** Repaints without scrolling; nothing while the original page shows. */
function paintFor(doc: Document): void {
  if (doc.documentElement.hasAttribute(ORIGINAL)) { unpaint(doc); return; }
  paint(doc, false);
}

function stop(doc: Document): void {
  if (current) {
    current.observer?.disconnect();
    if (current.timer) clearTimeout(current.timer);
    doc.removeEventListener(TEXT_SPLIT_EVENT, current.onSplit);
  }
  current = null;
  unpaint(doc);
}

/**
 * One step of a tour: scrolls to it and highlights its exact words until the next step. Returns whether it is on the
 * page now (a step that is gone leaves nothing highlighted). `null` ends the tour: the highlight, its style and its
 * watchers go, and true is returned.
 */
export function tourStep(doc: Document, step: TourStep | null): boolean {
  stop(doc);
  if (!step) { doc.getElementById(STYLE_ID)?.remove(); return true; }
  if (step.kind === "product") return showProduct(doc, step.id);
  ensureStyle(doc);
  const c: Current = { step, observer: null, timer: null, onSplit: () => undefined, at: null };
  current = c;
  const found = paint(doc, true);
  watch(doc, c);
  return found;
}

/** The step a tour is on now, or null (for the tests). */
export const tourShown = (): TourStep | null => current?.step ?? null;
