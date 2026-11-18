/// <reference types="node" />
// The print-only section of the PDF form benchmark: synthetic forms made for printing (printed text, dotted and
// underscored leaders, ruled lines, boxes, rows of character boxes, tick squares; no form field at all), each built in
// the run from its <slug>.print.json, with what a careful person would list: every place they would write on, its
// label, and where on the page its answer belongs.
//
// The probes read the saved bytes with pdf.js and are written here, apart from the filler and its own check
// (overlay.ts): an answer counts only when pdf.js finds text in the saved copy that the original did not have, all of it
// inside the place the fixture names, reading exactly as the answer, over no printed word.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import fontkit from "@cantoo/fontkit";
import type { FieldKind, FieldStructure, FormValues } from "@distill/engine";
import { fillPdf, readPdf, type PdfBinding, type PdfReading } from "../../src/index.js";
import { buildPdf, fontBytes, type Layout } from "../corpus/build.js";
import { CORPUS_DIR, PDFJS } from "./pdf-forms.js";

/** pdf.js finds `text` (whitespace aside) as new text inside `within` [x1, y1, x2, y2] on page `page` (0 when absent). */
export interface PrintProbe { text: string; within: [number, number, number, number]; page?: number }
export interface PrintField {
  key: string;
  kind: FieldKind;
  label: string;
  required?: boolean;
  maxLength?: number;
  /** A point inside the place the answer goes ([x, y], page 0 unless `page`): an engine field is this field when one of
   *  its places contains it. */
  at: [number, number];
  page?: number;
  value: string;
  probes: PrintProbe[];
}
export interface PrintExpectation { title: string; models: string; heldOut?: string; layout: Layout; fields: PrintField[] }
export interface PrintFixture { slug: string; expect: PrintExpectation }

export interface PrintResult {
  slug: string;
  expected: number;
  engineFields: number;
  detected: number;
  labels: number;
  /** Matched fields whose label is wrong although Distill presented it as the printed label: the failure that matters. */
  confidentlyWrong: number;
  /** Fields named by their position ("the line under ..."): not counted as right, not counted as confidently wrong. */
  positional: number;
  shapes: number;
  values: number;
  filled: number;
  claimed: number;
  falseClaims: number;
  notes: string[];
}

export function loadPrintCorpus(dir = CORPUS_DIR): PrintFixture[] {
  return readdirSync(dir).filter((f) => f.endsWith(".print.json")).sort().map((f) => ({
    slug: f.slice(0, -".print.json".length),
    expect: JSON.parse(readFileSync(join(dir, f), "utf8")) as PrintExpectation,
  }));
}

export function lintPrint(fx: PrintFixture): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  if (!fx.expect.title || !fx.expect.models) out.push("title and models are required");
  if (fx.expect.layout.pages.some((p) => p.fields.length)) out.push("a print-only fixture has no form fields");
  for (const f of fx.expect.fields) {
    if (keys.has(f.key)) out.push(`duplicate key ${f.key}`);
    keys.add(f.key);
    if (!f.label) out.push(`${f.key}: no label`);
    if (!f.probes?.length && f.value) out.push(`${f.key}: needs a probe`);
    for (const p of f.probes ?? []) if (p.within[0] >= p.within[2] || p.within[1] >= p.within[3]) out.push(`${f.key}: probe area is empty`);
  }
  return out;
}

// ---------------------------------------------------------------- the independent reader

interface Item { page: number; str: string; x0: number; x1: number; y: number; size: number }

async function itemsOf(bytes: Uint8Array): Promise<Item[]> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, verbosity: 0 });
  const out: Item[] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      for (const it of (await page.getTextContent()).items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
        if (typeof it.str !== "string" || !it.str.trim() || !it.transform) continue;
        const [, , c = 0, d = 1, e = 0, f = 0] = it.transform;
        out.push({ page: n - 1, str: it.str, x0: e, x1: e + (it.width ?? 0), y: f, size: Math.hypot(c, d) || it.height || 10 });
      }
    }
  } finally {
    await task.destroy();
  }
  return out;
}

const bare = (s: string): string => s.replace(/\s+/g, "");
const sameItem = (a: Item, b: Item) => a.page === b.page && a.str === b.str && Math.abs(a.x0 - b.x0) <= 0.5 && Math.abs(a.y - b.y) <= 0.5;
/** A printed item with words in it. Items that are only leaders are where answers go; an item that mixes a label and a
 *  leader cannot be split here without the reader's own rules, so it is left out of the overlap test. */
const isWords = (i: Item) => /[\p{L}\p{N}]/u.test(i.str) && !/[_.…]{3,}/u.test(i.str);

/** Why each probe fails on the saved copy, against the original: [] when every probe holds. */
export function failingPrintProbes(before: Item[], after: Item[], f: PrintField): string[] {
  const fresh = after.filter((a) => !before.some((b) => sameItem(a, b)));
  const out: string[] = [];
  for (const p of f.probes) {
    const page = p.page ?? 0;
    const [x1, y1, x2, y2] = p.within;
    const cx = (i: Item) => (i.x0 + i.x1) / 2;
    const mine = fresh.filter((i) => i.page === page && cx(i) >= x1 && cx(i) <= x2 && i.y >= y1 && i.y <= y2).sort((a, b) => b.y - a.y || a.x0 - b.x0);
    const read = mine.map((i) => i.str).join("");
    if (bare(read) !== bare(p.text)) { out.push(`reads ${JSON.stringify(read)} in [${p.within}], want ${JSON.stringify(p.text)}`); continue; }
    const outside = mine.find((i) => i.x0 < x1 - 1.5 || i.x1 > x2 + 1.5);
    if (outside) { out.push(`"${outside.str}" runs out of its place (${outside.x0.toFixed(1)}-${outside.x1.toFixed(1)}, place ${x1}-${x2})`); continue; }
    const over = mine.find((i) => before.some((b) => b.page === i.page && isWords(b) && b.x0 < i.x1 - 0.5 && b.x1 > i.x0 + 0.5 &&
      b.y - 0.22 * b.size < i.y + 0.72 * i.size && b.y + 0.72 * b.size > i.y - 0.22 * i.size));
    if (over) out.push(`"${over.str}" is drawn over printed text`);
  }
  return out;
}

// ---------------------------------------------------------------- soundness and the run

/** Draws each probe's text at its place with pdf-lib alone: the fixture is sound when this satisfies every probe and
 *  the untouched file satisfies none. */
async function byHand(bytes: Uint8Array, fields: PrintField[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes(), { subset: true });
  for (const f of fields) for (const p of f.probes) {
    const [x1, y1, x2, y2] = p.within;
    let size = Math.min(9, (y2 - y1 - 2) / 0.95);
    while (size > 4 && font.widthOfTextAtSize(p.text, size) > x2 - x1 - 3) size -= 0.5;
    doc.getPage(p.page ?? 0).drawText(p.text, { x: x1 + 1.5, y: y1 + Math.max(1, (y2 - y1 - 0.7 * size) / 2), size, font, color: rgb(0, 0, 0.5) });
  }
  return doc.save();
}

export async function checkPrintFixture(fx: PrintFixture): Promise<string[]> {
  const out: string[] = [];
  const blank = await buildPdf(fx.expect.layout);
  const before = await itemsOf(blank);
  for (const f of fx.expect.fields) if (f.value && !failingPrintProbes(before, before, f).length) out.push(`${f.key}: a probe holds before anything is written`);
  const after = await itemsOf(await byHand(blank, fx.expect.fields.filter((f) => f.value)));
  for (const f of fx.expect.fields) {
    if (!f.value) continue;
    const why = failingPrintProbes(before, after, f);
    if (why.length) out.push(`${f.key}: by hand: ${why[0]}`);
  }
  return out;
}

const norm = (s: string): string => s.normalize("NFC").replace(/\s+/g, " ").trim();
const contains = (b: PdfBinding, page: number, [x, y]: [number, number]) => b.boxes.some((a) => a.page === page && x >= a.x1 - 0.5 && x <= a.x2 + 0.5 && y >= a.y1 - 0.5 && y <= a.y2 + 0.5);

export async function runPrintFixture(fx: PrintFixture): Promise<PrintResult> {
  const fields = fx.expect.fields;
  const res: PrintResult = {
    slug: fx.slug, expected: fields.length, engineFields: 0, detected: 0, labels: 0, confidentlyWrong: 0, positional: 0, shapes: 0,
    values: fields.filter((f) => f.value).length, filled: 0, claimed: 0, falseClaims: 0, notes: [],
  };
  const original = await buildPdf(fx.expect.layout);
  let reading: PdfReading;
  try {
    reading = await readPdf(original, { pdfjs: PDFJS, fileName: `${fx.slug}.pdf` });
  } catch (e) {
    res.notes.push(`could not read: ${(e as Error).message}`);
    return res;
  }
  if (!reading.structure || !reading.printOnly) {
    res.notes.push(`not read as print-only: ${reading.problem?.kind ?? "fillable"}`);
    return res;
  }
  const matched: (FieldStructure | undefined)[] = fields.map(() => undefined);
  const bindingOf = new Map(reading.bindings.map((b) => [b.fieldId, b]));
  for (const ef of reading.structure.fields) {
    res.engineFields++;
    const b = bindingOf.get(ef.fieldId) as PdfBinding;
    const i = fields.findIndex((f) => contains(b, f.page ?? 0, f.at));
    const confident = b.print?.label === "printed";
    if (i < 0) res.notes.push(`extra: "${ef.label}" (${ef.kind})${confident ? "" : ", named by its position"} is not a place a person would list`);
    else if (matched[i]) res.notes.push(`extra: "${ef.label}" is a second place for ${fields[i]?.key}`);
    else matched[i] = ef;
  }
  const values: FormValues = {};
  fields.forEach((f, i) => {
    const ef = matched[i];
    if (!ef) { res.notes.push(`missed: ${f.key} ("${f.label}", ${f.kind})`); return; }
    res.detected++;
    const b = bindingOf.get(ef.fieldId) as PdfBinding;
    if (norm(ef.label) === norm(f.label)) res.labels++;
    else if (b.print?.label === "position") { res.positional++; res.notes.push(`named by position: ${f.key} is "${ef.label}", want "${f.label}"`); }
    else { res.confidentlyWrong++; res.notes.push(`CONFIDENTLY WRONG LABEL: ${f.key} is "${ef.label}", want "${f.label}"`); }
    if (ef.kind === f.kind && (f.maxLength === undefined || ef.maxLength === f.maxLength) && ef.required === (f.required ?? false)) res.shapes++;
    else res.notes.push(`shape: ${f.key} is ${ef.kind}/${ef.required ? "required" : "optional"}/max ${ef.maxLength ?? "-"}, want ${f.kind}/${f.required ? "required" : "optional"}/max ${f.maxLength ?? "-"}`);
    if (f.value) values[ef.fieldId] = f.value;
  });
  const out = await fillPdf(original, reading, values, fontBytes(), { pdfjs: PDFJS });
  res.claimed = out.written.length;
  const before = await itemsOf(original);
  const after = await itemsOf(out.bytes);
  fields.forEach((f, i) => {
    const ef = matched[i];
    if (!ef || !f.value) return;
    const why = failingPrintProbes(before, after, f);
    if (!why.length) res.filled++;
    else if (out.written.includes(ef.fieldId)) { res.falseClaims++; res.notes.push(`FALSE CLAIM: ${f.key} reported written, but ${why[0]}`); }
    else res.notes.push(`not filled: ${f.key} (reported failed${out.reasons[ef.fieldId] ? `: ${out.reasons[ef.fieldId]}` : ""}): ${why[0]}`);
  });
  return res;
}

export type PrintCounts = Omit<PrintResult, "slug" | "notes">;

export async function runPrintCorpus(corpus = loadPrintCorpus()): Promise<{ fixtures: PrintResult[]; totals: PrintCounts }> {
  const fixtures: PrintResult[] = [];
  for (const fx of corpus) fixtures.push(await runPrintFixture(fx));
  const keys: (keyof PrintCounts)[] = ["expected", "engineFields", "detected", "labels", "confidentlyWrong", "positional", "shapes", "values", "filled", "claimed", "falseClaims"];
  const totals = Object.fromEntries(keys.map((k) => [k, fixtures.reduce((n, f) => n + f[k], 0)])) as PrintCounts;
  return { fixtures, totals };
}

const frac = (n: number, d: number): string => (d ? `${n}/${d} ${Math.round((100 * n) / d)}%` : "-");

export function formatPrintTable(r: { fixtures: PrintResult[]; totals: PrintCounts }, heldOut: Set<string>, details = true): string {
  const head = ["Print-only fixture", "recall", "precision", "labels", "shape", "fill", "FALSE CLAIMS", "CONFIDENTLY WRONG"];
  const row = (name: string, c: PrintCounts) => [name, frac(c.detected, c.expected), frac(c.detected, c.engineFields), frac(c.labels, c.expected), frac(c.shapes, c.expected), frac(c.filled, c.values), `${c.falseClaims} of ${c.claimed}`, String(c.confidentlyWrong)];
  const rows = [head, ...r.fixtures.map((f) => row(heldOut.has(f.slug) ? `${f.slug} (held out)` : f.slug, f)), row("TOTAL", r.totals)];
  const widths = head.map((_, i) => Math.max(...rows.map((x) => (x[i] as string).length)));
  const line = (x: string[]) => x.map((c, i) => (i === 0 ? c.padEnd(widths[i] as number) : c.padStart(widths[i] as number))).join("  ");
  const out = [
    `Print-only PDFs: ${r.fixtures.length} synthetic forms with no form field; the places to write on are found from the printed page.`,
    "A field matches when one of its places holds the point where the fixture says the answer belongs. fill = answers pdf.js finds as new text",
    "inside their place, reading exactly, over no printed word. labels = the label exactly; places named by their position are not right labels.",
    "",
    line(head),
    ...rows.slice(1, -1).map(line),
    widths.map((n) => "-".repeat(n)).join("  "),
    line(rows[rows.length - 1] as string[]),
    "",
    `Confidently wrong labels (a wrong label presented as the printed one): ${r.totals.confidentlyWrong}`,
    `Named by position instead of a label: ${r.totals.positional}`,
  ];
  if (details) {
    out.push("", "Details:");
    for (const f of r.fixtures) if (f.notes.length) out.push(`  ${f.slug}`, ...f.notes.map((n) => `    ${n}`));
  }
  return out.join("\n");
}
