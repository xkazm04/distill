// Writing answers onto a copy of a print-only page, and checking them. The answer is drawn as text in the places
// printed.ts found (PrintSpot), in the embedded Noto Sans, inside a marked-content sequence tagged ANSWER_TAG so that
// reading the copy again never takes an answer for printed text.
//
// "Written" means more than "drawn": the saved bytes are read back with pdf.js (a different parser from pdf-lib, which
// draws) and every answer must be found there as text, at its place, within the width of its place, and over no printed
// text. An answer that does not fit its place at a readable size is not drawn at all: it fails with the reason shown to
// the person, rather than being drawn over the form.
import { beginMarkedContent, endMarkedContent, popGraphicsState, pushGraphicsState, rgb, type PDFDocument, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";
import type { FormValues } from "@distill/engine";
import { cutItem } from "./printed.js";
import { ANSWER_TAG, bottom, collapse, top, type Run } from "./text.js";
import type { Box, PdfBinding, PdfJs, PdfJsTextItem } from "./types.js";

/** The smallest text size an answer is drawn at. Below it, the answer is reported as not fitting. */
export const MIN_SIZE = 6;
/** The largest: what a person writes by hand on a form line, about. */
const MAX_SIZE = 11;
/** Height of Noto Sans above the baseline, accents of capitals included (Ž, Ř), per point of size. */
const ASCENT = 0.95;
/** Its depth below the baseline (j, ý, ň), per point of size. */
const DESCENT = 0.27;
/** Cap height of "X", per point. */
const CAP = 0.714;
/** Ink colour of answers: a dark blue, like a pen, so drawn answers stand apart from the printed form. */
const INK = rgb(0.05, 0.12, 0.45);

/** A reason an answer was not written, in plain words for the person. */
export class PrintError extends Error {}

export const REASONS = {
  long: "The answer is too long for its place on the page, even in small print. Shorten it, or write it on the printed page by hand.",
  date: "Distill could not read this as a date. Write it as day, month and year, for example 5.3.1990.",
  glyph: "The answer has a character the font for writing on the page does not have.",
  taken: "Something is already written or printed where this answer would go, so Distill did not write over it.",
  unconfirmed: "Distill drew the answer but could not find it in the saved copy where it belongs, so it was left out.",
  noReader: "Distill could not check this answer in the saved copy, so it was left out.",
} as const;

/** One piece of text to draw: where, how big. */
export interface Draw { page: number; text: string; x: number; y: number; size: number }

interface Fonts { font: PDFFont; has(text: string): boolean }

const pad2 = (n: number): string => String(n).padStart(2, "0");

function parseDay(v: string): { day: number; month: number; year: number } | null {
  const dmy = /^\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})\s*$/.exec(v);
  const iso = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(v);
  let day: number, month: number, year: number;
  if (dmy) [day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year };
}

const isTicked = (v: string): boolean => v.trim() !== "" && v.trim().toLowerCase() !== "false";

/** What the answer must read as, area by area, once drawn (whitespace aside). Also what the check compares with. */
export function printedText(b: PdfBinding, value: string): string {
  const p = b.print;
  if (!p) return "";
  if (p.kind === "tick") return isTicked(value) ? "X" : "";
  if (p.kind === "date" || p.asDate) {
    if (!value.trim()) return "";
    const d = parseDay(value);
    if (!d) throw new PrintError(REASONS.date);
    return p.kind === "date" ? `${pad2(d.day)}${pad2(d.month)}${d.year}` : `${pad2(d.day)}.${pad2(d.month)}.${d.year}`;
  }
  if (p.kind === "cells") return cellChars(value, p.areas.length).join("");
  return collapse(value);
}

/** The characters of an answer in a row of boxes: spaces kept as empty boxes when they fit, else dropped. */
function cellChars(value: string, n: number): string[] {
  const v = collapse(value);
  const chars = [...v];
  if (chars.length <= n) return chars.map((c) => (c === " " ? "" : c));
  const bare = [...v.replace(/\s+/g, "")];
  return bare.length <= n ? bare : chars;
}

/** The draws for one answer, or a PrintError with the reason it cannot be drawn. Nothing is drawn for an empty one. */
export function planPrint(b: PdfBinding, raw: string, fonts: Fonts): Draw[] {
  const p = b.print;
  if (!p) return [];
  const value = raw.normalize("NFC");
  const font = fonts.font;
  const width = (t: string, s: number) => font.widthOfTextAtSize(t, s);
  if (p.kind === "tick") {
    if (!isTicked(value)) return [];
    const a = p.areas[0] as Box;
    const side = Math.min(a.x2 - a.x1, a.y2 - a.y1);
    const size = Math.min(14, (0.72 * side) / CAP);
    return [{ page: a.page, text: "X", size, x: (a.x1 + a.x2) / 2 - width("X", size) / 2, y: (a.y1 + a.y2) / 2 - (CAP * size) / 2 }];
  }
  const text = printedText(b, value);
  if (!text) return [];
  if (!fonts.has(text.replace(/\s+/g, ""))) throw new PrintError(REASONS.glyph);
  if (p.kind === "cells") {
    const chars = cellChars(value, p.areas.length);
    if (chars.length > p.areas.length) throw new PrintError(REASONS.long);
    const draws: Draw[] = [];
    chars.forEach((ch, i) => {
      if (!ch) return;
      const a = p.areas[i] as Box;
      const w = a.x2 - a.x1, h = a.y2 - a.y1;
      let size = Math.min(MAX_SIZE, (0.68 * h) / CAP);
      while (size > MIN_SIZE && width(ch, size) > w - 1.5) size -= 0.5;
      if (width(ch, size) > w - 1) throw new PrintError(REASONS.long);
      draws.push({ page: a.page, text: ch, size, x: a.x1 + (w - width(ch, size)) / 2, y: a.y1 + (h - CAP * size) / 2 });
    });
    return draws;
  }
  if (p.kind === "date") {
    // Day, month and year, each in its own place.
    const parts = [text.slice(0, 2), text.slice(2, 4), text.slice(4)];
    return parts.map((t, i) => {
      const a = p.areas[i] as Box;
      const base = p.baselines?.[i] ?? a.y1 + 2;
      let size = Math.min(MAX_SIZE, (a.y2 - base) / ASCENT);
      while (size > MIN_SIZE && width(t, size) > a.x2 - a.x1 - 2) size -= 0.5;
      if (size < MIN_SIZE || width(t, size) > a.x2 - a.x1 - 1) throw new PrintError(REASONS.long);
      return { page: a.page, text: t, size, x: a.x1 + Math.max(1, (a.x2 - a.x1 - width(t, size)) / 2), y: base };
    });
  }
  // Lines: the answer at the largest size that fits, wrapped onto the next line where the place has several.
  const lines = p.areas.map((a, i) => ({ a, base: p.baselines?.[i] ?? a.y1 + 2 }));
  const start = Math.min(MAX_SIZE, ...lines.map((l) => (l.a.y2 - l.base) / ASCENT));
  const words = text.split(" ");
  for (let size = start; size >= MIN_SIZE - 1e-9; size -= 0.5) {
    const out: Draw[] = [];
    let k = 0;
    let line = "";
    let ok = true;
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      const l = lines[k];
      if (!l) { ok = false; break; }
      if (width(next, size) <= l.a.x2 - l.a.x1 - 2) { line = next; continue; }
      if (!line) { ok = false; break; } // one word wider than the line
      out.push({ page: l.a.page, text: line, size, x: l.a.x1 + 1, y: l.base });
      k++;
      line = w;
      const n = lines[k];
      if (!n || width(w, size) > n.a.x2 - n.a.x1 - 2) { ok = false; break; }
    }
    if (ok && line) {
      const l = lines[k] as (typeof lines)[number];
      out.push({ page: l.a.page, text: line, size, x: l.a.x1 + 1, y: l.base });
      return out;
    }
  }
  throw new PrintError(REASONS.long);
}

/** Draws the answers onto their pages, each inside the answer tag. The page's own content is wrapped in q/Q first, so
 *  a graphics state it leaves changed cannot move or scale the answers. */
export function drawPrint(doc: PDFDocument, draws: Draw[], font: PDFFont): void {
  const pages = new Set<number>();
  for (const d of draws) {
    const page: PDFPage = doc.getPage(d.page);
    if (!pages.has(d.page)) {
      pages.add(d.page);
      const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]));
      const end = doc.context.register(doc.context.contentStream([popGraphicsState()]));
      page.node.wrapContentStreams(start, end);
    }
    page.pushOperators(beginMarkedContent(ANSWER_TAG));
    page.drawText(d.text, { x: d.x, y: d.y, size: d.size, font, color: INK });
    page.pushOperators(endMarkedContent());
  }
}

// ---------------------------------------------------------------- the check, by pdf.js

interface Seen extends Run { tagged: boolean }

/** Every text item of every page as pdf.js reads it, and whether it sits inside Distill's answer tag. */
async function seen(pdfjs: PdfJs, bytes: Uint8Array): Promise<Seen[]> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, enableXfa: false, stopAtErrors: false, verbosity: 0 });
  const out: Seen[] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent({ includeMarkedContent: true });
      const tags: (string | null)[] = [];
      for (const it of content.items) {
        const mark = it as { type?: string; tag?: string | null };
        if (mark.type === "beginMarkedContent" || mark.type === "beginMarkedContentProps") { tags.push(mark.tag ?? null); continue; }
        if (mark.type === "endMarkedContent") { tags.pop(); continue; }
        const t = it as PdfJsTextItem;
        if (typeof t.str !== "string" || !t.str.trim() || !Array.isArray(t.transform)) continue;
        const [a = 1, , c = 0, d = 1, e = 0, f = 0] = t.transform;
        const size = Math.hypot(c, d) || t.height || Math.abs(a) || 10;
        out.push({ page: n - 1, text: t.str, x0: e, x1: e + (t.width || 0), y: f, size, tagged: tags.includes(ANSWER_TAG) });
      }
    }
  } finally {
    await task.destroy().catch(() => undefined);
  }
  return out;
}

const same = (a: Run, b: Run) => a.page === b.page && a.text === b.text && Math.abs(a.x0 - b.x0) <= 0.5 && Math.abs(a.y - b.y) <= 0.5;
const within = (r: Run, a: Box, slack = 1) => r.page === a.page && r.x0 >= a.x1 - slack && r.x1 <= a.x2 + slack && r.y >= a.y1 - slack && r.y <= a.y2 + slack;

/**
 * Reads the original and the copy with pdf.js and checks each drawn answer: the copy holds every printed item of the
 * original, and the answer's text (and nothing else new) sits in its place, inside the place's width and height, over
 * no printed word. Returns, per field, null when confirmed or the reason it is not.
 */
export async function confirmPrint(pdfjs: PdfJs, original: Uint8Array, copy: Uint8Array, written: { fieldId: string; binding: PdfBinding; text: string }[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!written.length) return out;
  const fail = (why: string) => { for (const w of written) out.set(w.fieldId, why); return out; };
  let before: Seen[], after: Seen[];
  try {
    [before, after] = [await seen(pdfjs, original), await seen(pdfjs, copy)];
  } catch {
    return fail(REASONS.unconfirmed);
  }
  // Nothing printed may be lost or moved; what is new is the answers.
  if (before.some((b) => !after.some((r) => same(b, r)))) return fail(REASONS.unconfirmed);
  const fresh = after.filter((r) => !before.some((b) => same(b, r)));
  // The ink an answer must not cover: the words of the original page (its leaders and printed tick boxes are where
  // answers go).
  const ink = before.flatMap((r) => cutItem(r)).filter((p) => p.kind === "words").map((p) => ({ page: p.run.page, x1: p.run.x0, x2: p.run.x1, y1: bottom(p.run), y2: top(p.run) }));
  const claimed = new Set<Seen>();
  for (const w of written) {
    const areas = w.binding.print?.areas ?? [];
    const mine = fresh.filter((r) => areas.some((a) => within(r, a, 1.5)));
    mine.forEach((r) => claimed.add(r));
    const read = mine.sort((p, q) => areas.findIndex((a) => within(p, a, 1.5)) - areas.findIndex((a) => within(q, a, 1.5)) || p.x0 - q.x0).map((r) => r.text).join(" ");
    const want = w.text.replace(/\s+/g, "");
    if (read.replace(/\s+/g, "") !== want) { out.set(w.fieldId, REASONS.unconfirmed); continue; }
    const covers = mine.some((r) => ink.some((k) => k.page === r.page && r.x0 < k.x2 - 0.3 && r.x1 > k.x1 + 0.3 && r.y - DESCENT * r.size < k.y2 - 0.3 && r.y + 0.75 * r.size > k.y1 + 0.3));
    if (covers) { out.set(w.fieldId, REASONS.taken); continue; }
    if (!mine.every((r) => r.tagged)) { out.set(w.fieldId, REASONS.unconfirmed); continue; }
    out.set(w.fieldId, null);
  }
  // Anything new that belongs to no answer: the copy holds something it should not.
  if (fresh.some((r) => !claimed.has(r))) return fail(REASONS.unconfirmed);
  return out;
}

export type { FormValues };
