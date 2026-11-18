// What a page draws, as far as finding the places a person writes on needs it: straight horizontal and vertical
// strokes (ruled lines, the sides of boxes), and the images it paints (a scan is one image per page). Read from pdf.js's
// operator list, with the transformation matrix tracked through save/restore and form XObjects, so every coordinate is
// in the page's own PDF units (origin bottom-left), like the text runs and form widgets.
//
// Nothing here reads text: a value drawn onto a page is text, and the text is read (and kept out of labels) elsewhere.
import type { PdfJs, PdfJsDocument } from "./types.js";

/** A straight horizontal (y1 === y2) or vertical (x1 === x2) stroke, in page units. `page` is 0-based. */
export interface Seg {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PageDrawing {
  page: number;
  /** Horizontal strokes, merged where they continue each other. */
  h: Seg[];
  /** Vertical strokes, merged likewise. */
  v: Seg[];
  /** The area each painted image covers. */
  images: { x1: number; y1: number; x2: number; y2: number }[];
}

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
/** outer x inner: applying the result is applying inner, then outer (how PDF's cm composes). */
const mul = (o: M, i: M): M => [
  o[0] * i[0] + o[2] * i[1], o[1] * i[0] + o[3] * i[1],
  o[0] * i[2] + o[2] * i[3], o[1] * i[2] + o[3] * i[3],
  o[0] * i[4] + o[2] * i[5] + o[4], o[1] * i[4] + o[3] * i[5] + o[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const asM = (a: unknown): M | null => {
  if (!a || typeof a !== "object") return null;
  const v = Array.from(a as ArrayLike<number>);
  return v.length >= 6 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? (v.slice(0, 6) as M) : null;
};

/** pdf.js's path drawing codes (DrawOPS). */
const MOVE = 0, LINE = 1, CURVE = 2, QUAD = 3, CLOSE = 4;

/** How far from exactly horizontal or vertical a stroke may be, in page units. */
const SKEW = 0.6;
/** A filled rectangle at most this thin is a line drawn as a fill. */
const THIN = 2.5;

/** One piece of a subpath: a straight line, or a curve with its first control point (for its direction). */
interface Edge { a: [number, number]; b: [number, number]; curve: boolean; c1?: [number, number] }

/** The subpaths of a pdf.js path buffer, as their edges. */
function subpaths(buf: ArrayLike<number>): { edges: Edge[]; pts: [number, number][]; closed: boolean }[] {
  const out: { edges: Edge[]; pts: [number, number][]; closed: boolean }[] = [];
  let cur: { edges: Edge[]; pts: [number, number][]; closed: boolean } | null = null;
  const last = (): [number, number] => (cur?.pts[cur.pts.length - 1] ?? [0, 0]);
  for (let i = 0; i < buf.length;) {
    const op = buf[i] as number;
    const P = (k: number): [number, number] => [buf[i + k] as number, buf[i + k + 1] as number];
    if (op === MOVE) {
      cur = { edges: [], pts: [P(1)], closed: false };
      out.push(cur);
      i += 3;
    } else if (op === LINE) {
      if (cur) { cur.edges.push({ a: last(), b: P(1), curve: false }); cur.pts.push(P(1)); }
      i += 3;
    } else if (op === CURVE) {
      if (cur) { cur.edges.push({ a: last(), b: P(5), curve: true, c1: P(1) }); cur.pts.push(P(5)); }
      i += 7;
    } else if (op === QUAD) {
      if (cur) { cur.edges.push({ a: last(), b: P(3), curve: true, c1: P(1) }); cur.pts.push(P(3)); }
      i += 5;
    } else if (op === CLOSE) {
      if (cur) {
        cur.closed = true;
        const first = cur.pts[0] as [number, number];
        const end = last();
        if (Math.hypot(first[0] - end[0], first[1] - end[1]) > 0.01) cur.edges.push({ a: end, b: first, curve: false });
      }
      i += 1;
    } else break; // an unknown code: stop rather than misread the rest
  }
  return out;
}

/** How large a curve may be and still be a box's rounded corner. */
const CORNER = 9;

/**
 * The drawing of every page: straight strokes and painted images. `ops` is pdf.js's OPS table (the module's own, so
 * the codes always match the build in use). Pages pdf.js cannot give an operator list for are left empty.
 */
export async function readDrawing(pdf: PdfJsDocument, ops: PdfJs["OPS"]): Promise<PageDrawing[]> {
  const out: PageDrawing[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const d: PageDrawing = { page: n - 1, h: [], v: [], images: [] };
    out.push(d);
    if (!ops) continue;
    let list: { fnArray: number[]; argsArray: unknown[] };
    try {
      list = await (await pdf.getPage(n)).getOperatorList();
    } catch {
      continue;
    }
    const stack: M[] = [];
    let ctm: M = ID;
    const STROKES = new Set([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
    const FILLS = new Set([ops.fill, ops.eoFill]);
    const IMAGES = new Set([ops.paintImageXObject, ops.paintImageMaskXObject, ops.paintInlineImageXObject, ops.paintImageXObjectRepeat, ops.paintImageMaskXObjectRepeat, ops.paintImageMaskXObjectGroup, ops.paintInlineImageXObjectGroup]);
    const addSeg = (ax: number, ay: number, bx: number, by: number) => {
      if (Math.abs(ay - by) <= SKEW && Math.abs(ax - bx) > 2) d.h.push({ page: d.page, x1: Math.min(ax, bx), x2: Math.max(ax, bx), y1: (ay + by) / 2, y2: (ay + by) / 2 });
      else if (Math.abs(ax - bx) <= SKEW && Math.abs(ay - by) > 2) d.v.push({ page: d.page, y1: Math.min(ay, by), y2: Math.max(ay, by), x1: (ax + bx) / 2, x2: (ax + bx) / 2 });
    };
    for (let i = 0; i < list.fnArray.length; i++) {
      const fn = list.fnArray[i];
      const args = list.argsArray[i] as unknown[] | null;
      if (fn === ops.save) stack.push(ctm);
      else if (fn === ops.restore) ctm = stack.pop() ?? ID;
      else if (fn === ops.transform) {
        const m = asM(args);
        if (m) ctm = mul(ctm, m);
      } else if (fn === ops.paintFormXObjectBegin) {
        stack.push(ctm);
        const m = asM(args?.[0]);
        if (m) ctm = mul(ctm, m);
      } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ID;
      else if (IMAGES.has(fn as number)) {
        // An image is drawn into the unit square of the current matrix.
        const corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
        const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
        d.images.push({ x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) });
      } else if (fn === ops.constructPath && args) {
        const op = args[0] as number;
        const buf = (args[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | null | undefined;
        if (!buf || !(STROKES.has(op) || FILLS.has(op))) continue;
        for (const sp of subpaths(buf)) {
          const pts = sp.pts.map(([x, y]) => apply(ctm, x, y));
          const straight = sp.edges.every((e) => !e.curve);
          // A thin rectangle, stroked or filled, is one line along its middle (a line drawn as a narrow box).
          if (straight && pts.length >= 3) {
            const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
            const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
            if (y2 - y1 <= THIN && x2 - x1 > 2 * THIN) { d.h.push({ page: d.page, x1, x2, y1: (y1 + y2) / 2, y2: (y1 + y2) / 2 }); continue; }
            if (x2 - x1 <= THIN && y2 - y1 > 2 * THIN) { d.v.push({ page: d.page, y1, y2, x1: (x1 + x2) / 2, x2: (x1 + x2) / 2 }); continue; }
          }
          if (STROKES.has(op)) {
            const closes = sp.closed || op === ops.closeStroke || op === ops.closeFillStroke || op === ops.closeEOFillStroke;
            const edges = [...sp.edges];
            if (closes && !sp.closed && sp.pts.length > 2) edges.push({ a: sp.pts[sp.pts.length - 1] as [number, number], b: sp.pts[0] as [number, number], curve: false });
            for (const e of edges) {
              const a = apply(ctm, ...e.a), b = apply(ctm, ...e.b);
              if (!e.curve) { addSeg(...a, ...b); continue; }
              // A small curve is a rounded corner: its two straight legs meet where the sharp corner would be, so the
              // box closes like a square-cornered one. The curve leaves `a` along its first control point.
              if (Math.abs(a[0] - b[0]) > CORNER || Math.abs(a[1] - b[1]) > CORNER || !e.c1) continue;
              const c = apply(ctm, ...e.c1);
              const vertical = Math.abs(c[0] - a[0]) < Math.abs(c[1] - a[1]);
              const corner: [number, number] = vertical ? [a[0], b[1]] : [b[0], a[1]];
              addSeg(...a, ...corner);
              addSeg(...corner, ...b);
            }
          } else if (straight && pts.length >= 3) {
            // A filled shape with straight sides: a thin one is a line drawn as a fill; a larger one is shading.
            const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
            const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
            if (y2 - y1 <= THIN && x2 - x1 > 2) d.h.push({ page: d.page, x1, x2, y1: (y1 + y2) / 2, y2: (y1 + y2) / 2 });
            else if (x2 - x1 <= THIN && y2 - y1 > 2) d.v.push({ page: d.page, y1, y2, x1: (x1 + x2) / 2, x2: (x1 + x2) / 2 });
          }
        }
      }
    }
    d.h = merge(d.h, "h");
    d.v = merge(d.v, "v");
  }
  return out;
}

/** Strokes on one line that touch or overlap become one; a stroke drawn twice is kept once. */
function merge(segs: Seg[], dir: "h" | "v"): Seg[] {
  const pos = (s: Seg) => (dir === "h" ? s.y1 : s.x1);
  const from = (s: Seg) => (dir === "h" ? s.x1 : s.y1);
  const to = (s: Seg) => (dir === "h" ? s.x2 : s.y2);
  const sorted = [...segs].sort((a, b) => pos(a) - pos(b) || from(a) - from(b));
  const lines: Seg[][] = [];
  for (const s of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(pos(line[0] as Seg) - pos(s)) <= 0.8) line.push(s);
    else lines.push([s]);
  }
  const out: Seg[] = [];
  for (const line of lines) {
    line.sort((a, b) => from(a) - from(b));
    let cur: Seg | null = null;
    for (const s of line) {
      if (cur && from(s) <= to(cur) + 1) {
        if (dir === "h") cur.x2 = Math.max(cur.x2, s.x2); else cur.y2 = Math.max(cur.y2, s.y2);
      } else {
        if (cur) out.push(cur);
        cur = { ...s };
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}
