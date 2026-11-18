// Print-only PDFs: forms made for printing, with printed text and lines to write on but no form field. Distill finds the
// places a person writes on from what the page prints and draws, names each one from the printed text around it, and
// gives the engine an ordinary FormStructure, so Wayfill runs as it does for a fillable PDF. The answers are drawn onto a
// copy of the page (overlay.ts) and every one is checked by reading the copy back with pdf.js.
//
// Finding the places is a guess, and everything here behaves like it knows that:
// - A place whose label cannot be told with confidence is named by its position ("the line under ...") and marked so
//   (PrintSpot.label "position"), or left out when there is nothing to name it by. Missing a place is better than
//   asking the wrong question for it.
// - Places for the office (a stamp, "Vyplní úřad") and for a handwritten signature are left out.
// - Text that sits where an answer goes (typed onto a line, or inside a box whose label is printed outside it) is an
//   answer someone already wrote, not a label: it never becomes a label, a section or a block of the page model.
//   Distill's own answers carry a marked-content tag and are never read at all (text.ts, ANSWER_TAG). What cannot be
//   told apart: text typed inside a box whose label is itself printed inside the box, at its left (that is how some
//   forms print labels), and text typed where Distill found no place at all.
import type { FieldKind, FieldStructure } from "@distill/engine";
import type { PageDrawing, Seg } from "./drawing.js";
import { cleanLabel } from "./labels.js";
import { bodySize, bottom, buildRuns, collapse, isHeading, top, type Run } from "./text.js";
import type { Box, PdfBinding, PrintSpot } from "./types.js";

// ---------------------------------------------------------------- text: labels, leaders and printed boxes

/** Printed underscores or dots for handwriting: at least three underscores, or four dots (an ellipsis is three). */
const LEADER = /_{3,}|[.…]{4,}(?:\s*[.…]+)*/gu;
/** Characters that print an empty tick box. */
const TICK_GLYPHS = /[☐□▢❏❐❑❒⬜]/u;

/** Rough advance widths, in ems, so a position inside a text item can be estimated from its characters. */
function charWidth(ch: string): number {
  if (/[.,:;'’|!il ]/u.test(ch)) return 0.28;
  if (ch === "…") return 0.9;
  if (/[_]/u.test(ch)) return 0.5;
  if (/[ftjr()\-/]/u.test(ch)) return 0.36;
  if (/[mwMW]/u.test(ch)) return 0.82;
  if (/\p{Lu}/u.test(ch) || /[☐□▢❏❐❑❒⬜]/u.test(ch)) return 0.66;
  return 0.54;
}

/** Positions inside one text item: x of the boundary before character `i`. */
function positions(it: Run): (i: number) => number {
  const chars = [...it.text];
  const acc: number[] = [0];
  for (const ch of chars) acc.push((acc[acc.length - 1] as number) + charWidth(ch));
  const total = acc[acc.length - 1] || 1;
  return (i: number) => it.x0 + ((it.x1 - it.x0) * (acc[Math.min(i, chars.length)] as number)) / total;
}

/** A stretch of a text item: printed words, a leader, or an empty box printed as a character. */
export interface Piece {
  kind: "words" | "leader" | "glyph";
  run: Run;
}

/**
 * One text item cut into its words, its leaders and its printed tick boxes, each with its own estimated position.
 * Used when reading the form and, independently of that reading, when the filled copy is checked (overlay.ts): a
 * leader or a printed box is where an answer may be drawn, words are ink an answer must never cover.
 */
export function cutItem(it: Run): Piece[] {
  const text = it.text;
  const chars = [...text];
  // Character index of each UTF-16 index, so regex positions map onto characters.
  const at = positions(it);
  const cpIndex: number[] = [];
  { let k = 0; for (const ch of chars) { for (let u = 0; u < ch.length; u++) cpIndex.push(k); k++; } cpIndex.push(k); }
  const marks: { s: number; e: number; kind: "leader" | "glyph" }[] = [];
  for (const m of text.matchAll(LEADER)) marks.push({ s: cpIndex[m.index ?? 0] as number, e: cpIndex[(m.index ?? 0) + m[0].length] as number, kind: "leader" });
  chars.forEach((ch, i) => { if (TICK_GLYPHS.test(ch)) marks.push({ s: i, e: i + 1, kind: "glyph" }); });
  marks.sort((a, b) => a.s - b.s);
  const out: Piece[] = [];
  let from = 0;
  const words = (s: number, e: number) => {
    const raw = chars.slice(s, e).join("");
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (!t) return;
    const s2 = s + [...raw.slice(0, lead)].length;
    out.push({ kind: "words", run: { ...it, text: t, x0: at(s2), x1: at(s2 + [...t].length) } });
  };
  for (const m of marks) {
    if (m.s < from) continue;
    words(from, m.s);
    out.push({ kind: m.kind, run: { ...it, text: chars.slice(m.s, m.e).join(""), x0: at(m.s), x1: at(m.e) } });
    from = m.e;
  }
  words(from, chars.length);
  return out;
}

/** A printed item that runs over the start of a box below it is cut at the space nearest that start: one item can hold
 *  the labels of two boxes ("ID Datové schránky E-mail" over two boxes side by side). */
function splitAtGuards(w: Run, guards: { page: number; x1: number; x2: number; y1: number; y2: number }[]): Run[] {
  const g = guards.find((b) => b.page === w.page && b.y1 <= w.y + 0.5 * w.size && b.y2 >= w.y && b.x1 > w.x0 + 4 && b.x2 < w.x1 - 4);
  if (!g) return [w];
  const chars = [...w.text];
  const at = positions(w);
  let best = -1;
  chars.forEach((ch, i) => { if (ch === " " && Math.abs(at(i) - g.x1) <= 14 && (best < 0 || Math.abs(at(i) - g.x1) < Math.abs(at(best) - g.x1))) best = i; });
  if (best < 0) return [w];
  const a = chars.slice(0, best).join("").trim(), b = chars.slice(best + 1).join("").trim();
  // Only where a new label starts: a capital letter or a lettered item ("E-mail", "b) jméno"), not mid-sentence.
  if (!a || !b || !/^(?:\p{Lu}|[a-z]\)\s)/u.test(b)) return [w];
  // The cut is where the box starts, so the two halves stay apart when runs are joined.
  return [{ ...w, text: a, x1: Math.min(at(best), g.x1 - 0.5) }, ...splitAtGuards({ ...w, text: b, x0: Math.max(at(best + 1), g.x2 + 0.5) }, guards)];
}

// ---------------------------------------------------------------- geometry helpers

interface Rect { page: number; x1: number; y1: number; x2: number; y2: number }
const W = (r: Rect) => r.x2 - r.x1;
const H = (r: Rect) => r.y2 - r.y1;
const inkOf = (r: Run): Rect => ({ page: r.page, x1: r.x0, x2: r.x1, y1: bottom(r), y2: top(r) });
const overlaps = (a: Rect, b: Rect, pad = 0) => a.page === b.page && a.x1 < b.x2 - pad && a.x2 > b.x1 + pad && a.y1 < b.y2 - pad && a.y2 > b.y1 + pad;
const midY = (r: Run) => r.y + 0.3 * r.size;
/** The run is printed on the row of `b`: its middle inside the row band. */
const onRow = (r: Run, b: Rect, pad = 1.5) => r.page === b.page && midY(r) >= b.y1 - pad && midY(r) <= b.y2 + pad;
const insideRect = (r: Run, b: Rect) => r.page === b.page && r.x0 >= b.x1 - 1 && r.x1 <= b.x2 + 1 && midY(r) >= b.y1 && midY(r) <= b.y2;

// ---------------------------------------------------------------- boxes from ruled lines

/** How far a line may stop short of a corner and still close it (rounded corners stop up to ~5pt short). */
const REACH = 5.5;

/** A line on `at` runs from a to b: it may stop short of either end by REACH, and covers at least a third of the span
 *  (so a line that only reaches across a gap does not close a box). */
function covers(segs: Seg[], dir: "h" | "v", at: number, a: number, b: number): boolean {
  return segs.some((s) => {
    const [p, q, pos] = dir === "h" ? [s.x1, s.x2, s.y1] : [s.y1, s.y2, s.x1];
    return Math.abs(pos - at) <= 0.9 && p <= a + REACH && q >= b - REACH && Math.min(q, b) - Math.max(p, a) >= 0.35 * (b - a);
  });
}

/**
 * The smallest closed rectangles the ruled lines of a page make (the cells of a table, the boxes of a box-style form,
 * the squares of a row of character boxes): for each corner where a horizontal and a vertical line meet, the nearest
 * corner below and the nearest to its right that close a rectangle with lines on all four sides.
 */
export function cellsOf(d: PageDrawing): Rect[] {
  const pts: { x: number; y: number }[] = [];
  for (const h of d.h) for (const v of d.v) {
    // Lines that meet or cross make a corner. Lines that stop short of each other make one only when both end there
    // (a rounded corner); one that stops short of a line running on past it does not (a box under a section line).
    const hGap = Math.max(0, h.x1 - v.x1, v.x1 - h.x2);
    const vGap = Math.max(0, v.y1 - h.y1, h.y1 - v.y2);
    const meets = hGap <= 1.6 && vGap <= 1.6;
    const rounded = hGap <= REACH && vGap <= REACH && Math.min(Math.abs(h.x1 - v.x1), Math.abs(h.x2 - v.x1)) <= REACH && Math.min(Math.abs(v.y1 - h.y1), Math.abs(v.y2 - h.y1)) <= REACH;
    if (meets || rounded) pts.push({ x: v.x1, y: h.y1 });
  }
  const uniq: { x: number; y: number }[] = [];
  for (const p of pts.sort((a, b) => b.y - a.y || a.x - b.x)) if (!uniq.some((q) => Math.abs(q.x - p.x) <= 0.8 && Math.abs(q.y - p.y) <= 0.8)) uniq.push(p);
  const has = (x: number, y: number) => uniq.some((q) => Math.abs(q.x - x) <= 0.9 && Math.abs(q.y - y) <= 0.9);
  const out: Rect[] = [];
  for (const p of uniq) {
    const below = uniq.filter((q) => Math.abs(q.x - p.x) <= 0.9 && q.y < p.y - 3 && covers(d.v, "v", p.x, q.y, p.y)).sort((a, b) => b.y - a.y);
    const right = uniq.filter((q) => Math.abs(q.y - p.y) <= 0.9 && q.x > p.x + 3 && covers(d.h, "h", p.y, p.x, q.x)).sort((a, b) => a.x - b.x);
    let found: Rect | null = null;
    for (const q of below) {
      for (const r of right) {
        if (has(r.x, q.y) && covers(d.h, "h", q.y, p.x, r.x) && covers(d.v, "v", r.x, q.y, p.y)) { found = { page: d.page, x1: p.x, y1: q.y, x2: r.x, y2: p.y }; break; }
      }
      if (found) break;
    }
    // A rectangle crossed by a line inside it is not one box but several (or the gap between two rows of boxes).
    if (found) {
      const f: Rect = found;
      const crossed = d.h.some((h) => h.y1 > f.y1 + 1 && h.y1 < f.y2 - 1 && Math.min(h.x2, f.x2) - Math.max(h.x1, f.x1) >= 0.8 * W(f)) ||
        d.v.some((v) => v.x1 > f.x1 + 1 && v.x1 < f.x2 - 1 && Math.min(v.y2, f.y2) - Math.max(v.y1, f.y1) >= 0.8 * H(f));
      if (crossed) found = null;
    }
    if (found && W(found) >= 4 && H(found) >= 4 && !out.some((c) => Math.abs(c.x1 - found.x1) < 1 && Math.abs(c.x2 - found.x2) < 1 && Math.abs(c.y1 - found.y1) < 1 && Math.abs(c.y2 - found.y2) < 1)) out.push(found);
  }
  return out;
}

// ---------------------------------------------------------------- places to write

/** A place found on the page, before it is labelled. */
interface Spot {
  page: number;
  kind: PrintSpot["kind"];
  from: PrintSpot["from"];
  /** Writing areas in order (lines, character boxes, date parts, the square). */
  areas: Rect[];
  baselines?: number[];
  /** The drawn or printed thing itself (the box, the leader, the row of boxes), for finding its label. */
  frame: Rect;
  /** Runs printed inside a box (frame): its label, or someone's answer once the box has a label outside it. */
  inside?: Run[];
  /** Text size of a leader, for spacing rules. */
  size?: number;
  /** A box with room to write only to the right of its inside text. */
  rightOfText?: boolean;
  label?: string;
  labelFrom?: "printed" | "position";
  /** Runs that are this place's label (kept from being anyone else's). */
  claims?: Run[];
  drop?: string;
}

const LINE_H = 14; // one writing line in a tall box

/** The room above y within [x1, x2] before printed ink or another line, capped. */
function roomAbove(page: number, y: number, x1: number, x2: number, ink: Rect[], hs: Seg[], cap: number): number {
  let room = cap;
  for (const r of ink) if (r.page === page && r.x1 < x2 && r.x2 > x1 && r.y1 >= y - 0.5) room = Math.min(room, r.y1 - y);
  for (const s of hs) if (s.page === page && s.x1 < x2 - 2 && s.x2 > x1 + 2 && s.y1 > y + 0.5) room = Math.min(room, s.y1 - y);
  return room;
}

/** The writing area inside a box: all of it when nothing is printed inside; below a caption at its top; right of a
 *  label at its left. Null when printed text leaves no room for an answer. */
function freeIn(box: Rect, inside: Run[]): { area: Rect; rightOfText: boolean } | null {
  const inset = (r: Rect): Rect => ({ page: r.page, x1: r.x1 + 1.5, x2: r.x2 - 1.5, y1: r.y1 + 1, y2: r.y2 - 1 });
  if (!inside.length) return { area: inset(box), rightOfText: false };
  const textBottom = Math.min(...inside.map(bottom));
  const textRight = Math.max(...inside.map((r) => r.x1));
  const textLeft = Math.min(...inside.map((r) => r.x0));
  // Text that does not start at the box's left (a caption at the bottom or in the middle, "podací razítko") is not a
  // label for an answer: nothing in such a box is offered.
  if (textLeft > box.x1 + Math.max(14, 0.12 * W(box))) return null;
  const belowCaption = { page: box.page, x1: box.x1 + 1.5, x2: box.x2 - 1.5, y1: box.y1 + 1, y2: textBottom - 0.5 };
  const allTop = inside.every((r) => bottom(r) >= box.y1 + 0.4 * H(box));
  if (allTop && H(belowCaption) >= 8) return { area: belowCaption, rightOfText: false };
  // Room right of a label at the box's left: only in a box one line high. A tall box with a line of text in it is a
  // table cell that says something (the row's text), not a place to write.
  const right = { page: box.page, x1: textRight + 3, x2: box.x2 - 1.5, y1: box.y1 + 1, y2: box.y2 - 1 };
  const textSize = Math.max(...inside.map((r) => r.size));
  if (W(right) >= Math.max(30, 0.2 * W(box)) && H(box) <= 2.6 * textSize) return { area: right, rightOfText: true };
  return null;
}

/** Writing lines in an area: one when it is a line high, else one per LINE_H from the top. */
function linesIn(area: Rect): { areas: Rect[]; baselines: number[] } {
  const n = H(area) > 2.2 * LINE_H ? Math.min(8, Math.floor(H(area) / LINE_H)) : 1;
  if (n === 1) return { areas: [area], baselines: [area.y1 + Math.max(1.5, 0.22 * H(area))] };
  const areas: Rect[] = [], baselines: number[] = [];
  for (let k = 0; k < n; k++) {
    const y2 = area.y2 - k * LINE_H;
    areas.push({ ...area, y1: y2 - LINE_H, y2 });
    baselines.push(y2 - LINE_H + 3);
  }
  return { areas, baselines };
}

// ---------------------------------------------------------------- labels

/** "1.", "a)", "(3)", "II." printed before a label: a number, not a name. */
const ENUM_PREFIX = /^(?:\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[.)]\)?\s+)+/iu;
const ENUM_ONLY = /^\(?(?:\d{1,3}|[a-z]|[ivx]{1,4})[.)]\)?$/iu;
/** A place for the office, not for the person: a stamp, "Vyplní úřad", "for official use". */
const FOR_OFFICE = /razítk|\bstamp\b|vyplní\s+(?:úřad|ossz|pssz|správce|zastupitelsk|pracoviště|finanční|orgán|ministerstv)|vyplňuje\s+(?:úřad|správce)|nevyplňujte|do not fill|official use|office use|úřední záznam|pro úřední|převzal|podací|evidenční štítek/iu;
/** A place to sign by hand. "Místo a datum podpisu" (place and date) is not one. */
const SIGNATURE = /podpis|signature|підпис/iu;
const NOT_ONLY_SIGNATURE = /míst|datum|jméno|(?<!\p{L})(?:dne|date|place|name)(?!\p{L})/iu;

/** The end of a sentence: a full stop after a word, not after an abbreviation ("č. p.", "nar."). */
const SENTENCE_END = /\p{L}{4,}[)"”“]?\.\s*$|[!?]\s*$/u;

function labelText(parts: Run[]): string {
  const t = cleanLabel(parts.map((r) => r.text).join(" ")).replace(ENUM_PREFIX, "").replace(/^[-–•]\s+/u, "");
  return collapse(t.replace(/\s*[*:]+\s*$/u, "")).trim();
}

/** The block a label continues in: lines that start where `first` starts, closely spaced, `dir` from it. */
function blockLines(runs: Run[], first: Run, dir: "up" | "down", stop: (r: Run) => boolean, max = 3): Run[] {
  const out: Run[] = [];
  let cur = first;
  for (let k = 0; k < max; k++) {
    const next = runs.find((r) => r !== cur && r.page === cur.page && Math.abs(r.x0 - first.x0) <= 3 && Math.abs(r.size - cur.size) < 1.5 &&
      (dir === "up" ? r.y - cur.y : cur.y - r.y) > 0.5 * cur.size && (dir === "up" ? r.y - cur.y : cur.y - r.y) <= 1.3 * cur.size);
    if (!next || stop(next)) break;
    // A line that ends a sentence is not part of a label (an instruction printed above it).
    if (dir === "up" && SENTENCE_END.test(next.text)) break;
    if (dir === "down" && SENTENCE_END.test(cur.text)) break;
    out.push(next);
    cur = next;
  }
  return out;
}

// ---------------------------------------------------------------- the reading

export interface PrintedReading {
  fields: FieldStructure[];
  bindings: PdfBinding[];
  /** Text that sits where an answer goes: someone's answer, kept out of labels and the page model. */
  answers: Run[];
  /** True when the pages are pictures with no drawn lines: a scan or a photo. */
  scan: boolean;
  /** Places found and left out, with why (for the office, a signature, no label): for tests and the benchmark. */
  dropped: { label: string; why: string; box: Box }[];
}

const DATEISH = /(datum|date|narozen|дата)/iu;
const DATE_ONLY = /^(?:datum|date)\b(?!.*(?:míst|place|podpis|sign))/iu;

/** Places to write on a print-only document, labelled, as FormStructure fields with their bindings. */
export function readPrinted(items: Run[], drawing: PageDrawing[], pages: { width: number; height: number; rotate: number }[], title: string): PrintedReading {
  // A scan: every page is mostly one picture, and nothing is drawn as lines.
  const pictured = pages.length > 0 && pages.every((p, i) => {
    const d = drawing[i];
    const area = p.width * p.height || 1;
    return !!d && d.images.some((im) => ((im.x2 - im.x1) * (im.y2 - im.y1)) / area >= 0.6) && d.h.length + d.v.length < 4;
  });
  if (pictured || (!items.length && drawing.some((d) => d.images.length))) return { fields: [], bindings: [], answers: [], scan: true, dropped: [] };

  const upright = (page: number) => (pages[page]?.rotate ?? 0) === 0;
  const pieces = items.flatMap(cutItem);
  const words = pieces.filter((p) => p.kind === "words").map((p) => p.run);
  const leaders = pieces.filter((p) => p.kind === "leader").map((p) => p.run);
  const glyphs = pieces.filter((p) => p.kind === "glyph").map((p) => p.run);
  // Boxes from the ruled lines, read first: a printed line of labels over a row of boxes is cut where a box starts, so
  // "ID Datové schránky  E-mail" over two boxes are two labels.
  const cells = drawing.flatMap((d) => (upright(d.page) ? cellsOf(d) : []));
  const guards = cells.filter((c) => W(c) > 26).map((c) => ({ page: c.page, x1: c.x1 - 0.5, x2: c.x1 + 0.5, y1: c.y1, y2: c.y2 + 16 }));
  const runs = buildRuns(words.flatMap((w) => splitAtGuards(w, guards)), [...leaders.map((l) => ({ page: l.page, x1: l.x0, x2: l.x1, y1: l.y - 0.2 * l.size, y2: l.y + 0.6 * l.size })), ...guards]);
  const ink = runs.map(inkOf);
  const spots: Spot[] = [];
  /** Text that sits where an answer goes: someone already wrote there. Never a label, never in the page model. */
  const answers = new Set<Run>();

  // Rows of character boxes and tick boxes.
  const small = (c: Rect) => W(c) <= 26 && H(c) <= 30 && W(c) >= 4.5 && H(c) >= 4.5 && W(c) <= 3 * H(c) && H(c) <= 3 * W(c);
  const smalls = cells.filter(small).sort((a, b) => a.page - b.page || b.y2 - a.y2 || a.x1 - b.x1);
  const rows: Rect[][] = [];
  for (const c of smalls) {
    const row = rows.find((r) => {
      const last = r[r.length - 1] as Rect;
      // Boxes side by side; a thick divider between two groups of a row (a date's DD | MM | YYYY) does not end it.
      return last.page === c.page && Math.abs(last.y1 - c.y1) <= 1.2 && Math.abs(last.y2 - c.y2) <= 1.2 && c.x1 - last.x2 >= -1 && c.x1 - last.x2 <= 5.5 &&
        !runs.some((r) => r.page === c.page && r.x0 >= last.x2 - 1 && r.x1 <= c.x1 + 1 && onRow(r, c));
    });
    if (row) row.push(c); else rows.push([c]);
  }
  const usedCells = new Set<Rect>();
  // Rows stacked right under each other with the same extent are one answer over several rows.
  const rowGroups: Rect[][][] = [];
  for (const row of rows.filter((r) => r.length >= 2)) {
    const first = row[0] as Rect, last = row[row.length - 1] as Rect;
    const g = rowGroups.find((gr) => {
      const prev = gr[gr.length - 1] as Rect[];
      const pf = prev[0] as Rect, pl = prev[prev.length - 1] as Rect;
      // ...unless the lower row has a label of its own on its left.
      return pf.page === first.page && Math.abs(pf.x1 - first.x1) <= 2 && Math.abs(pl.x2 - last.x2) <= 2 && pf.y1 - first.y2 >= -1 && pf.y1 - first.y2 <= 3 &&
        !runs.some((r) => onRow(r, first) && r.x1 <= first.x1 + 2 && first.x1 - r.x1 <= 200 && /\p{L}/u.test(r.text));
    });
    if (g) g.push(row); else rowGroups.push([row]);
  }
  for (const g of rowGroups) {
    const all = g.flat();
    all.forEach((c) => usedCells.add(c));
    const frame = { page: all[0]!.page, x1: Math.min(...all.map((c) => c.x1)), x2: Math.max(...all.map((c) => c.x2)), y1: Math.min(...all.map((c) => c.y1)), y2: Math.max(...all.map((c) => c.y2)) };
    // Characters inside a row of character boxes are someone's answer, one per box.
    for (const r of runs) if (all.some((c) => insideRect(r, c))) answers.add(r);
    spots.push({ page: frame.page, kind: "cells", from: "cells", areas: all.map((c) => ({ ...c })), frame });
  }
  for (const row of rows.filter((r) => r.length === 1)) {
    const c = row[0] as Rect;
    usedCells.add(c);
    // A single small box is a tick box: a mark already in it ("X") is someone's answer; a word in it means it is not one.
    const inside = runs.filter((r) => insideRect(r, c));
    if (inside.some((r) => [...r.text].length > 2)) continue;
    inside.forEach((r) => answers.add(r));
    spots.push({ page: c.page, kind: "tick", from: "square", areas: [c], frame: c });
  }
  for (const g of glyphs) {
    if (!upright(g.page)) continue;
    const s = 0.72 * g.size;
    const sq = { page: g.page, x1: g.x0, x2: g.x0 + Math.max(s, Math.min(g.x1 - g.x0, 1.1 * g.size)), y1: g.y - 0.05 * g.size, y2: g.y + 0.72 * g.size };
    spots.push({ page: g.page, kind: "tick", from: "glyph", areas: [sq], frame: sq });
  }

  // Larger boxes: blanks unless they hold other boxes, leaders or too much text.
  const boxes = cells.filter((c) => !usedCells.has(c) && W(c) >= 20 && H(c) >= 7);
  for (const b of boxes) {
    if (cells.some((o) => o !== b && o.page === b.page && o.x1 >= b.x1 - 0.5 && o.x2 <= b.x2 + 0.5 && o.y1 >= b.y1 - 0.5 && o.y2 <= b.y2 + 0.5)) continue;
    if (leaders.some((l) => l.page === b.page && l.x0 >= b.x1 - 1 && l.x1 <= b.x2 + 1 && l.y >= b.y1 && l.y <= b.y2)) continue;
    if (glyphs.some((l) => l.page === b.page && l.x0 >= b.x1 - 1 && l.x1 <= b.x2 + 1 && l.y >= b.y1 && l.y <= b.y2)) continue;
    const inside = runs.filter((r) => insideRect(r, b));
    // A box crossed by a ruled line it does not end at holds lines to write on (handled as lines), not one answer.
    if (drawing[b.page]?.h.some((s) => s.y1 > b.y1 + 2 && s.y1 < b.y2 - 2 && s.x1 < b.x2 - 4 && s.x2 > b.x1 + 4)) continue;
    const free = freeIn(b, inside);
    if (!free) continue;
    if (H(free.area) < 6.5) continue;
    const { areas, baselines } = linesIn(free.area);
    spots.push({ page: b.page, kind: "line", from: "box", areas, baselines, frame: b, inside, rightOfText: free.rightOfText });
  }

  // Leaders printed as text: underscores and dots. Neighbours on one line with only spaces between are one leader.
  const lead = [...leaders].filter((l) => upright(l.page)).sort((a, b) => a.page - b.page || a.x0 - b.x0);
  const joined: Run[] = [];
  for (const l of lead) {
    const prev = joined.find((j) => j.page === l.page && Math.abs(j.y - l.y) <= 0.35 * l.size && l.x0 - j.x1 >= -1 && l.x0 - j.x1 <= 0.8 * l.size &&
      !runs.some((r) => r.page === l.page && Math.abs(r.y - l.y) <= 0.35 * l.size && r.x0 >= j.x1 - 0.5 && r.x1 <= l.x0 + 0.5));
    if (prev) prev.x1 = Math.max(prev.x1, l.x1);
    else joined.push({ ...l });
  }
  joined.sort((a, b) => a.page - b.page || b.y - a.y || a.x0 - b.x0);
  const allH = drawing.flatMap((d) => d.h);
  const leaderSpots: Spot[] = [];
  for (const l of joined) {
    const x1 = l.x0 + 0.5, x2 = l.x1 - 0.5;
    if (x2 - x1 < 12) continue;
    const base = l.y + 0.12 * l.size;
    // Printed ink, other lines, and the leader above (its dots sit on its own baseline) bound the room for writing.
    const above = joined.filter((o) => o !== l && o.page === l.page && o.y > l.y + 0.5 * l.size).map((o) => ({ page: o.page, x1: o.x0, x2: o.x1, y1: o.y - 0.1 * o.size, y2: o.y + 0.3 * o.size }));
    const room = roomAbove(l.page, base, x1, x2, [...ink, ...above], allH, 1.7 * l.size);
    if (room < 6) continue;
    const area = { page: l.page, x1, x2, y1: l.y - 0.3 * l.size, y2: base + room };
    leaderSpots.push({ page: l.page, kind: "line", from: "leader", areas: [area], baselines: [base], frame: { page: l.page, x1: l.x0, x2: l.x1, y1: l.y - 0.25 * l.size, y2: l.y + 0.8 * l.size }, size: l.size });
  }
  // ".... / .... / ....": three leaders on one line split by a printed "/" or "." are a date.
  const sep = (a: Spot, b: Spot) => runs.filter((r) => r.page === a.page && onRow(r, a.frame) && r.x0 >= a.frame.x2 - 1 && r.x1 <= b.frame.x1 + 1);
  for (let i = 0; i + 2 < leaderSpots.length; i++) {
    const [a, b, c] = [leaderSpots[i], leaderSpots[i + 1], leaderSpots[i + 2]] as Spot[];
    if (!a || !b || !c || a.drop || b.page !== a.page || c.page !== a.page) continue;
    if (Math.abs(a.frame.y1 - b.frame.y1) > 1 || Math.abs(b.frame.y1 - c.frame.y1) > 1) continue;
    const s1 = sep(a, b), s2 = sep(b, c);
    if (s1.length !== 1 || s2.length !== 1 || !/^[/.\-–]$/u.test((s1[0] as Run).text) || !/^[/.\-–]$/u.test((s2[0] as Run).text)) continue;
    if (b.frame.x1 - a.frame.x2 > 20 || c.frame.x1 - b.frame.x2 > 20) continue;
    a.kind = "date";
    a.areas = [...a.areas, ...b.areas, ...c.areas];
    a.baselines = [...(a.baselines ?? []), ...(b.baselines ?? []), ...(c.baselines ?? [])];
    a.frame = { ...a.frame, x2: c.frame.x2 };
    b.drop = "date part";
    c.drop = "date part";
  }
  spots.push(...leaderSpots.filter((s) => !s.drop));

  // Ruled lines to write on: horizontal lines that are not the side of a box.
  const edges = (s: Seg) => cells.some((c) => c.page === s.page && (Math.abs(c.y1 - s.y1) <= 1 || Math.abs(c.y2 - s.y1) <= 1) && c.x1 >= s.x1 - REACH && c.x2 <= s.x2 + REACH);
  for (const d of drawing) {
    if (!upright(d.page)) continue;
    for (const s of d.h) {
      if (s.x2 - s.x1 < 25 || edges(s)) continue;
      // A line inside a box that is not a box to write in, or under printed text it underlines, is not a blank.
      if (ink.some((r) => r.page === s.page && r.x2 > s.x1 && r.x1 < s.x2 && r.y1 - s.y1 >= -0.5 && r.y1 - s.y1 <= 1.2)) continue;
      const base = s.y1 + 1.5;
      const room = roomAbove(s.page, base, s.x1 + 1, s.x2 - 1, ink, allH, 16);
      if (room < 6) continue;
      // A line with a leader printed on it is that leader's.
      if (leaderSpots.some((l) => l.page === s.page && l.frame.x1 < s.x2 && l.frame.x2 > s.x1 && Math.abs(l.frame.y1 - s.y1) <= 4)) continue;
      const area = { page: s.page, x1: s.x1 + 1, x2: s.x2 - 1, y1: s.y1 - 3, y2: base + room };
      spots.push({ page: s.page, kind: "line", from: "rule", areas: [area], baselines: [base], frame: { page: s.page, x1: s.x1, x2: s.x2, y1: s.y1 - 1, y2: s.y1 + Math.min(10, room) } });
    }
  }

  // Text sitting on a line where an answer goes is someone's answer.
  for (const sp of spots) {
    if (sp.kind !== "line" || sp.from === "box") continue;
    const a = sp.areas[0] as Rect;
    for (const r of runs) if (r.page === sp.page && r.x0 >= a.x1 - 2 && r.x1 <= a.x2 + 4 && r.y >= a.y1 - 1 && r.y <= (sp.baselines?.[0] ?? a.y1) + 0.6 * r.size) answers.add(r);
  }

  // ---------------------------------------------------------------- labelling
  // In order of confidence: text printed in the place's own row or inside it; a column header; text tightly above and
  // aligned with it; text printed under a line (a line to sign or date on); else the place is named by its position,
  // or left out. Text a place took as its label is never another place's.
  const order = (a: Spot, b: Spot) => a.page - b.page || b.frame.y2 - a.frame.y2 || a.frame.x1 - b.frame.x1;
  spots.sort(order);
  const claimed = new Set<Run>();
  const live = () => spots.filter((s) => !s.drop);
  const claim = (sp: Spot, parts: Run[], from: "printed" | "position" = "printed") => {
    sp.label = labelText(parts);
    sp.claims = parts;
    sp.labelFrom = from;
    parts.forEach((r) => claimed.add(r));
  };
  const free = (r: Run) => !answers.has(r) && !claimed.has(r);
  const wordy = (r: Run) => /\p{L}/u.test(r.text) && !ENUM_ONLY.test(r.text);
  /** The run is printed inside a box that does not also hold the place (a box of its own, not a section both are in). */
  const inOtherCell = (r: Run, self: Spot) => cells.some((c) => insideRect(r, c) &&
    !(c.x1 >= self.frame.x1 - 0.5 && c.x2 <= self.frame.x2 + 0.5 && c.y1 >= self.frame.y1 - 0.5 && c.y2 <= self.frame.y2 + 0.5) &&
    !(c.x1 <= self.frame.x1 + 0.5 && c.x2 >= self.frame.x2 - 0.5 && c.y1 <= self.frame.y1 + 0.5 && c.y2 >= self.frame.y2 - 0.5));
  const spotBetweenX = (self: Spot, x0: number, x1: number) => live().some((o) => o !== self && o.page === self.page &&
    o.frame.x1 >= x0 - 0.5 && o.frame.x2 <= x1 + 0.5 && o.frame.y1 < self.frame.y2 && o.frame.y2 > self.frame.y1);
  /** The run belongs to another place on its row: it is that place's row label (the place is right of it), the text of
   *  a tick box just left of it, or it is printed over that place. */
  const otherOnRow = (r: Run, self: Spot) => live().some((o) => o !== self && o.page === r.page && onRow(r, o.frame, 2) &&
    ((o.frame.x1 >= r.x1 - 2 && o.frame.x1 - r.x1 <= 200) || tickBefore(o, r) || (o.frame.x1 < r.x1 && o.frame.x2 > r.x0)));
  const tickBefore = (o: Spot, r: Run) => o.kind === "tick" && o.frame.x2 <= r.x0 + 2 && r.x0 - o.frame.x2 <= 30;
  /** A line under `sp` that continues it: a line to write on, not a box, ending where it ends. */
  const continuation = (sp: Spot, r: Run) => live().find((o) => o !== sp && o.kind === "line" && o.from !== "box" && o.page === r.page &&
    onRow(r, o.frame, 2) && Math.abs(o.frame.x2 - sp.frame.x2) <= 20 && o.frame.y1 < sp.frame.y1);

  /** Runs on the row of the place, left of it, with no other place between: nearest first. */
  const leftOnRow = (sp: Spot, maxGap: number): Run[] => runs
    .filter((r) => free(r) && wordy(r) && onRow(r, sp.frame) && r.x1 <= sp.frame.x1 + 2 && sp.frame.x1 - r.x1 <= maxGap && !inOtherCell(r, sp) && !spotBetweenX(sp, r.x1, sp.frame.x1))
    .sort((a, b) => b.x1 - a.x1);

  // 1. Tick boxes: the text on their right (with the lines it wraps onto), or on their left. Tick boxes on one row are
  //    printed one way: when one of them has text on only one side, that side is every one's ("MARRIED [ ] DIVORCED [ ]
  //    WIDOWED [ ]": the last box has nothing on its right, so each box's label is on its left).
  const rightOf = (sp: Spot) => runs.filter((r) => free(r) && wordy(r) && r.page === sp.page && r.x0 >= sp.frame.x2 - 1 && r.x0 - sp.frame.x2 <= 30 &&
    (onRow(r, sp.frame, 3) || (r.y >= sp.frame.y1 - 2 && r.y <= sp.frame.y2)) && !spotBetweenX(sp, sp.frame.x2, r.x0))
    .sort((a, b) => b.y - a.y || a.x0 - b.x0)[0];
  const ticks = live().filter((s) => s.kind === "tick");
  const side = new Map<Spot, "left" | "right">();
  for (const sp of ticks) {
    const row = ticks.filter((o) => o.page === sp.page && Math.abs((o.frame.y1 + o.frame.y2) / 2 - (sp.frame.y1 + sp.frame.y2) / 2) <= 3);
    const leftAll = row.every((o) => leftOnRow(o, 60).length > 0);
    const rightAll = row.every((o) => !!rightOf(o));
    if (leftAll && !rightAll) side.set(sp, "left");
    else if (rightAll && !leftAll) side.set(sp, "right");
  }
  for (const sp of ticks) {
    const sq = sp.frame;
    let right = rightOf(sp);
    let left = leftOnRow(sp, 60)[0];
    if (side.get(sp) === "left") right = undefined;
    if (side.get(sp) === "right") left = undefined;
    const rightGap = right ? right.x0 - sq.x2 : Infinity;
    const leftGap = left ? sq.x1 - left.x1 : Infinity;
    if (right && rightGap <= leftGap) {
      // Until a line that has a tick box of its own, or a place printed over it.
      const more = blockLines(runs.filter(free), right, "down", (r) => live().some((o) => o !== sp && o.page === r.page && onRow(r, o.frame, 1) &&
        (tickBefore(o, r) || (o.frame.x1 < r.x1 && o.frame.x2 > r.x0))), 3);
      claim(sp, [right, ...more]);
    } else if (left) claim(sp, [left]);
  }

  // 2. Boxes with their label printed inside (a caption at the top, or a label at the left). A box with text in it over
  //    an empty box of the same width is a table's column header, not a place to write: its rows are.
  for (const sp of live()) {
    if (sp.from !== "box" || !sp.inside?.length || sp.label) continue;
    const f = sp.frame;
    const under = cells.find((c) => c.page === f.page && Math.abs(c.x1 - f.x1) <= 1.5 && Math.abs(c.x2 - f.x2) <= 1.5 && Math.abs(c.y2 - f.y1) <= 1.5);
    if (under && !runs.some((r) => insideRect(r, under))) { sp.drop = "a column header"; continue; }
    claim(sp, [...sp.inside].sort((a, b) => b.y - a.y || a.x0 - b.x0));
  }

  // 3. Text on the place's own row, left of it: the row's text since the previous place, and the block it wraps in.
  for (const sp of live()) {
    if (sp.kind === "tick" || sp.label) continue;
    const row = leftOnRow(sp, sp.from === "box" ? 200 : 280);
    if (!row.length) continue;
    const onLine = [...row].sort((a, b) => a.x0 - b.x0);
    const head = onLine[0] as Run;
    const up = sp.kind === "line" || sp.kind === "date" || sp.kind === "cells"
      ? blockLines(runs.filter(free), head, "up", (r) => otherOnRow(r, sp), 2).reverse() : [];
    const down: Run[] = [];
    if (sp.kind === "line" && sp.from !== "box") {
      // Lines of the label under its first line. A line of the block with a line to write on of its own, after at least
      // one line with none, is where the answer continues ("Adresa ...... / Address of ... / Адреса ......").
      let cur = head;
      let plain = false;
      for (let k = 0; k < 3; k++) {
        const next = runs.find((r) => free(r) && r !== cur && r.page === cur.page && Math.abs(r.x0 - head.x0) <= 3 && Math.abs(r.size - cur.size) < 1.5 &&
          cur.y - r.y > 0.5 * cur.size && cur.y - r.y <= 1.6 * cur.size);
        if (!next) break;
        const cont = continuation(sp, next);
        if (cont) {
          if (!plain) break;
          sp.areas.push(...cont.areas);
          sp.baselines = [...(sp.baselines ?? []), ...(cont.baselines ?? [])];
          cont.drop = "continues the line above";
          down.push(next);
          break;
        }
        if (otherOnRow(next, sp)) break;
        plain = true;
        down.push(next);
        cur = next;
      }
    }
    claim(sp, [...up, ...onLine, ...down]);
  }

  // 4. A line with no label of its own right under a labelled line, starting at or left of it and ending where it
  //    ends: the answer continues there ("Adresa ______" and a whole line under it).
  for (const sp of live()) {
    if (sp.label || sp.kind !== "line" || sp.from === "box") continue;
    const upper = live().filter((o) => o !== sp && o.label && o.kind === "line" && o.from !== "box" && o.page === sp.page &&
      Math.abs(o.frame.x2 - sp.frame.x2) <= 20 && sp.frame.x1 <= o.frame.x1 + 4 && (o.areas[o.areas.length - 1] as Rect).y1 - sp.frame.y1 > 0 &&
      (o.areas[o.areas.length - 1] as Rect).y1 - sp.frame.y1 <= 2.6 * (o.size ?? 10) + 4)
      .sort((a, b) => a.frame.y1 - b.frame.y1)[0];
    if (upper && !runs.some((r) => free(r) && onRow(r, sp.frame, 1) && r.x1 <= sp.frame.x1 + 2 && sp.frame.x1 - r.x1 <= 200)) {
      upper.areas.push(...sp.areas);
      upper.baselines = [...(upper.baselines ?? []), ...(sp.baselines ?? [])];
      sp.drop = "continues the line above";
    }
  }

  // 5. Boxes in a table column: an empty box under a header box of the same width takes the header's text.
  for (const sp of live()) {
    if (sp.label || sp.from !== "box") continue;
    let cur: Rect = sp.frame;
    for (let k = 0; k < 12; k++) {
      const over = cells.find((c) => c.page === cur.page && Math.abs(c.x1 - cur.x1) <= 1.5 && Math.abs(c.x2 - cur.x2) <= 1.5 && Math.abs(c.y1 - cur.y2) <= 1.5);
      if (!over) break;
      const text = runs.filter((r) => insideRect(r, over) && wordy(r));
      if (text.length) {
        sp.label = labelText(text.sort((a, b) => b.y - a.y || a.x0 - b.x0));
        sp.labelFrom = "printed";
        break;
      }
      cur = over;
    }
  }

  // 6. Text tightly above the place and aligned with its left edge, printed outside any other box.
  for (const sp of live()) {
    if (sp.label || sp.kind === "tick") continue;
    const f = sp.frame;
    // Where the printed line starts: a number printed before the label ("1.  PŘÍJMENÍ") counts as its start.
    // The label may hang a number in the margin ("1.  PŘÍJMENÍ"): its words or its number line up with the place.
    const starts = (r: Run): number[] => {
      const out = [r.x0, ...runs.filter((e) => e.page === r.page && ENUM_ONLY.test(e.text) && Math.abs(e.y - r.y) <= 0.35 * r.size && e.x1 <= r.x0 + 1 && r.x0 - e.x1 <= 2 * r.size).map((e) => e.x0)];
      const m = ENUM_PREFIX.exec(r.text);
      if (m) out.push(positions(r)([...m[0]].length));
      return out;
    };
    const above = runs.filter((r) => free(r) && wordy(r) && r.page === f.page && !inOtherCell(r, sp) &&
      bottom(r) - f.y2 >= -0.6 * r.size && bottom(r) - f.y2 <= 0.9 * r.size + 4 && starts(r).some((x) => Math.abs(x - f.x1) <= 12) && r.x0 < f.x2)
      .sort((a, b) => bottom(a) - bottom(b))[0];
    if (!above) continue;
    // The rest of that printed line over the place (not another place's own label), and the lines it wraps from.
    const rest = runs.filter((r) => r !== above && free(r) && r.page === above.page && Math.abs(r.y - above.y) <= 0.35 * above.size && r.x0 > above.x1 && r.x0 < f.x2 - 4 &&
      !live().some((o) => o !== sp && o.frame.x1 <= r.x0 + 12 && o.frame.x2 > r.x0 && o.frame.y2 <= bottom(r) + 2 && bottom(r) - o.frame.y2 <= 0.9 * r.size + 4));
    const up = blockLines(runs.filter(free), above, "up", (r) => otherOnRow(r, sp), 2).reverse();
    claim(sp, [...up, above, ...rest.sort((p, q) => p.x0 - q.x0)]);
  }

  // 7. A line to sign or date on, with its label printed under it.
  for (const sp of live()) {
    if (sp.label || sp.kind !== "line" || sp.from === "box") continue;
    const f = sp.frame;
    const first = runs.filter((r) => free(r) && wordy(r) && r.page === f.page && top(r) <= f.y1 + 1 && f.y1 - top(r) <= 1.4 * r.size && r.x0 >= f.x1 - 6 && r.x0 < f.x2 &&
      r.text.length <= 60 && !ENUM_PREFIX.test(r.text))
      .sort((a, b) => b.y - a.y || a.x0 - b.x0)[0];
    if (!first) continue;
    const lines = [first, ...runs.filter((r) => r !== first && free(r) && r.page === first.page && Math.abs(r.y - first.y) <= 0.35 * first.size && r.x0 > first.x1 && r.x0 < f.x2)];
    let cur = first;
    for (let k = 0; k < 2; k++) {
      const next = runs.find((r) => free(r) && !lines.includes(r) && r.page === cur.page && cur.y - r.y > 0.5 * cur.size && cur.y - r.y <= 1.6 * cur.size && r.x0 < f.x2 && r.x1 > f.x1);
      if (!next) break;
      lines.push(next);
      cur = next;
    }
    claim(sp, lines.sort((a, b) => b.y - a.y || a.x0 - b.x0));
  }

  // Text inside a box whose label is printed outside it is someone's answer.
  for (const sp of spots) {
    if (sp.from !== "box" || !sp.inside?.length || !sp.label) continue;
    if (sp.claims && sp.claims.some((r) => sp.inside?.includes(r))) continue;
    sp.inside.forEach((r) => answers.add(r));
  }

  // 8. Positions, for places with no label that are surely places to write (a leader, a row of boxes, an empty box).
  //    A ruled line or a square with no label may be a decoration: left out.
  for (const sp of live()) {
    if (sp.label) continue;
    if (sp.from === "rule" || sp.kind === "tick") { sp.drop = "no label"; continue; }
    const f = sp.frame;
    // The text that starts right after the place on its row (a table row's text in the next cell), else the nearest
    // text over it.
    const after = sp.from === "box" ? runs.filter((r) => !answers.has(r) && wordy(r) && r.page === f.page && r.x0 >= f.x2 - 1 && r.x0 - f.x2 <= 40 && midY(r) >= f.y1 && midY(r) <= f.y2)
      .sort((a, b) => b.y - a.y)[0] : undefined;
    const over = runs.filter((r) => !answers.has(r) && wordy(r) && r.page === f.page && bottom(r) >= f.y2 - 1 && bottom(r) - f.y2 <= 40 && r.x1 > f.x1 && r.x0 < f.x2)
      .sort((a, b) => bottom(a) - bottom(b))[0];
    const anchor = after ? labelText([after]) : over ? labelText([over]) : "";
    if (!anchor) { sp.drop = "no label"; continue; }
    const what = sp.kind === "cells" ? "the boxes" : sp.from === "box" ? "the box" : "the line";
    sp.label = `${what} ${after ? "before" : "under"} "${anchor.length > 50 ? `${anchor.slice(0, 47)}...` : anchor}"`;
    sp.labelFrom = "position";
  }

  // Places for the office and for a signature are not the person's to type in.
  for (const sp of spots) {
    if (sp.drop || !sp.label) continue;
    if (FOR_OFFICE.test(sp.label)) sp.drop = "for the office";
    else if (SIGNATURE.test(sp.label) && !NOT_ONLY_SIGNATURE.test(sp.label)) sp.drop = "a signature";
  }

  // ---------------------------------------------------------------- fields
  const body = bodySize(runs);
  const kept = spots.filter((s) => !s.drop && s.label);
  kept.sort(order);
  const counts = new Map<string, number>();
  for (const s of kept) if (s.labelFrom === "position") counts.set(s.label as string, (counts.get(s.label as string) ?? 0) + 1);
  const seen = new Map<string, number>();
  const used = new Set<string>();
  const fields: FieldStructure[] = [];
  const bindings: PdfBinding[] = [];
  for (const s of kept) {
    let label = s.label as string;
    if (s.labelFrom === "position" && (counts.get(label) ?? 0) > 1) {
      const n = (seen.get(label) ?? 0) + 1;
      seen.set(label, n);
      label = `${label}, ${n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `number ${n}`}`;
    }
    const a0 = s.areas[0] as Rect;
    let id = `p${s.page + 1}-x${Math.round(s.frame.x1)}-y${Math.round(s.frame.y1)}`;
    for (let n = 2; used.has(id); n++) id = `p${s.page + 1}-x${Math.round(s.frame.x1)}-y${Math.round(s.frame.y1)}-${n}`;
    used.add(id);
    const kind: FieldKind = s.kind === "tick" ? "checkbox" : s.kind === "date" ? "date" : s.kind === "cells" ? "text"
      : s.areas.length > 1 ? "textarea" : DATE_ONLY.test(label) && s.labelFrom === "printed" ? "date" : "text";
    const required = /\*/u.test(s.claims?.map((r) => r.text).join(" ") ?? "");
    const field: FieldStructure = { fieldId: id, kind, label, required };
    if (s.kind === "cells") field.maxLength = s.areas.length;
    const section = sectionOf(runs, a0, body, title);
    if (section) field.section = section;
    fields.push(field);
    const print: PrintSpot = { kind: s.kind, areas: s.areas.map(box), from: s.from, label: s.labelFrom ?? "position" };
    if (s.baselines && (s.kind === "line" || s.kind === "date")) print.baselines = s.baselines.map((b) => Math.round(b * 100) / 100);
    if (kind === "date" && s.kind === "line") print.asDate = true;
    bindings.push({ fieldId: id, via: "print", names: [], boxes: s.areas.map(box), print });
  }
  const dropped = spots.filter((s) => s.drop).map((s) => ({ label: s.label ?? "", why: s.drop as string, box: box(s.frame) }));
  return { fields, bindings, answers: [...answers], scan: false, dropped };
}

const box = (r: Rect): Box => ({ page: r.page, x1: Math.round(r.x1 * 100) / 100, y1: Math.round(r.y1 * 100) / 100, x2: Math.round(r.x2 * 100) / 100, y2: Math.round(r.y2 * 100) / 100 });

/** The nearest heading printed above a place on its page, or the last one on an earlier page. */
function sectionOf(runs: Run[], b: Rect, body: number, title: string): string | undefined {
  const heads = runs.filter((r) => isHeading(r, body) && (r.page < b.page || (r.page === b.page && bottom(r) >= b.y2 - 1)));
  const h = heads.sort((p, q) => p.page - q.page || q.y - p.y).pop();
  const text = h ? cleanLabel(h.text) : "";
  return text && text !== title ? text : undefined;
}

export { DATEISH };
