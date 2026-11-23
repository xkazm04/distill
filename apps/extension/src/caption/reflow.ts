// #1 Fill the hole Clean leaves: after Clean, boxes of the main column that kept the width they had beside a sidebar grow
// into the freed room, up to a comfortable reading width, and sit in the middle of it. Only through Distill's own CSS,
// scoped so Original shows the page as it was; a box goes back to its own width as soon as the person brings back what
// sat beside it. Most modern pages need nothing here: 0 is the common answer.
import { columnWidth } from "@distill/engine";
import type { CleanContext } from "./context";

/** On a widened box: its rule id (`w0`, or `w0f1` for a box inside it that follows it out). */
const WIDEN = "data-distill-widen";
/** On a removed element that sat beside a widened box: the rule ids it frees. Shown again, it turns the rule off. */
const FREED = "data-distill-widen-freed";
const HIDE = "data-distill-hide";
const ORIGINAL = "data-distill-original";
/** The reading layer's own switches (comfort.ts, tables.ts) and the additions of Prices and dates (terms.ts). */
const COMFORT_OFF = "data-distill-comfort-off";
const TABLES_OFF = "data-distill-tables-off";
const TERM_ADD = "data-distill-term-add";

/**
 * Runs `read` on the page as Clean left it: the reading layer (comfort's measure and sizes, the typesetter, readable
 * tables) and the price and date additions switched off for that moment, in the same task, so no frame is painted
 * between. Round 5 found the widened width depended on timing: Clean measured before the reading layer ran, a later
 * look (Stay clean following a change, a resize) after it had narrowed the text and the tables, so one page came out
 * 900, 860 or 764 px wide. Measured bare, every look reads the same numbers.
 */
function bare<T>(doc: Document, read: () => T): T {
  const html = doc.documentElement;
  // Clean's own look comes before the reading layer: nothing to switch off, and two attribute flips on <html> would
  // make the browser restyle the whole page twice (first sight, r5-10 loose end 3).
  if (!doc.querySelector("[data-distill-comfort], [data-distill-table], [data-distill-term-add]")) return read();
  const flipped = [COMFORT_OFF, TABLES_OFF].filter((a) => !html.hasAttribute(a));
  for (const a of flipped) html.setAttribute(a, "");
  const quiet = doc.querySelector(`[${TERM_ADD}]`) ? doc.createElement("style") : null;
  if (quiet) {
    quiet.setAttribute("data-distill", "reflow-measure");
    quiet.textContent = `[${TERM_ADD}]::after { content: none !important; }`;
    (doc.head ?? html).append(quiet);
  }
  try {
    return read();
  } finally {
    quiet?.remove();
    for (const a of flipped) html.removeAttribute(a);
  }
}

interface Reflow {
  ctx: CleanContext;
  /** Boxes on the path from the main column up to <body> that had a removed element beside them before Clean. */
  beside: Map<Element, Beside>;
  style: HTMLStyleElement;
  /** The page changed size while the original was shown: widen again once it is not. */
  dirty: boolean;
  stop: () => void;
}

let state: Reflow | null = null;
/** Each widened box's character width from its first measure, until close (r5-10: every look reads the same). */
let charWidth = new WeakMap<Element, number>();

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
};

/** The content box of `el` (inside its border and padding), in the viewport's coordinates. */
function contentBox(el: Element, win: Window): { left: number; right: number; width: number } {
  const r = el.getBoundingClientRect();
  const cs = win.getComputedStyle(el);
  const left = r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
  const right = r.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
  return { left, right, width: Math.max(0, right - left) };
}

const overlapY = (a: Box, b: Box) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * The average width of one character in `el`'s font (canvas measure; a guess without canvas), over `sample` (the page's
 * running text, so blocks in one font get one measure) or else over `el`'s own text.
 */
export function avgCharWidth(el: Element, win: Window, sample?: string): number {
  const cs = win.getComputedStyle(el);
  const size = parseFloat(cs.fontSize) || 16;
  const text = (sample ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
  if (text.length < 20) return size * 0.5;
  try {
    const g = el.ownerDocument.createElement("canvas").getContext("2d");
    if (!g) return size * 0.5;
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const w = g.measureText(text).width / text.length;
    return w > 0 ? w : size * 0.5;
  } catch {
    return size * 0.5;
  }
}

/** Something a person would see beside the column: a visible box with text or a picture in it. */
function occupies(el: Element, win: Window): boolean {
  const cs = win.getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  if (text.trim()) return true;
  return Array.from(el.querySelectorAll("img, picture, video, iframe, canvas, svg, object, embed")).some((m) => {
    const q = m.getBoundingClientRect();
    return q.width >= 20 && q.height >= 20;
  });
}

/** The main column and its boxes up to (not including) <body>. */
function pathOf(main: Element, doc: Document): Element[] {
  const out: Element[] = [];
  for (let el: Element | null = main; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) out.push(el);
  return out;
}

/**
 * Which boxes of the path had a removed element beside them before Clean (left or right of it, at the same height).
 * Measured once, with the original shown for a moment: no frame is painted in between.
 */
function findBeside(ctx: CleanContext, path: Element[]): Map<Element, Beside> {
  const html = ctx.doc.documentElement;
  const wasOriginal = html.hasAttribute(ORIGINAL);
  html.setAttribute(ORIGINAL, "");
  const before = new Map<Element, Box>();
  const fixed = new Set<Element>();
  try {
    for (const el of path) before.set(el, boxOf(el));
    for (const el of ctx.removed.values()) {
      before.set(el, boxOf(el));
      if (ctx.win.getComputedStyle(el).position === "fixed") fixed.add(el);
    }
  } finally {
    if (!wasOriginal) html.removeAttribute(ORIGINAL);
  }
  const beside = new Map<Element, Beside>();
  for (const box of path) {
    const parent = box.parentElement;
    const b = before.get(box);
    if (!parent || !b || b.width < 2) continue;
    const found: Beside = { freed: [], left: false, right: false };
    for (const r of ctx.removed.values()) {
      if (fixed.has(r) || !parent.contains(r) || box.contains(r) || r.contains(box)) continue;
      const q = before.get(r);
      if (!q || q.width < 2 || q.height < 2 || overlapY(q, b) < Math.min(200, 0.5 * Math.min(q.height, b.height))) continue;
      if (q.left >= b.right - 4) found.right = true;
      else if (q.right <= b.left + 4) found.left = true;
      else continue;
      found.freed.push(r);
    }
    if (found.freed.length) beside.set(box, found);
  }
  return beside;
}

/** What sat beside a box before Clean, and on which side. */
interface Beside { freed: Element[]; left: boolean; right: boolean }

/** The least room on a freed side that counts as a hole (a page's own side margin on a phone is not one). */
const MIN_HOLE = 96;

/** Widens what needs it; returns how many boxes changed. */
export function widen(ctx: CleanContext): number {
  unwiden(ctx.doc, false);
  if (!ctx.main || !ctx.removed.size || !ctx.doc.body) return 0;
  const path = pathOf(ctx.main, ctx.doc);
  const beside = findBeside(ctx, path);
  if (!beside.size) return 0;

  const style = ctx.doc.createElement("style");
  style.setAttribute("data-distill", "reflow");
  (ctx.doc.head ?? ctx.doc.documentElement).append(style);
  // The room beside a column depends on the window: measure again when it changes size.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => { clearTimeout(timer); timer = setTimeout(again, 150); };
  const again = () => { if (state) apply(state); };
  ctx.win.addEventListener("resize", onResize);
  const watch = new MutationObserver(() => { if (state?.dirty && !ctx.doc.documentElement.hasAttribute(ORIGINAL)) apply(state); });
  watch.observe(ctx.doc.documentElement, { attributes: true, attributeFilter: [ORIGINAL] });
  state = {
    ctx, beside, style, dirty: false,
    stop: () => { clearTimeout(timer); ctx.win.removeEventListener("resize", onResize); watch.disconnect(); },
  };
  return apply(state);
}

/** Takes every change back (close; `forget` also drops the measures kept for the next look). */
export function unwiden(doc: Document, forget = true): void {
  if (state) { state.stop(); state.style.remove(); state = null; }
  if (forget) charWidth = new WeakMap();
  doc.querySelectorAll('style[data-distill="reflow"]').forEach((s) => s.remove());
  clearMarks(doc);
}

function clearMarks(doc: Document): void {
  doc.querySelectorAll(`[${WIDEN}]`).forEach((el) => el.removeAttribute(WIDEN));
  doc.querySelectorAll(`[${FREED}]`).forEach((el) => el.removeAttribute(FREED));
}

const px = (n: number) => `${Math.round(n)}px`;

/** The grid column line `box` starts at and where that track starts, from the resolved track sizes of its grid. */
function gridStart(box: Box, grid: Element, win: Window): { line: number; x: number } | null {
  const cs = win.getComputedStyle(grid);
  const tracks = cs.gridTemplateColumns.split(/\s+/).filter((t) => /px$/.test(t)).map(parseFloat);
  if (!tracks.length) return null;
  const gap = parseFloat(cs.columnGap) || 0;
  let x = contentBox(grid, win).left;
  for (let i = 0; i < tracks.length; i++) {
    if (box.left < x + (tracks[i] as number) - 1) return { line: i + 1, x };
    x += (tracks[i] as number) + gap;
  }
  return null;
}

/** Measures the page as it is now (bare: the reading layer off for the moment) and writes the rules. Returns how many
 *  boxes they change. */
function apply(s: Reflow): number {
  const { ctx, style } = s;
  const { doc } = ctx;
  style.textContent = "";
  clearMarks(doc);
  if (doc.documentElement.hasAttribute(ORIGINAL)) { s.dirty = true; return 0; }
  s.dirty = false;
  if (!ctx.main?.isConnected) return 0;
  const main = ctx.main;
  return bare(doc, () => applyBare(s, main));
}

function applyBare(s: Reflow, main: Element): number {
  const { ctx, beside, style } = s;
  const { doc, win } = ctx;

  const path = pathOf(main, doc);
  // Which boxes filled their parent before any rule: those follow a widened box out.
  const filled = new Set(path.filter((el) => {
    const p = el.parentElement;
    return !!p && Math.abs(el.getBoundingClientRect().width - contentBox(p, win).width) <= 2;
  }));
  const rules: string[] = [];
  let count = 0;
  let n = 0;
  let headDone = false;
  for (const box of path) {
    const side = beside.get(box);
    const freed = side?.freed;
    if (!side || !freed || !box.isConnected || !freed.some((r) => r.hasAttribute(HIDE))) continue;
    const parent = box.parentElement;
    if (!parent) continue;
    const cs = win.getComputedStyle(box);
    const pcs = win.getComputedStyle(parent);
    if (/absolute|fixed/.test(cs.position) || /table|inline/.test(cs.display) || /table/.test(pcs.display)) continue;

    const b = boxOf(box);
    const pc = contentBox(parent, win);
    if (b.width >= pc.width - 24) continue; // it fills its parent: no hole here
    // The free band around the box: up to the nearest thing still shown beside it, at its height.
    let left = pc.left, right = pc.right;
    for (const sib of Array.from(parent.children)) {
      if (sib === box || !occupies(sib, win)) continue;
      const q = boxOf(sib);
      if (overlapY(q, b) < 20) continue;
      if (q.right <= b.left + 2) left = Math.max(left, q.right);
      else if (q.left >= b.right - 2) right = Math.min(right, q.left);
    }
    const room = right - left;
    // The hole is on the side where the removed part was, and it is wide; at another window size the page may have
    // stacked its columns, and then the room beside the box is only its own margin.
    if (!((side.right && right - b.right >= MIN_HOLE) || (side.left && b.left - left >= MIN_HOLE))) continue;

    // The running text in the box: its longest block sets the measure. A table is not running text: its width follows
    // its cells (a translation, a date written out make it wider), so it sets the measure only in a box of tables.
    const inBox = ctx.body.filter((el) => box.contains(el));
    const prose = inBox.filter((el) => el.localName !== "table" && !el.closest("table"));
    const runs = prose.length ? prose : inBox;
    const text = runs.slice().sort((x, y) => (y.textContent ?? "").length - (x.textContent ?? "").length)[0];
    if (!text) continue;
    // The character width as first measured (before Translate or Plain changed the words), kept for later looks.
    let avgChar = charWidth.get(box);
    if (avgChar === undefined) {
      avgChar = avgCharWidth(text, win, runs.map((el) => el.textContent ?? "").join(" "));
      charWidth.set(box, avgChar);
    }
    const width = columnWidth({ box: b.width, text: contentBox(text, win).width, avgChar, room });
    const offCentre = Math.abs((b.left + b.right) / 2 - (left + right) / 2);
    if (width - b.width < 8 && offCentre < 24) continue;

    // The headline above the box, where it stands before the box moves (it follows it, G8).
    const head = headDone ? null : headlineOver(box, ctx);
    const headBefore = head ? { h1: boxOf(head.h1), block: boxOf(head.block), text: boxOf(text) } : null;

    const id = `w${n++}`;
    box.setAttribute(WIDEN, id);
    for (const r of freed) r.setAttribute(FREED, `${r.getAttribute(FREED) ?? ""} ${id}`.trim());
    // Only while Distill's view is shown and everything that sat beside the box is still removed.
    const on = `html:not([${ORIGINAL}]):not(:has([${FREED}~="${id}"]:not([${HIDE}])))`;
    const decl = ["box-sizing: border-box", "width: auto", `max-width: min(100%, ${px(width)})`];
    const start = /grid/.test(pcs.display) ? gridStart(b, parent, win) : null;
    if (start) {
      // A grid's tracks may not fill it: centre in the free band itself, from where the box's first track starts.
      decl.push(`grid-column: ${start.line} / -1`, `margin-left: ${px(Math.max(0, (left + right) / 2 - width / 2 - start.x))}`, "margin-right: 0");
    } else {
      decl.push("margin-left: auto", "margin-right: auto");
    }
    const flexRow = /flex/.test(pcs.display) && !/column/.test(pcs.flexDirection);
    if (flexRow) decl.push("flex: 1 1 auto");
    if (cs.float !== "none" && left === pc.left && right === pc.right) decl.push("float: none");
    rules.push(`${on} [${WIDEN}="${id}"] { ${decl.map((d) => `${d} !important`).join("; ")}; }`);
    style.textContent = rules.join("\n");
    count++;

    // Boxes inside it that filled their parent and no longer do (an explicit width of their own) follow it out.
    const inner = path.slice(0, path.indexOf(box)).reverse();
    let f = 0;
    for (const el of inner) {
      const p = el.parentElement;
      if (!p || !filled.has(el) || el.hasAttribute(WIDEN)) continue;
      if (Math.abs(el.getBoundingClientRect().width - contentBox(p, win).width) <= 2) continue;
      const fid = `${id}f${++f}`;
      el.setAttribute(WIDEN, fid);
      const fdecl = ["width: auto", "max-width: none"];
      const pd = win.getComputedStyle(p);
      if (/flex/.test(pd.display) && !/column/.test(pd.flexDirection)) fdecl.push("flex: 1 1 auto");
      rules.push(`${on} [${WIDEN}="${fid}"] { ${fdecl.map((d) => `${d} !important`).join("; ")}; }`);
      style.textContent = rules.join("\n");
      count++;
    }

    // The headline block was left-aligned with the text: it takes the same left edge and right edge as the column
    // now, through margin and max-width only (never its font, size or colour). Checked after: else it stays as it was.
    if (head && headBefore && Math.abs(headBefore.h1.left - headBefore.text.left) <= 8) {
      const dx = boxOf(text).left - headBefore.text.left;
      const right = boxOf(box).right;
      if (Math.abs(dx) >= 4) {
        const hid = `${id}h`;
        const newLeft = headBefore.block.left + dx;
        const margin = (parseFloat(win.getComputedStyle(head.block).marginLeft) || 0) + dx;
        const hdecl = ["box-sizing: border-box", `margin-left: ${px(margin)}`, `max-width: ${px(Math.max(0, right - newLeft))}`];
        const at = rules.length;
        head.block.setAttribute(WIDEN, hid);
        rules.push(`${on} [${WIDEN}="${hid}"] { ${hdecl.map((d) => `${d} !important`).join("; ")}; }`);
        style.textContent = rules.join("\n");
        if (Math.abs(boxOf(head.h1).left - boxOf(text).left) > 8) {
          rules.splice(at, 1);
          style.textContent = rules.join("\n");
          head.block.removeAttribute(WIDEN);
        } else {
          headDone = true;
        }
      }
    }
  }
  return count;
}

/**
 * The page's headline over a widened box: the first h1 shown, outside the box and before it, and the block that
 * carries it (the h1, or its container holding the byline and lead, up to the level of the box). Null when there is
 * none, or the block does not sit right above the box (a site's masthead far above is not the article's headline).
 */
function headlineOver(box: Element, ctx: CleanContext): { h1: Element; block: Element } | null {
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width >= 2 && r.height >= 2 && !el.closest(`[${HIDE}]`); };
  const h1 = ctx.keep.find((el) => el.localName === "h1" && shown(el))
    ?? Array.from(ctx.doc.querySelectorAll("h1")).find(shown);
  if (!h1 || box.contains(h1) || h1.contains(box) || !(h1.compareDocumentPosition(box) & 4 /* box follows h1 */)) return null;
  let block: Element = h1;
  while (block.parentElement && !block.parentElement.contains(box)) block = block.parentElement;
  if (block === ctx.doc.body || block === ctx.doc.documentElement) return null;
  const hb = boxOf(block);
  const b = boxOf(box);
  if (hb.bottom > b.top + 2 || b.top - hb.bottom > 240) return null;
  return { h1, block };
}
