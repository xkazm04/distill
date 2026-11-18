// The printed text of a PDF: pdf.js text items joined into runs (a phrase on one line) and lines, then the page model
// (headings and paragraphs) the Read view shows. Only the page's own content is read: a form field's value lives in the
// field (its annotation), never in the page content that getTextContent returns, so what a person typed into a PDF
// does not reach a run, a label or a block.
import type { Block, PageModel } from "@distill/engine";
import { PDF_URL, type Box, type PdfJsDocument, type PdfJsTextItem } from "./types.js";

/** A phrase of printed text on one line. Coordinates in PDF units; `y` is the baseline. */
export interface Run {
  page: number;
  text: string;
  x0: number;
  x1: number;
  y: number;
  size: number;
}

export const top = (r: Run): number => r.y + 0.8 * r.size;
export const bottom = (r: Run): number => r.y - 0.25 * r.size;

export const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

const isTextItem = (x: unknown): x is PdfJsTextItem =>
  typeof x === "object" && x !== null && typeof (x as PdfJsTextItem).str === "string" && Array.isArray((x as PdfJsTextItem).transform);

/**
 * The marked-content tag around every answer Distill draws onto a print-only page (overlay.ts). Text inside it is a
 * person's answer, not the form's: it is never read as printed text, so a filled copy read again gives the same
 * structure and page model as the blank form, with no value in either.
 */
export const ANSWER_TAG = "DistillAnswer";

/** The text items of every page, horizontal ones only (rotated text is left out), with their size. Text Distill drew
 *  as an answer (ANSWER_TAG) is left out. */
export async function readItems(pdf: PdfJsDocument): Promise<{ items: Run[]; pages: { width: number; height: number; x0: number; y0: number; rotate: number }[] }> {
  const items: Run[] = [];
  const pages: { width: number; height: number; x0: number; y0: number; rotate: number }[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const [vx0 = 0, vy0 = 0, vx1 = 612, vy1 = 792] = page.view;
    pages.push({ width: vx1 - vx0, height: vy1 - vy0, x0: vx0, y0: vy0, rotate: ((page.rotate ?? 0) % 360 + 360) % 360 });
    const content = await page.getTextContent({ includeMarkedContent: true });
    const tags: (string | null)[] = [];
    for (const it of content.items) {
      const mark = it as { type?: string; tag?: string | null };
      if (mark.type === "beginMarkedContent" || mark.type === "beginMarkedContentProps") { tags.push(mark.tag ?? null); continue; }
      if (mark.type === "endMarkedContent") { tags.pop(); continue; }
      if (tags.includes(ANSWER_TAG)) continue;
      if (!isTextItem(it) || !it.str.trim()) continue;
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = it.transform;
      if (Math.abs(b) > 0.01 * Math.abs(a) || a <= 0) continue; // vertical or mirrored text: not a label
      const size = Math.hypot(c, d) || it.height || 10;
      items.push({ page: n - 1, text: it.str, x0: e, x1: e + (it.width || it.str.length * size * 0.5), y: f, size });
    }
  }
  return { items, pages };
}

/**
 * Items joined into runs: the same line (baselines within a third of the size), and a gap no wider than about one
 * character height. A run never crosses a field's box, so the text either side of a field stays apart.
 */
export function buildRuns(items: Run[], boxes: Box[] = []): Run[] {
  const sorted = [...items].sort((p, q) => p.page - q.page || q.y - p.y || p.x0 - q.x0);
  const lines: Run[][] = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    const head = line?.[0];
    if (line && head && head.page === it.page && Math.abs(head.y - it.y) <= 0.35 * Math.min(head.size, it.size)) line.push(it);
    else lines.push([it]);
  }
  const runs: Run[] = [];
  for (const line of lines) {
    line.sort((p, q) => p.x0 - q.x0);
    let cur: Run | null = null;
    for (const it of line) {
      const gap = cur ? it.x0 - cur.x1 : Infinity;
      const between = cur ? boxes.some((b) => b.page === it.page && b.x1 >= (cur as Run).x1 - 1 && b.x2 <= it.x0 + 1 && b.y1 <= it.y + it.size * 0.5 && b.y2 >= it.y) : false;
      if (cur && gap <= 1.1 * Math.max(cur.size, it.size) && !between) {
        const space = gap > 0.12 * it.size && !cur.text.endsWith(" ") && !it.text.startsWith(" ") ? " " : "";
        cur.text += space + it.text;
        cur.x1 = Math.max(cur.x1, it.x1);
        cur.size = Math.max(cur.size, it.size);
      } else {
        if (cur) runs.push(cur);
        cur = { ...it };
      }
    }
    if (cur) runs.push(cur);
  }
  for (const r of runs) r.text = collapse(r.text);
  return runs.filter((r) => r.text);
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : 10;
};

/** The size of ordinary text in the document: the median run size weighted by length. */
export function bodySize(runs: Run[]): number {
  return median(runs.flatMap((r) => Array<number>(Math.min(r.text.length, 200)).fill(Math.round(r.size * 10) / 10)));
}

/** A run printed noticeably larger than the body text. */
export const isHeading = (r: Run, body: number): boolean => r.size >= body * 1.2 && r.text.length >= 3 && /\p{L}/u.test(r.text);

/**
 * The page model of the Read view: the document's lines in reading order, larger lines as headings, the rest joined into
 * paragraphs when they follow each other closely at the same size.
 */
export function buildPage(runs: Run[], meta: { title: string; lang: string; formCount: number }): { page: PageModel; blockBoxes: Record<string, Box> } {
  const body = bodySize(runs);
  const biggest = Math.max(0, ...runs.filter((r) => isHeading(r, body)).map((r) => r.size));
  // Lines: runs on one baseline, joined left to right.
  const lines: { page: number; text: string; size: number; y: number; x0: number; x1: number }[] = [];
  for (const r of runs) {
    const last = lines[lines.length - 1];
    if (last && last.page === r.page && Math.abs(last.y - r.y) <= 0.35 * r.size) {
      last.text += ` ${r.text}`;
      last.x1 = Math.max(last.x1, r.x1);
      last.size = Math.max(last.size, r.size);
    } else lines.push({ page: r.page, text: r.text, size: r.size, y: r.y, x0: r.x0, x1: r.x1 });
  }
  const blocks: Block[] = [];
  const blockBoxes: Record<string, Box> = {};
  let prev: (typeof lines)[number] | null = null;
  for (const line of lines) {
    const heading = line.size >= body * 1.2 && /\p{L}/u.test(line.text) && line.text.length >= 3;
    const last = blocks[blocks.length - 1];
    const lastBox = last ? blockBoxes[last.id] : undefined;
    const joins = !heading && last?.kind === "paragraph" && prev && prev.page === line.page && Math.abs(prev.size - line.size) < 0.5 &&
      prev.y - line.y <= 1.8 * line.size && last.text.length < 600;
    if (joins && last && lastBox) {
      last.text += ` ${line.text}`;
      lastBox.x1 = Math.min(lastBox.x1, line.x0);
      lastBox.x2 = Math.max(lastBox.x2, line.x1);
      lastBox.y1 = Math.min(lastBox.y1, line.y - 0.25 * line.size);
    } else {
      const id = `b${blocks.length}`;
      blocks.push(heading ? { id, kind: "heading", text: line.text, level: line.size >= biggest - 0.5 ? 1 : 2 } : { id, kind: "paragraph", text: line.text });
      blockBoxes[id] = { page: line.page, x1: line.x0, y1: line.y - 0.25 * line.size, x2: line.x1, y2: line.y + 0.8 * line.size };
    }
    prev = line;
  }
  const page: PageModel = { url: PDF_URL, title: meta.title, lang: meta.lang, kind: meta.formCount ? "form" : "other", blocks };
  if (meta.formCount) page.formCount = meta.formCount;
  return { page, blockBoxes };
}

/**
 * The document's title: its first heading (the largest text on the first page that has text), else the title in its
 * metadata unless that looks like a file name or repeats the file's name. The file name itself is never used: it can
 * hold a person's name.
 */
export function documentTitle(runs: Run[], metaTitle: string, fileName?: string): string {
  const body = bodySize(runs);
  const first = runs.length ? (runs[0] as Run).page : 0;
  const onFirst = runs.filter((r) => r.page === first && isHeading(r, body));
  if (onFirst.length) {
    const max = Math.max(...onFirst.map((r) => r.size));
    const heading = onFirst.filter((r) => r.size >= max - 0.5).sort((p, q) => q.y - p.y);
    const t = collapse(heading.slice(0, 2).map((r) => r.text).join(" "));
    if (t) return t.slice(0, 200);
  }
  const t = collapse(metaTitle);
  if (!t || /\.(pdf|docx?|odt|rtf|xlsx?|ods)\b/i.test(t) || /^microsoft (word|excel)\b/i.test(t) || /^[^\s]*_[^\s]*$/.test(t)) return "";
  // A title that is mostly the file's name may be made from it (some tools do): left out.
  const stem = fold((fileName ?? "").replace(/\.[a-z0-9]{1,5}$/i, ""));
  const ft = fold(t);
  if (stem && ft && (ft.includes(stem) || stem.includes(ft)) && Math.min(ft.length, stem.length) >= 0.6 * Math.max(ft.length, stem.length)) return "";
  return t.slice(0, 200);
}

/** Lower case, no diacritics, letters and digits only. */
export const fold = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The document's language: the primary tag of its /Lang when it has one, else a guess from letters only some languages
 * use (the corridor's: Czech, Slovak, Ukrainian, Polish, German), else "und".
 */
export function documentLang(declared: string, text: string): string {
  const primary = (declared.trim().toLowerCase().split(/[-_]/)[0] ?? "");
  if (/^[a-z]{2,3}$/.test(primary)) return primary;
  const has = (re: RegExp): number => (text.match(re) ?? []).length;
  const ukrainian = has(/[іїєґІЇЄҐ]/g);
  const scores: [string, number][] = [
    ["cs", has(/[ěřůĚŘŮ]/g) * 3 + has(/[čšžťďňČŠŽŤĎŇ]/g)],
    ["sk", has(/[ľĺŕôäĽĹŔÔ]/g) * 3],
    // Cyrillic counts as Ukrainian only with a letter Russian does not use.
    ["uk", ukrainian ? ukrainian * 3 + has(/[а-яА-Я]/g) / 10 : 0],
    ["pl", has(/[ąęłńśźżĄĘŁŃŚŹŻ]/g) * 2],
    ["de", has(/[äöüßÄÖÜ]/g)],
  ];
  const [lang, score] = scores.sort((a, b) => b[1] - a[1])[0] as [string, number];
  return score >= 3 ? lang : "und";
}
