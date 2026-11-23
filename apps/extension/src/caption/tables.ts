// Spark universal-core round 2, card 5 (r2-05): the main text's data tables made readable.
// - A tall table keeps its header row in view while it scrolls by (sticky, below whatever still sticks at the top).
// - A table wider than its column scrolls inside itself, so the page never scrolls sideways.
// - On a phone (<= 480 px) a table of up to 4 columns becomes one card per row: "Header: value" lines.
// Only DATA tables of the main text change; a table that lays out a page (old sites build whole pages from tables) is
// never touched. Everything goes through marker attributes and one Distill style under
// html:not([data-distill-original]):not([data-distill-tables-off]): Original shows the tables as the site made them,
// the switch in More turns it off, and close takes every attribute and the style away.
import type { CleanContext } from "./context";

/** On each data table Distill changes: its id ("t0"), for its own rules. */
const MARK = "data-distill-table";
/** On the table's header: the <thead>, or its first row. */
const HEAD = "data-distill-table-head";
/** On a table of up to 4 columns: one card per row on a phone. */
const CARDS = "data-distill-table-cards";
/** On a body cell of such a table: the header it sits under (the card's "Header:"). */
const LABEL = "data-distill-label";
/** On a table wider than its column now: it scrolls inside itself. */
const WIDE = "data-distill-table-wide";
/** On a table taller than half the window now: its header stays in view. */
const TALL = "data-distill-table-tall";
/** On <html> while the person has turned readable tables off. */
const OFF = "data-distill-tables-off";
const ORIGINAL = "data-distill-original";
const HIDE = "data-distill-hide";

/** A phone: narrow tables become cards at or below this window width (px). */
export const PHONE_MAX = 480;
/** Up to this many columns a table becomes cards on a phone. */
const CARD_COLS = 4;
/** A table taller than this share of the window keeps its header in view. */
const TALL_SHARE = 0.5;
/** A wide table that is also tall scrolls inside a box this tall, so its header can stay in view there. */
const WIDE_TALL_MAX = "70vh";

const ON = `html:not([${ORIGINAL}]):not([${OFF}])`;

interface Table { el: HTMLTableElement; id: string; head: Element; cards: boolean; bg: string | null }
let state: {
  doc: Document; win: Window; tables: Table[]; style: HTMLStyleElement; onResize: () => void; onScroll: () => void; timer: number;
  /** Where the headers stick now (px from the window's top), and a scroll's check of it waiting for the next frame. */
  top: number; frame: number;
} | null = null;

// ---- Which tables hold data (pure DOM reading: no layout, unit-tested) ----

export interface TableShape {
  /** The header: the <thead>, or the first row when it is a header row. */
  head: Element;
  /** The header row whose cells name the columns (the last row of a <thead>). */
  headRow: Element;
  /** The rows of data (every row that is not in the header). */
  rows: Element[];
  /** The columns (the most common count of a row, colspans counted). */
  cols: number;
  /** Each column's header text ("" when it has none). */
  labels: string[];
}

const cellsOf = (tr: Element): Element[] => Array.from(tr.children).filter((c) => c.localName === "td" || c.localName === "th");
const span = (c: Element, attr: "colspan" | "rowspan"): number => Math.max(1, Math.min(50, Number(c.getAttribute(attr)) || 1));
const width = (tr: Element): number => cellsOf(tr).reduce((n, c) => n + span(c, "colspan"), 0);
const text = (el: Element): string => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** The table's own rows, in order (never a nested table's). */
function rowsOf(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    if (child.localName === "tr") rows.push(child);
    else if (/^(thead|tbody|tfoot)$/.test(child.localName)) rows.push(...Array.from(child.children).filter((r) => r.localName === "tr"));
  }
  return rows;
}

/** A header row: every cell with text is a <th>, or (an old site's way) every cell's text is all bold. */
function headerRow(tr: Element): boolean {
  const cells = cellsOf(tr).filter((c) => text(c));
  if (cells.length < 2) return false;
  if (cells.every((c) => c.localName === "th")) return true;
  return cells.every((c) => {
    const b = c.querySelector("b, strong");
    return !!b && text(b) === text(c);
  });
}

/** Block content a data cell does not hold (a layout cell does): paragraphs, lists, headings, forms, frames. */
const BLOCKY = "p, ul, ol, dl, h1, h2, h3, h4, h5, h6, blockquote, iframe, form, video, object, embed";

/**
 * The table's shape when it is a data table, null when it lays out a page or is not a table at all. A data table:
 * - has a header (a <thead>, a first row of <th> or all-bold cells) whose cells name at least half the columns;
 * - has at least one row of data and two columns, and 80% of its rows have the same number of columns;
 * - holds short cell text (median 80 characters or less, none over 600) and almost no block content or large pictures;
 * - holds no other table and no form fields, and does not call itself presentation.
 */
export function dataTable(table: Element): TableShape | null {
  if (table.localName !== "table") return null;
  if (/^(presentation|none)$/.test((table.getAttribute("role") ?? "").trim().toLowerCase())) return null;
  if (table.querySelector("table")) return null;
  if (table.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")) return null;
  const all = rowsOf(table).filter((r) => cellsOf(r).length);
  if (all.length < 2) return null;

  // The header.
  const thead = Array.from(table.children).find((c) => c.localName === "thead");
  const theadRows = thead ? rowsOf(thead).filter((r) => cellsOf(r).length) : [];
  let head: Element | null = null;
  let headRow: Element | null = null;
  let headRows: Element[] = [];
  if (thead && theadRows.length) { head = thead; headRows = theadRows; headRow = theadRows[theadRows.length - 1] as Element; }
  else if (headerRow(all[0] as Element)) { head = all[0] as Element; headRow = head; headRows = [head]; }
  if (!head || !headRow) return null;
  const rows = all.filter((r) => !headRows.includes(r));
  if (!rows.length) return null;

  // Columns: the most common width; most rows have it.
  const widths = rows.map(width);
  const count = new Map<number, number>();
  for (const w of widths) count.set(w, (count.get(w) ?? 0) + 1);
  const cols = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  if (cols < 2) return null;
  if (widths.filter((w) => w === cols).length < 0.8 * rows.length) return null;
  if (Math.abs(width(headRow) - cols) > 1) return null;

  // Cell content: short text, no blocks, no large pictures, not mostly empty.
  const cells = rows.flatMap(cellsOf);
  const lens = cells.map((c) => text(c).length).sort((a, b) => a - b);
  const median = lens[Math.floor(lens.length / 2)] ?? 0;
  if (median > 80 || (lens[lens.length - 1] ?? 0) > 600) return null;
  if (cells.filter((c) => c.querySelector(BLOCKY)).length > 0.2 * cells.length) return null;
  const bigPicture = (c: Element) => Array.from(c.querySelectorAll("img")).some((img) =>
    Number(img.getAttribute("width")) >= 200 || Number(img.getAttribute("height")) >= 160);
  if (cells.some(bigPicture)) return null;
  const empty = cells.filter((c) => !text(c) && !c.querySelector("img, svg")).length;
  if (empty > 0.5 * cells.length) return null;

  // The header names the columns.
  const labels: string[] = [];
  for (const c of cellsOf(headRow)) for (let i = 0; i < span(c, "colspan"); i++) labels.push(text(c));
  if (labels.filter(Boolean).length < Math.ceil(cols / 2)) return null;
  return { head, headRow, rows, cols, labels: labels.slice(0, cols) };
}

/** A data table can become cards: up to 4 columns, one header row, no cell spanning rows or columns in the data. */
function cardable(shape: TableShape): boolean {
  if (shape.cols > CARD_COLS || shape.head.localName === "thead" && rowsOf(shape.head).length > 1) return false;
  return shape.rows.every((r) => width(r) === shape.cols && cellsOf(r).every((c) => span(c, "rowspan") === 1 && span(c, "colspan") === 1));
}

/** The main text's tables: those the page reader took as blocks of running text, and those inside such blocks. */
function candidates(ctx: CleanContext): HTMLTableElement[] {
  const found = new Set<HTMLTableElement>();
  for (const el of ctx.body) {
    if (el.localName === "table") found.add(el as HTMLTableElement);
    el.querySelectorAll("table").forEach((t) => found.add(t));
  }
  return [...found].filter((t) => t.isConnected && !t.closest(`[${HIDE}]`) && !t.closest("nav, footer, [role=navigation]")
    && !ctx.protect.some((p) => p.contains(t) || t.contains(p)));
}

// ---- The page side ----

/** The first opaque background behind `el` (its own or an ancestor's), as CSS; null when a picture is painted there. */
function backgroundOf(el: Element, win: Window): string | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = win.getComputedStyle(e);
    if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
    const m = /rgba?\(([^)]*)\)/.exec(cs.backgroundColor);
    const parts = m ? (m[1] as string).split(/[\s,/]+/).filter(Boolean).map(Number) : [];
    const alpha = parts.length >= 4 ? (parts[3] as number) : parts.length === 3 ? 1 : 0;
    if (alpha >= 0.999) return cs.backgroundColor;
  }
  return null;
}

/** How far down the window something of the page still sticks at the top (a slim sticky header float.ts left alone):
 *  a table's header sticks just below it, never under it. */
function stuckAtTop(doc: Document, win: Window): number {
  if (typeof doc.elementsFromPoint !== "function") return 0;
  let bottom = 0;
  const seen = new Set<Element>();
  for (const x of [0.1, 0.5, 0.9].map((f) => Math.round(win.innerWidth * f))) {
    for (const hit of doc.elementsFromPoint(x, 1)) {
      if (hit.closest(`[${MARK}]`)) continue; // never a table's own sticky header
      for (let e: Element | null = hit; e && e !== doc.body && e !== doc.documentElement; e = e.parentElement) {
        if (seen.has(e)) break;
        seen.add(e);
        if (e.localName === "distill-caption") break;
        const cs = win.getComputedStyle(e);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        const r = e.getBoundingClientRect();
        if (r.top <= 2 && r.bottom > 0 && r.height < win.innerHeight * 0.3) bottom = Math.max(bottom, r.bottom);
      }
    }
  }
  return Math.round(bottom);
}

/** The room the table's column gives it (its nearest block ancestor's content width). */
function room(table: Element, win: Window): number {
  let p = table.parentElement;
  while (p && /^(inline|contents)$/.test(win.getComputedStyle(p).display)) p = p.parentElement;
  if (!p) return win.innerWidth;
  const cs = win.getComputedStyle(p);
  const w = p.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  return Math.min(w > 0 ? w : win.innerWidth, win.innerWidth);
}

/** The rules: one set for every table, plus each table's header background. */
function css(tables: Table[], top: number): string {
  const rules = [
    // Tall: the header row stays in view below whatever still sticks at the top. Its cells get the table's own
    // background, so the rows scrolling under it never show through.
    `${ON} [${MARK}][${TALL}] [${HEAD}] { position: sticky !important; top: ${top}px !important; z-index: 2 !important; }`,
    `${ON} [${MARK}][${TALL}] [${HEAD}] > * { background-clip: padding-box; }`,
    // Wide: the table scrolls inside itself; the page never scrolls sideways. Also tall: it scrolls inside a box,
    // where its header stays in view (sticky cannot follow the page out of a box that scrolls).
    `${ON} table[${MARK}][${WIDE}] { display: block !important; max-width: 100% !important; overflow-x: auto !important; overscroll-behavior-x: contain; }`,
    `${ON} table[${MARK}][${WIDE}][${TALL}] { max-height: ${WIDE_TALL_MAX} !important; overflow-y: auto !important; }`,
    `${ON} table[${MARK}][${WIDE}][${TALL}] [${HEAD}] { top: 0 !important; }`,
    // A phone: up to 4 columns, one card per row. The header row is still there for a screen reader, off screen.
    `@media (max-width: ${PHONE_MAX}px) {`,
    `  ${ON} table[${CARDS}], ${ON} table[${CARDS}] > thead, ${ON} table[${CARDS}] > tbody, ${ON} table[${CARDS}] > tfoot,`
      + ` ${ON} table[${CARDS}] tr, ${ON} table[${CARDS}] td, ${ON} table[${CARDS}] th, ${ON} table[${CARDS}] caption`
      + ` { display: block !important; width: auto !important; height: auto !important; }`,
    `  ${ON} table[${CARDS}] { max-width: 100% !important; border: 0 !important; border-spacing: 0 !important; }`,
    `  ${ON} table[${CARDS}] [${HEAD}] { position: absolute !important; width: 1px !important; height: 1px !important; overflow: hidden !important; clip-path: inset(50%) !important; white-space: nowrap !important; }`,
    `  ${ON} table[${CARDS}] tr:not([${HEAD}]) { margin: 0 0 12px !important; padding: 8px 12px !important; border: 1px solid color-mix(in srgb, currentColor 30%, transparent) !important; border-radius: 6px !important; }`,
    `  ${ON} table[${CARDS}] tr:not([${HEAD}]) > td, ${ON} table[${CARDS}] tr:not([${HEAD}]) > th { border: 0 !important; padding: 2px 0 !important; text-align: start !important; }`,
    `  ${ON} table[${CARDS}] [${LABEL}]::before { content: attr(${LABEL}) ": "; font-weight: 700; }`,
    `}`,
  ];
  // Each table's header cells, painted with the background behind the table (from the page itself: no colour of
  // Distill's own). A header that already has its own colour keeps it.
  for (const t of tables) if (t.bg) rules.push(`${ON} [${MARK}="${t.id}"] [${HEAD}] > th, ${ON} [${MARK}="${t.id}"] [${HEAD}] > td, ${ON} [${MARK}="${t.id}"] [${HEAD}] > tr > * { background-color: ${t.bg} !important; }`);
  return rules.join("\n");
}

/** Which tables are wide and tall in the window as it is now (run again on every resize). */
function measure(): void {
  if (!state) return;
  const { doc, win, tables, style } = state;
  for (const t of tables) { t.el.removeAttribute(WIDE); t.el.removeAttribute(TALL); }
  const phone = win.innerWidth <= PHONE_MAX;
  // Read every size first, then write (one layout).
  const sizes = tables.map((t) => {
    const r = t.el.getBoundingClientRect();
    return { wide: r.width > room(t.el, win) + 1 || r.right > win.innerWidth + 1, tall: r.height > win.innerHeight * TALL_SHARE };
  });
  tables.forEach((t, i) => {
    const s = sizes[i] as { wide: boolean; tall: boolean };
    const carded = phone && t.cards;
    if (s.wide && !carded) t.el.setAttribute(WIDE, "");
    if (s.tall && !carded) t.el.setAttribute(TALL, "");
  });
  state.top = stuckAtTop(doc, win);
  style.textContent = css(tables, state.top);
}

/** A header that shows itself only once the page scrolls (many sites do that): while a table keeps its header in
 *  view, each scroll looks again, once a frame, at what sticks at the top, so the table's header stays below it. */
function recheckTop(): void {
  if (!state || state.frame) return;
  const s = state;
  if (!s.tables.some((t) => t.el.hasAttribute(TALL)) || s.doc.documentElement.hasAttribute(OFF) || s.doc.documentElement.hasAttribute(ORIGINAL)) return;
  s.frame = s.win.requestAnimationFrame(() => {
    s.frame = 0;
    if (state !== s) return;
    const top = stuckAtTop(s.doc, s.win);
    if (top !== s.top) { s.top = top; s.style.textContent = css(s.tables, top); }
  });
}

/** Makes the main text's data tables readable; returns how many. Run again (Stay clean after the page changed), it
 *  keeps the person's switch: off stays off. */
export function readableTables(ctx: CleanContext): number {
  const { doc, win } = ctx;
  const off = doc.documentElement.hasAttribute(OFF);
  clearTables(doc);
  if (off) doc.documentElement.setAttribute(OFF, "");
  const tables: Table[] = [];
  for (const el of candidates(ctx)) {
    const shape = dataTable(el);
    if (!shape) continue;
    const id = `t${tables.length}`;
    const cards = cardable(shape);
    el.setAttribute(MARK, id);
    shape.head.setAttribute(HEAD, "");
    if (cards) {
      el.setAttribute(CARDS, "");
      for (const row of shape.rows) cellsOf(row).forEach((c, i) => { const l = shape.labels[i]; if (l) c.setAttribute(LABEL, l); });
    }
    const first = cellsOf(shape.headRow)[0];
    const own = first ? backgroundOf(first, win) : null;
    tables.push({ el, id, head: shape.head, cards, bg: own ?? (first ? "Canvas" : null) });
  }
  if (!tables.length) return 0;
  const style = doc.createElement("style");
  style.setAttribute("data-distill", "tables");
  (doc.head ?? doc.documentElement).append(style);
  const onResize = () => {
    if (!state) return;
    win.clearTimeout(state.timer);
    state.timer = win.setTimeout(measure, 120);
  };
  const onScroll = () => recheckTop();
  state = { doc, win, tables, style, onResize, onScroll, timer: 0, top: 0, frame: 0 };
  win.addEventListener("resize", onResize);
  win.addEventListener("scroll", onScroll, { passive: true });
  measure();
  return tables.length;
}

/** Reads the window again (a header that sticks came back): which tables are wide and tall, and where the top is. */
export function remeasureTables(): void {
  measure();
}

/** The switch in More: on (true) or off. Returns how many tables are changed now (0 while off). */
export function setTables(doc: Document, on: boolean): number {
  doc.documentElement.toggleAttribute(OFF, !on);
  if (on) measure();
  return on ? state?.tables.length ?? 0 : 0;
}

/** What the live probe and the e2e read: each changed table and what it gets in the window as it is now. */
export function tableReport(): { id: string; cols: number; cards: boolean; wide: boolean; tall: boolean }[] {
  return (state?.tables ?? []).map((t) => ({
    id: t.id, cols: dataTable(t.el)?.cols ?? 0, cards: t.cards, wide: t.el.hasAttribute(WIDE), tall: t.el.hasAttribute(TALL),
  }));
}

/** Takes every change off (close). */
export function clearTables(doc: Document): void {
  if (state) {
    state.win.removeEventListener("resize", state.onResize);
    state.win.removeEventListener("scroll", state.onScroll);
    state.win.clearTimeout(state.timer);
    if (state.frame) state.win.cancelAnimationFrame(state.frame);
    state.style.remove();
    state = null;
  }
  doc.querySelectorAll('style[data-distill="tables"]').forEach((s) => s.remove());
  for (const attr of [MARK, HEAD, CARDS, LABEL, WIDE, TALL]) doc.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
  doc.documentElement.removeAttribute(OFF);
}
