// #6 Comfortable to read: on the main text only, a minimum size, line height, line length and contrast. Applied at Clean
// where the page needs it (a page that reads well gets nothing); one switch in More turns it off; Original shows the
// page as it was. Everything goes through one Distill style keyed on data-distill-comfort* attributes.
import {
  composite, cssColor, dominantSize, isLargeText, lineHeightFor, measureFor, parseColor, READING, readableOn, sizeScale, type Rgba,
} from "@distill/engine";
import type { CleanContext } from "./context";
import { avgCharWidth } from "./reflow";

/** On a block the layer changes (the count the strip shows). */
const BLOCK = "data-distill-comfort";
/** On an element whose own text gets a size, line height or colour: its rule id. */
const TEXT = "data-distill-comfort-text";
/** On a block whose lines were too long: its rule id. */
const MEASURE = "data-distill-comfort-measure";
/** On <html> while the person has turned the layer off. */
const OFF = "data-distill-comfort-off";
const ORIGINAL = "data-distill-original";
const HIDE = "data-distill-hide";

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

let state: { style: HTMLStyleElement; count: number } | null = null;

/** Text a reader would see: one element's own characters (its direct text nodes). */
interface Run { el: Element; chars: number; size: number; lineHeight: number | null; weight: number; color: string }

/** The element itself when it is laid out as a block, else its nearest ancestor that is (at most 3 up). */
function blockOf(el: Element, win: Window): Element {
  let e = el;
  for (let i = 0; i < 3 && e.parentElement && /^(inline|contents)$/.test(win.getComputedStyle(e).display); i++) e = e.parentElement;
  return e;
}

/** The run's text takes more than one line on screen. */
const wraps = (run: Run): boolean => run.el.getBoundingClientRect().height >= 1.5 * (run.lineHeight ?? 1.2 * run.size);

/** The elements carrying `block`'s visible text, with how many characters each carries itself. */
function runsOf(block: Element, win: Window, taken: Set<Element>): Run[] {
  const chars = new Map<Element, number>();
  const walk = block.ownerDocument.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n.parentElement;
    const len = (n.textContent ?? "").trim().length;
    if (!el || !len || taken.has(el) || el.closest(`[${HIDE}]`)) continue;
    chars.set(el, (chars.get(el) ?? 0) + len);
    if (chars.size > 300) break;
  }
  const runs: Run[] = [];
  for (const [el, n] of chars) {
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const lh = parseFloat(cs.lineHeight);
    runs.push({ el, chars: n, size: parseFloat(cs.fontSize) || 16, lineHeight: Number.isFinite(lh) ? lh : null, weight: Number(cs.fontWeight) || 400, color: cs.color });
  }
  return runs;
}

/**
 * The colour the text is painted on: the first background colour up the ancestors (translucent ones blended). Null
 * when it cannot be known: a background picture, a colour it cannot read, a layer laid over something else, or a
 * picture or other box painted under the text that is not one of its ancestors.
 */
function backdrop(el: Element, win: Window): Rgba | null {
  const doc = el.ownerDocument;
  const layers: Rgba[] = [];
  let carrier: Element = doc.documentElement;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = win.getComputedStyle(e);
    if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
    const c = parseColor(cs.backgroundColor);
    if (!c) return null;
    if (c.a > 0) layers.push(c);
    if (c.a >= 0.999) { carrier = e; break; }
    if (e !== doc.body && e !== doc.documentElement && /absolute|fixed/.test(cs.position)) return null;
  }
  // What is painted under the text on screen must be its own ancestors only.
  const r = el.getBoundingClientRect();
  const x = r.left + Math.min(r.width, 40) / 2, y = r.top + Math.min(r.height, 20) / 2;
  if (x >= 0 && y >= 0 && x < win.innerWidth && y < win.innerHeight && typeof doc.elementsFromPoint === "function") {
    for (const hit of doc.elementsFromPoint(x, y)) {
      if (hit === carrier || hit === doc.documentElement) break;
      if (hit === el || el.contains(hit) || hit.contains(el) || hit.localName === "distill-caption") continue;
      if (/^(img|picture|video|canvas|svg|iframe|object|embed)$/.test(hit.localName)) return null;
      const hs = win.getComputedStyle(hit);
      if (hs.backgroundImage !== "none" || (parseColor(hs.backgroundColor)?.a ?? 1) > 0) return null;
    }
  }
  const opaque = layers.length > 0 && (layers[layers.length - 1] as Rgba).a >= 0.999;
  // No colour of its own up to the root: the canvas, white unless the page asks for a dark one.
  if (!opaque && /dark/.test(win.getComputedStyle(doc.documentElement).colorScheme)) return null;
  let base = opaque ? layers.pop() as Rgba : WHITE;
  for (let i = layers.length - 1; i >= 0; i--) base = composite(layers[i] as Rgba, base);
  return { ...base, a: 1 };
}

/** Blocks whose wrapped lines get room between them (paragraphs; a list's items are spaced by their own margins). */
const PARAGRAPH = /^(p|dd|blockquote|div|section|article)$/;
/** Blocks whose line length is limited. */
const MEASURED = /^(p|ul|ol|dl|blockquote|div|section|article)$/;
/** Fewer characters than this is a label or a badge, not running text. */
const MIN_CHARS = 20;

/** Applies the layer where the main text needs it; returns how many blocks it changes when on. Run again (Stay clean
 *  after the page changed), it keeps the person's switch: off stays off. */
export function applyComfort(ctx: CleanContext): number {
  const { doc, win } = ctx;
  const off = comfortOff(doc);
  clearComfort(doc);
  if (off) doc.documentElement.setAttribute(OFF, "");
  const protectedEl = (el: Element) => ctx.protect.some((p) => p.contains(el) || el.contains(p));
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); return el.isConnected && r.width >= 2 && r.height >= 2; };
  const body = ctx.body.filter((el) => shown(el) && !protectedEl(el) && (el.textContent ?? "").trim().length >= MIN_CHARS);
  const h1 = ctx.keep.find((el) => el.localName === "h1" && shown(el));
  const headings = ctx.keep.filter((el) => /^h[1-6]$/.test(el.localName) && shown(el) && !protectedEl(el)
    && (el === h1 || (!!ctx.main && ctx.main.contains(el))));

  const taken = new Set<Element>();
  const bodyRuns = body.map((b) => ({ block: b, runs: runsOf(b, win, taken) }));
  bodyRuns.forEach(({ runs }) => runs.forEach((r) => taken.add(r.el)));
  // Sizes only change when the page's running text as a whole is small; a small caption on a page set in 18 px stays.
  const pageScale = sizeScale(dominantSize(bodyRuns.flatMap(({ runs }) => runs)));

  const looks = new Map<string, string>(); // rule body -> id
  const rules: string[] = [];
  const on = `html:not([${ORIGINAL}]):not([${OFF}])`;
  const ruleFor = (decl: string[], attr: string, prefix: string): string => {
    const body = decl.map((d) => `${d} !important`).join("; ");
    const key = `${attr}|${body}`;
    let id = looks.get(key);
    if (!id) {
      id = `${prefix}${looks.size}`;
      looks.set(key, id);
      rules.push(`${on} [${attr}="${id}"] { ${body}; }`);
    }
    return id;
  };

  /** Gives each run what it lacks; true when any changed. `paragraph`: running text that wraps (it gets line spacing). */
  const fixRuns = (runs: Run[], scale: number, paragraph: boolean): boolean => {
    let changed = false;
    const main = dominantSize(runs);
    for (const run of runs) {
      const decl: string[] = [];
      const size = run.size * scale;
      if (scale !== 1) decl.push(`font-size: ${Math.round(size * 10) / 10}px`);
      // Room between lines is for the paragraph's own text (not a badge or a footnote mark in it); a line height far
      // under the size is the page's own trick.
      const line = run.lineHeight ?? 1.2 * run.size;
      const spaced = paragraph && Math.abs(run.size - main) <= 0.1 * main && line >= 0.8 * run.size;
      const lh = lineHeightFor({ size: run.size, lineHeight: run.lineHeight, scale, paragraph: spaced });
      if (lh !== null) decl.push(`line-height: ${lh}px`);
      const fg = parseColor(run.color);
      const bg = fg && fg.a > 0 ? backdrop(run.el, win) : null;
      if (fg && bg) {
        const fix = readableOn(fg, bg, isLargeText(size, run.weight) ? READING.contrastLarge : READING.contrast);
        if (fix) decl.push(`color: ${cssColor(fix)}`);
      }
      if (!decl.length) continue;
      run.el.setAttribute(TEXT, ruleFor(decl, TEXT, "t"));
      changed = true;
    }
    return changed;
  };

  // One sample of the page's running text: blocks set in one font get one measure, so their right edges line up.
  const sample = body.map((el) => el.textContent ?? "").join(" ").replace(/\s+/g, " ").slice(0, 2000);
  let count = 0;
  for (const { block, runs } of bodyRuns) {
    const scale = pageScale > 1 ? sizeScale(dominantSize(runs)) : 1;
    // The reader may name an inline element as the block (<p><font size=1>...</font></p>): its paragraph is around it.
    const box = blockOf(block, win);
    const cs = win.getComputedStyle(box);
    const width = box.getBoundingClientRect().width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    // In the font most of its characters are set in (<p><font size=1> sets them in the font element's).
    const most = runs.reduce<Run | null>((a, r) => (!a || r.chars > a.chars ? r : a), null);
    const avgChar = avgCharWidth(most?.el ?? block, win, sample);
    // Its text runs over more than one line now, or will once it is larger (a list of short items in a wide box
    // does not, so it gets neither line spacing nor a measure).
    const wrapped = runs.some(wraps) || (scale > 1 && runs.some((r) => r.chars * avgChar * scale > width));
    let changed = fixRuns(runs, scale, wrapped && PARAGRAPH.test(box.localName));
    // Long lines: only running text laid out as blocks (not a row of flex or grid items).
    if (MEASURED.test(box.localName) && /^(block|list-item|flow-root)$/.test(cs.display) && wrapped && !box.hasAttribute(MEASURE)) {
      const max = measureFor({ width, avgChar: avgChar * scale });
      if (max !== null) { box.setAttribute(MEASURE, ruleFor([`max-width: ${max}px`], MEASURE, "m")); changed = true; }
    }
    if (changed) { block.setAttribute(BLOCK, ""); count++; }
  }
  // The headline and the main column's headings: as much bigger as the text grew (so they stay above it), and readable.
  for (const h of headings) {
    const runs = runsOf(h, win, taken);
    runs.forEach((r) => taken.add(r.el));
    if (fixRuns(runs, pageScale, false)) { h.setAttribute(BLOCK, ""); count++; }
  }

  if (!count) return 0;
  const style = doc.createElement("style");
  style.setAttribute("data-distill", "comfort");
  style.textContent = rules.join("\n");
  (doc.head ?? doc.documentElement).append(style);
  state = { style, count };
  return count;
}

/** The person turned the layer off in More. */
export const comfortOff = (doc: Document): boolean => doc.documentElement.hasAttribute(OFF);

/** The person's switch: on or off again; returns how many blocks it changes when on (0 when off). */
export function setComfort(doc: Document, on: boolean): number {
  doc.documentElement.toggleAttribute(OFF, !on);
  return on ? state?.count ?? 0 : 0;
}

/** Takes every change back (close). */
export function clearComfort(doc: Document): void {
  state?.style.remove();
  state = null;
  doc.querySelectorAll('style[data-distill="comfort"]').forEach((s) => s.remove());
  for (const attr of [BLOCK, TEXT, MEASURE]) doc.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  doc.documentElement.removeAttribute(OFF);
}
