// Round 5, card 7 (r5-07): one system for every mark Distill puts on the page. Every feature that marks the page takes
// its look from here, so the marks belong together:
//
// - QUIET marks sit in the text while you read: a claim to check is underlined in the text's own colour (its line's
//   style says its verdict once checked, never colour alone); a thing to do gets a light wash of the system's
//   find-in-page colour (Mark), as strong as the page's text allows (washFor).
// - The ACTIVE mark says "here it is": Show me's flash, a tour's current step. Words get the full find-in-page colours
//   (Mark under MarkText, 19.6:1 in Chromium); a place without exact words (a fact, a contact block, a field) gets the
//   ring: a MarkText line inside a Mark line, so one of the two stands out on any background (at least 4.4:1).
// - NOTES (where a link goes, explain this word) share one box in closed shadow roots: NOTE_CSS.
//
// Colours are CSS system colours only (Mark, MarkText, Canvas, CanvasText, GrayText, ButtonFace, Highlight): they work
// on any page, follow forced colours, and carry no colour of Distill's own. The numbers behind "works on any page" are
// computed by markContrast (light, dark and Dark-page backgrounds: docs/caption.md, "Round 5, r5-07").
import { composite, contrastRatio, parseColor, type Rgba } from "@distill/engine";

/** The verdicts of a checked claim (r2-02). */
export type Verdict = "supported" | "disputed" | "mixed" | "notFound";

/** A claim's underline by its state: unchecked dotted, then one style per verdict (distinct without colour). */
export type LineStyle = "dotted" | "solid" | "wavy" | "dashed" | "double";
export const CLAIM_LINE: Record<"unchecked" | Verdict, LineStyle> = {
  unchecked: "dotted",
  supported: "solid",
  disputed: "wavy",
  mixed: "dashed",
  notFound: "double",
};

/** Highlight priorities: the active mark paints over the quiet ones. */
export const QUIET_PRIORITY = 0;
export const ACTIVE_PRIORITY = 2;

/** The wash's strength (percent of Mark over the page): the strongest that keeps the text readable (washFor). */
export const WASH_MAX = 32;
export const WASH_MIN = 6;
/** The text under a wash must read at least this well, or (when the page's own text is fainter) as well as it did. */
export const WASH_TEXT_MIN = 4.5;

/** The quiet underline of a claim (in the text's own colour). */
export const underlineCss = (name: string, line: string): string =>
  `::highlight(${name}) { text-decoration: underline ${line}; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }`;

/** The quiet wash of a thing to do, `pct` percent of Mark. */
export const washCss = (name: string, pct: number = WASH_MAX): string =>
  `::highlight(${name}) { background-color: color-mix(in srgb, Mark ${Math.round(pct)}%, transparent); }`;

/** The active mark on words: the system's find-in-page colours. */
export const activeCss = (...names: string[]): string =>
  `${names.map((n) => `::highlight(${n})`).join(", ")} { background-color: Mark; color: MarkText; }`;

/** The active mark on a place: the ring (MarkText inside, Mark outside), under `selector`. */
export const ringCss = (selector: string): string =>
  `${selector} { outline: 3px solid Mark !important; outline-offset: 2px !important; box-shadow: 0 0 0 2px MarkText !important; }`;

/** The one shape of Distill's notes on the page (closed shadow roots, links.ts and explain.ts): a neutral box in the
 *  system's own colours that follows the person's light or dark setting and forced colours. System fonts only:
 *  nothing is loaded. `.title` (bold), `.line` (a line), `.warn`, `.src` (where it came from), one kind of button. */
export const NOTE_CSS = `
:host { all: initial; }
.note { box-sizing: border-box; max-width: 320px; padding: 8px 10px; border: 1px solid GrayText; border-radius: 8px;
  background: Canvas; color: CanvasText; color-scheme: light dark; pointer-events: none;
  box-shadow: 0 2px 10px color-mix(in srgb, CanvasText 22%, transparent);
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: start; overflow-wrap: anywhere; }
.title { font-weight: 700; font-size: 14px; }
.line { margin-top: 2px; }
.warn { font-weight: 600; }
.src { font-size: 12px; opacity: .8; }
button { pointer-events: auto; min-height: 28px; padding: 3px 10px; border: 1px solid ButtonBorder; border-radius: 6px;
  background: ButtonFace; color: ButtonText; font: inherit; cursor: pointer; }
button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
`;

// ---- Contrast (pure) ----------------------------------------------------------------------------------------------

/** Chromium's system colours (the same in light and dark schemes; checked in the e2e): find-in-page yellow and black. */
export const CHROMIUM_MARK: Rgba = { r: 255, g: 255, b: 0, a: 1 };
export const CHROMIUM_MARK_TEXT: Rgba = { r: 0, g: 0, b: 0, a: 1 };

const mix = (top: Rgba, pct: number, under: Rgba): Rgba => composite({ ...top, a: pct / 100 }, under);

/**
 * The strongest wash (WASH_MIN..WASH_MAX percent of `mark`) under which `text` still reads at WASH_TEXT_MIN on `bg`, or
 * as well as it read without the wash when the page's own text is fainter than that. Light pages get the full wash; a
 * dark page with grey text gets a fainter one.
 */
export function washFor(bg: Rgba, text: Rgba, mark: Rgba = CHROMIUM_MARK): number {
  const own = contrastRatio(text, bg);
  const need = Math.min(WASH_TEXT_MIN, own);
  for (let pct = WASH_MAX; pct > WASH_MIN; pct -= 2) if (contrastRatio(text, mix(mark, pct, bg)) >= need) return pct;
  return WASH_MIN;
}

/** Every mark's contrast on one background with one text colour (WCAG ratios, 1 to 21). */
export interface MarkContrast {
  /** The page's own text on its background, for comparison. */
  text: number;
  /** A claim's underline: drawn in the text's colour. */
  underline: number;
  /** The wash's strength here, and the text on it. */
  wash: number;
  textOnWash: number;
  /** The active mark: MarkText on Mark, and the Mark fill against the page. */
  activeText: number;
  activeFill: number;
  /** The ring: the better of its two lines against the page. */
  ring: number;
}

export function markContrast(bg: Rgba, text: Rgba, mark: Rgba = CHROMIUM_MARK, markText: Rgba = CHROMIUM_MARK_TEXT): MarkContrast {
  const flatText = text.a < 1 ? composite(text, bg) : text;
  const wash = washFor(bg, flatText, mark);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    text: r(contrastRatio(flatText, bg)),
    underline: r(contrastRatio(flatText, bg)),
    wash,
    textOnWash: r(contrastRatio(flatText, mix(mark, wash, bg))),
    activeText: r(contrastRatio(markText, mark)),
    activeFill: r(contrastRatio(mark, bg)),
    ring: r(Math.max(contrastRatio(markText, bg), contrastRatio(mark, bg))),
  };
}

// ---- The page's colours (DOM) ---------------------------------------------------------------------------------------

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** What is behind `el`: its own and its ancestors' backgrounds over the canvas (white, or the browser's dark when the
 *  page asks only for a dark scheme). Null over a picture (a background image): no one colour is behind the words. */
export function backgroundBehind(el: Element): Rgba | null {
  const win = el.ownerDocument.defaultView;
  if (!win) return WHITE;
  if (onPicture(el)) return null;
  const layers: Rgba[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = win.getComputedStyle(e);
    const c = parseColor(cs.backgroundColor);
    if (/url\(|gradient\(/i.test(cs.backgroundImage ?? "")) return null;
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
  }
  const scheme = win.getComputedStyle(el.ownerDocument.documentElement).colorScheme ?? "";
  let bg: Rgba = /dark/.test(scheme) && !/light/.test(scheme) ? { r: 18, g: 18, b: 18, a: 1 } : WHITE;
  for (let i = layers.length - 1; i >= 0; i--) bg = composite(layers[i] as Rgba, bg);
  return bg;
}

const PICTURES = new Set(["img", "picture", "video", "canvas", "svg", "iframe"]);
/** Words laid over a picture that is not their background (text positioned over an <img>, as on Dymáček's front page):
 *  what is under the element's first line, looked up at that point. */
function onPicture(el: Element): boolean {
  const doc = el.ownerDocument;
  const r = el.getClientRects()[0];
  if (!r || typeof doc.elementsFromPoint !== "function") return false;
  const win = doc.defaultView;
  for (const under of doc.elementsFromPoint(r.left + Math.min(4, r.width / 2), r.top + r.height / 2)) {
    if (under === el || el.contains(under)) continue;
    if (under.contains(el)) {
      // One of its own boxes: an opaque background there is what the words sit on.
      const c = win ? parseColor(win.getComputedStyle(under).backgroundColor) : null;
      if (c && c.a >= 1) return false;
      continue;
    }
    if (PICTURES.has(under.localName)) return true;
  }
  return false;
}

/** The wash for these elements as the page shows them now: the faintest any of them needs (washFor). */
export function washOn(els: readonly Element[]): number {
  const win = els[0]?.ownerDocument.defaultView;
  if (!win) return WASH_MAX;
  // Mark is find-in-page yellow in Chromium in both schemes (the e2e checks it): no probe element is added to the page.
  const mark = CHROMIUM_MARK;
  let pct = WASH_MAX;
  for (const el of els.slice(0, 20)) {
    const text = parseColor(win.getComputedStyle(el).color);
    if (!text) continue;
    const bg = backgroundBehind(el);
    if (!bg) continue; // over a picture: the text there was made to read on it, the wash stays as it is
    pct = Math.min(pct, washFor(bg, text.a < 1 ? composite(text, bg) : text, mark));
  }
  return pct;
}
