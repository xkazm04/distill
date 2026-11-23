// r5-05 The cleaned page, typeset: a typesetter's pass on the main column, part of the reading layer (comfort.ts), so
// the "Easier to read" switch and Original take it back with the rest. Only spacing and sizes, never the site's fonts or
// colours (Dark page owns colours), and only where the page falls outside the comfortable range:
// - a heading sits closer to its own text than to the text before it, with room above, and its lines held together;
// - paragraphs that touch get a gap; list items and quotes get room between lines like paragraphs;
// - a list's markers stay inside the column; a quote that is not set apart gets an indent and a rule in its own colour;
// - numbers in the main text's data tables line up (tabular figures, numeric cells right-aligned).
// Everything is measured from the page as it is laid out now and returned as declarations for comfort.ts's one style.
import { dataTable, type TableShape } from "./tables";
import { headingLeading, headingLeadingOff, headingSpace, lineHeightFor, numericColumns, paragraphGap } from "@distill/engine";

/** Where a typeset declaration goes: `el` gets `decl`, `block` is the main-text block it belongs to (the strip counts
 *  blocks). */
export type Mark = (el: Element, decl: string[], block: Element) => void;

export interface TypesetInput {
  win: Window;
  /** The main text's blocks that are shown (comfort.ts's `body`). */
  body: readonly Element[];
  /** The main column's headings that are shown (not the headline). */
  headings: readonly Element[];
  /** The size (px) of the running text once the reading layer's size floor applies. */
  text: number;
  /** How much the reading layer grows the text (1: not at all). */
  scale: number;
  mark: Mark;
}

/** Margins collapse between block siblings in a block parent: what a gap is made of. */
const COLLAPSING = /^(block|flow-root|list-item)$/;
const BLOCKISH = /^(block|list-item|table|flow-root|flex|grid)$/;
const px = (n: number) => `${Math.round(n * 10) / 10}px`;
const num = (v: string) => parseFloat(v) || 0;

/** The nearest element sibling that takes space, before or after. */
function sibling(el: Element, win: Window, dir: "previousElementSibling" | "nextElementSibling"): Element | null {
  for (let s = el[dir]; s; s = s[dir]) {
    const cs = win.getComputedStyle(s);
    if (cs.display === "none" || /absolute|fixed/.test(cs.position)) continue;
    const r = s.getBoundingClientRect();
    if (r.height < 1) continue;
    return s;
  }
  return null;
}

/** True when `a` and `b` are block siblings whose gap is just their collapsed margins (no float, padding or wrapper). */
function plainFlow(a: Element, b: Element, win: Window): boolean {
  const parent = a.parentElement;
  if (!parent || parent !== b.parentElement || !COLLAPSING.test(win.getComputedStyle(parent).display)) return false;
  return [a, b].every((e) => { const cs = win.getComputedStyle(e); return BLOCKISH.test(cs.display) && cs.float === "none"; });
}

export function typeset(t: TypesetInput): number {
  const { win } = t;
  const decls = new Map<Element, { decl: string[]; block: Element }>();
  const quotes = new Set<Element>();
  const add = (el: Element, block: Element, ...d: string[]) => {
    const e = decls.get(el);
    if (e) e.decl.push(...d);
    else decls.set(el, { decl: d, block });
  };

  // Headings: rhythm, and lines held together.
  for (const h of t.headings) {
    if (h.localName === "h1") continue;
    const cs = win.getComputedStyle(h);
    const r = h.getBoundingClientRect();
    const size = num(cs.fontSize) * t.scale;
    const prev = sibling(h, win, "previousElementSibling");
    const next = sibling(h, win, "nextElementSibling");
    const mt = num(cs.marginTop), mb = num(cs.marginBottom);
    let above: number | null = null, below: number | null = null;
    let nextMt = 0;
    if (prev && plainFlow(prev, h, win)) {
      const gap = r.top - prev.getBoundingClientRect().bottom;
      // The gap is the larger of the two margins: anything else (a padding, a border) and it is not ours to judge.
      if (Math.abs(gap - Math.max(mt, num(win.getComputedStyle(prev).marginBottom))) <= 2) above = gap;
    }
    if (next && plainFlow(h, next, win)) {
      const gap = next.getBoundingClientRect().top - r.bottom;
      nextMt = num(win.getComputedStyle(next).marginTop);
      if (Math.abs(gap - Math.max(mb, nextMt)) <= 2) below = gap;
    }
    const fix = headingSpace({ above, below, text: t.text });
    if (fix?.above != null) add(h, h, `margin-top: ${px(fix.above)}`);
    if (fix?.below != null && next) {
      add(h, h, `margin-bottom: ${px(fix.below)}`);
      // Collapsed with the next block's own top margin: that one must not be larger.
      if (nextMt > fix.below) add(next, h, `margin-top: ${px(fix.below)}`);
    }
    // A heading over several lines reads as one unit: its lines close together, never pulled apart.
    const lh = num(cs.lineHeight) * t.scale;
    if (lh > 0 && r.height >= 1.8 * num(cs.lineHeight) && headingLeadingOff(lh / size)) {
      add(h, h, `line-height: ${px(headingLeading(size) * size)}`);
    }
  }

  for (const block of t.body) {
    const cs = win.getComputedStyle(block);
    const size = num(cs.fontSize) * t.scale;
    // Paragraphs that touch the next one.
    if (block.localName === "p") {
      const next = sibling(block, win, "nextElementSibling");
      if (next?.localName === "p" && plainFlow(block, next, win)) {
        const gap = next.getBoundingClientRect().top - block.getBoundingClientRect().bottom;
        const want = Math.abs(gap - Math.max(num(cs.marginBottom), num(win.getComputedStyle(next).marginTop))) <= 2 ? paragraphGap({ size, gap }) : null;
        if (want !== null) add(block, block, `margin-bottom: ${px(want)}`);
      }
    }
    // Lists: markers inside the column, and items that wrap get room between their lines.
    if (/^(ul|ol)$/.test(block.localName)) {
      const items = Array.from(block.children).filter((li) => li.localName === "li");
      const marked = cs.listStyleType !== "none" && cs.listStylePosition === "outside"
        && items.some((li) => win.getComputedStyle(li).display === "list-item");
      if (marked && num(cs.paddingInlineStart || cs.paddingLeft) + num(cs.marginInlineStart || cs.marginLeft) < 0.9 * size) {
        add(block, block, `padding-inline-start: ${px(1.4 * size)}`);
      }
      for (const li of items.slice(0, 200)) {
        const ls = win.getComputedStyle(li);
        const own = num(ls.fontSize);
        const line = ls.lineHeight === "normal" ? null : num(ls.lineHeight);
        if (li.getBoundingClientRect().height < 1.8 * (line ?? 1.2 * own)) continue;
        const want = lineHeightFor({ size: own, lineHeight: line, scale: t.scale, paragraph: true });
        if (want !== null) add(li, block, `line-height: ${px(want)}`);
      }
    }
    // A quote: room between its lines like a paragraph, and set apart from the text when nothing sets it apart.
    // The reader may take the quote's paragraph as the block: the quote is around it.
    const quote = block.localName === "blockquote" ? block : block.parentElement?.closest("blockquote");
    if (quote && !quotes.has(quote)) {
      quotes.add(quote);
      const qs = win.getComputedStyle(quote);
      if (quote === block) {
        const line = qs.lineHeight === "normal" ? null : num(qs.lineHeight);
        const want = lineHeightFor({ size: num(qs.fontSize), lineHeight: line, scale: t.scale, paragraph: true });
        if (want !== null && quote.getBoundingClientRect().height >= 1.8 * (line ?? 1.2 * num(qs.fontSize))) add(quote, block, `line-height: ${px(want)}`);
      }
      // Its own indent, padding and rule, plus any its paragraph has (the reader's block inside it).
      const inner = quote === block ? qs : cs;
      const indent = num(qs.marginLeft) + num(qs.paddingLeft) + num(qs.borderLeftWidth)
        + (quote === block ? 0 : num(inner.marginLeft) + num(inner.paddingLeft) + num(inner.borderLeftWidth));
      const painted = qs.backgroundImage !== "none" || !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(qs.backgroundColor);
      if (indent < 0.5 * size && !painted && num(qs.borderInlineStartWidth) === 0) {
        add(quote, block, "padding-inline-start: 1em", "border-inline-start: 0.2em solid color-mix(in srgb, currentColor 35%, transparent)");
      }
    }
    // Numbers in data tables.
    const tables = block.localName === "table" ? [block] : Array.from(block.querySelectorAll("table"));
    for (const table of tables) {
      if (table.closest("[data-distill-hide]")) continue;
      const shape = dataTable(table);
      if (shape) numbers(table, shape, block, win, add);
    }
  }

  for (const [el, { decl, block }] of decls) t.mark(el, decl, block);
  return decls.size;
}

/** The cells of `row` by column (colspans counted; a cell spanning columns stands for its first). */
function byColumn(row: Element): Map<number, Element> {
  const out = new Map<number, Element>();
  let i = 0;
  for (const c of Array.from(row.children)) {
    if (c.localName !== "td" && c.localName !== "th") continue;
    out.set(i, c);
    i += Math.max(1, Math.min(50, Number(c.getAttribute("colspan")) || 1));
  }
  return out;
}

/** Tabular figures in a data table that holds numbers, and its numeric columns right-aligned (header cell included). */
function numbers(table: Element, shape: TableShape, block: Element, win: Window, add: (el: Element, block: Element, ...d: string[]) => void): void {
  const rows = shape.rows.map(byColumn);
  const cols = Array.from({ length: shape.cols }, (_, i) => rows.map((r) => (r.get(i)?.textContent ?? "").replace(/\s+/g, " ").trim()));
  const numeric = numericColumns(cols);
  if (!numeric.some(Boolean)) return;
  if (!/tabular-nums/.test(win.getComputedStyle(table).fontVariantNumeric)) add(table, block, "font-variant-numeric: tabular-nums");
  const head = byColumn(shape.headRow);
  numeric.forEach((isNum, i) => {
    if (!isNum) return;
    for (const cell of [head.get(i), ...rows.map((r) => r.get(i))]) {
      if (!cell || Number(cell.getAttribute("colspan") ?? 1) > 1) continue;
      if (!/^(right|end)$/.test(win.getComputedStyle(cell).textAlign)) add(cell, block, "text-align: end");
    }
  });
}
