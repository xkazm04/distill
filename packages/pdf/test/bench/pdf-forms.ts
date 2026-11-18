/// <reference types="node" />
// The PDF form benchmark: how well @distill/pdf finds, labels and fills the fields of the synthetic Czech PDF corpus in
// test/corpus, and whether it refuses the PDFs it cannot fill with the right reason. Each fixture is built in the run
// from its <slug>.pdf.json. Success is judged only by probes that read the saved bytes with pdf.js - a different
// parser from pdf-lib, which writes the file and confirms the writes - including what each field's appearance
// actually draws (the glyphs a viewer shows), never by fillPdf's own `written` list. See test/corpus/README.md in the
// engine for the shared rules, and the PDF section there.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { defaultDropdownAppearanceProvider, PDFDocument, PDFHexString, PDFName } from "@cantoo/pdf-lib";
import fontkit from "@cantoo/fontkit";
import type { FieldKind, FieldStructure, FormValues } from "@distill/engine";
import { fillPdf, PdfOpenError, readPdf, type PdfBinding, type PdfJs, type PdfProblemKind, type PdfReading } from "../../src/index.js";
import { buildPdf, fontBytes, readLayout, type Layout } from "../corpus/build.js";
import { REFUSALS } from "../corpus/refusals.js";
import type { PrintCounts, PrintResult } from "./print-forms.js";

export const CORPUS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../corpus");
export const BASELINE_PATH = join(CORPUS_DIR, "baseline.json");
export const PDFJS = pdfjs as unknown as PdfJs;
const KINDS: readonly FieldKind[] = ["text", "email", "tel", "number", "date", "select", "radio", "checkbox", "textarea", "file", "other"];

/** A probe on one PDF field of the saved file, read by pdf.js: its value, whether a tick box is ticked, and the text
 *  its appearance draws (whitespace ignored). */
export interface Probe { field: string; value?: string; checked?: boolean; shows?: string }
export interface ExpectedField {
  key: string;
  /** The PDF fields this answer is made of. */
  names: string[];
  kind: FieldKind;
  label: string;
  required: boolean;
  options?: number;
  /** When listed, the label of each option must match too (counted in `labels`). */
  optionLabels?: string[];
  maxLength?: number;
  /** What the person answers in the wizard. A field without a value is pre-filled: its probes must survive the fill. */
  value?: string;
  probes: Probe[];
}
export interface Expectation {
  title: string;
  models: string;
  layout: Layout;
  fields: ExpectedField[];
  /** PDF field name -> value, written with pdf-lib's own API and no Distill code: the fixture's soundness check. */
  byHand: Record<string, string>;
  /** Values the file already holds that must never appear in a structure, a page model or a prompt. */
  prefilled?: string[];
}
export interface Fixture { slug: string; expect: Expectation }

export interface FixtureResult {
  slug: string;
  title: string;
  expected: number;
  engineFields: number;
  detected: number;
  labels: number;
  shapes: number;
  values: number;
  filled: number;
  claimed: number;
  falseClaims: number;
  /** Pre-filled fields, and how many still hold their value after the fill. */
  prefilled: number;
  kept: number;
  /** 1 when the file is protected by its author (encrypted, opens without a password); then 1 in `protectionKept`
   *  when pdf.js finds the saved copy encrypted with the same permissions. */
  protected: number;
  protectionKept: number;
  notes: string[];
}
export interface RefusalResult { slug: string; want: PdfProblemKind; got: PdfProblemKind | "fillable" }
export interface CorpusResult {
  fixtures: FixtureResult[];
  totals: Omit<FixtureResult, "slug" | "title" | "notes">;
  refusals: RefusalResult[];
}

// ---------------------------------------------------------------- loading

/** The fixtures, each with its layout (a fixture with `"source"` takes another one's form; see readLayout). */
export function loadCorpus(dir = CORPUS_DIR): Fixture[] {
  return readdirSync(dir).filter((f) => f.endsWith(".pdf.json")).sort().map((f) => {
    const slug = f.slice(0, -".pdf.json".length);
    return { slug, expect: (dir === CORPUS_DIR ? readLayout(slug) : JSON.parse(readFileSync(join(dir, f), "utf8"))) as Expectation };
  });
}

/** Shape problems in an expectation, as plain sentences. Empty when it is well-formed. */
export function lintExpectation(fx: Fixture): string[] {
  const out: string[] = [];
  const e = fx.expect;
  if (!e.title || !e.models) out.push("title and models are required");
  const keys = new Set<string>();
  const layoutNames = new Set(e.layout.pages.flatMap((p) => p.fields.map((f) => f.name)));
  const named = new Set<string>();
  for (const f of e.fields) {
    if (keys.has(f.key)) out.push(`duplicate key ${f.key}`);
    keys.add(f.key);
    if (!KINDS.includes(f.kind)) out.push(`${f.key}: unknown kind ${f.kind}`);
    if (!f.label) out.push(`${f.key}: no label`);
    if (typeof f.required !== "boolean") out.push(`${f.key}: required must be true or false`);
    if (!f.probes?.length) out.push(`${f.key}: needs at least one probe`);
    for (const n of f.names) {
      if (!layoutNames.has(n)) out.push(`${f.key}: ${n} is not a field of the layout`);
      if (named.has(n)) out.push(`${f.key}: ${n} is listed twice`);
      named.add(n);
    }
    for (const p of f.probes ?? []) {
      if (!f.names.includes(p.field)) out.push(`${f.key}: probe on ${p.field}, which is not one of its fields`);
      if (p.value === undefined && p.checked === undefined && p.shows === undefined) out.push(`${f.key}: a probe checks nothing`);
    }
    if (f.optionLabels && f.optionLabels.length !== f.options) out.push(`${f.key}: optionLabels and options disagree`);
  }
  if (!e.fields.some((f) => f.value !== undefined)) out.push("no field has a value to write");
  for (const n of Object.keys(e.byHand)) if (!named.has(n)) out.push(`byHand: ${n} is not a listed field`);
  return out;
}

// ---------------------------------------------------------------- the independent reader (pdf.js)

/** How pdf.js sees a file's protection: its security handler and permission flags, or null when it is not encrypted. */
export async function protectionSeenByPdfJs(bytes: Uint8Array): Promise<{ filter: string; permissions: number[] } | null> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const filter = ((await doc.getMetadata()).info as { EncryptFilterName?: string }).EncryptFilterName;
    if (!filter) return null;
    const perms = (await doc.getPermissions()) as Iterable<number> | null;
    return { filter, permissions: [...(perms ?? [])].sort((a, b) => a - b) };
  } finally {
    await task.destroy();
  }
}

interface Seen { value: unknown; exportValue?: string; shown: string; missingGlyph: boolean }

/** What pdf.js sees in the saved bytes: each field's value, and the text its widgets' appearances draw. */
export async function seenByPdfJs(bytes: Uint8Array): Promise<Map<string, Seen>> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, verbosity: 0 });
  const doc = await task.promise;
  const out = new Map<string, Seen>();
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const anns = (await page.getAnnotations()) as { id: string; fieldName?: string; fieldValue?: unknown; exportValue?: string }[];
      const nameOf = new Map<string, string>();
      for (const a of anns) {
        if (!a.fieldName) continue;
        nameOf.set(a.id, a.fieldName);
        const cur = out.get(a.fieldName);
        if (!cur) out.set(a.fieldName, { value: a.fieldValue, exportValue: a.exportValue, shown: "", missingGlyph: false });
      }
      const ops = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE });
      let cur: string | null = null;
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i] as unknown[];
        if (fn === pdfjs.OPS.beginAnnotation) cur = nameOf.get(String(args[0])) ?? null;
        else if (fn === pdfjs.OPS.endAnnotation) cur = null;
        else if (fn === pdfjs.OPS.showText && cur) {
          const s = out.get(cur);
          if (!s) continue;
          for (const g of args[0] as ({ unicode?: string; isInFont?: boolean } | number | null)[]) {
            if (!g || typeof g === "number") continue;
            s.shown += g.unicode ?? "";
            if (g.isInFont === false && (g.unicode ?? "").trim()) s.missingGlyph = true;
          }
        }
      }
    }
  } finally {
    await task.destroy();
  }
  return out;
}

const bare = (s: string): string => s.replace(/\s+/g, "");

/** The probes of a field that do not hold in what pdf.js sees, as sentences. */
export function failingProbes(seen: Map<string, Seen>, f: ExpectedField): string[] {
  const out: string[] = [];
  for (const p of f.probes) {
    const s = seen.get(p.field);
    if (!s) { out.push(`${p.field} is not in the file`); continue; }
    if (p.value !== undefined) {
      const v = Array.isArray(s.value) ? String(s.value[0] ?? "") : String(s.value ?? "");
      if (v.replace(/\r\n?/g, "\n") !== p.value) out.push(`${p.field} holds ${JSON.stringify(v)}, want ${JSON.stringify(p.value)}`);
    }
    if (p.checked !== undefined) {
      const on = String(s.value ?? "Off") !== "Off" && (s.exportValue === undefined || String(s.value) === s.exportValue);
      if (on !== p.checked) out.push(`${p.field} is ${on ? "ticked" : "not ticked"}`);
    }
    if (p.shows !== undefined) {
      if (bare(s.shown) !== bare(p.shows)) out.push(`${p.field} draws ${JSON.stringify(s.shown)}, want ${JSON.stringify(p.shows)}`);
      else if (s.missingGlyph) out.push(`${p.field} draws a character its font does not have`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- soundness and the run

/** Fills the fixture with pdf-lib's own API and no Distill code, as any PDF tool would. */
async function byHand(bytes: Uint8Array, values: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password: "" }); // a protected file opens with no password, as in any reader
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes(), { subset: true });
  const form = doc.getForm();
  for (const [name, v] of Object.entries(values)) {
    const f = form.getField(name);
    const type = f.constructor.name;
    if (type === "PDFTextField") form.getTextField(name).setText(v);
    else if (type === "PDFCheckBox") { if (v === "true") form.getCheckBox(name).check(); }
    else if (type === "PDFRadioGroup") form.getRadioGroup(name).select(v);
    else if (type === "PDFDropdown") form.getDropdown(name).acroField.dict.set(PDFName.of("V"), PDFHexString.fromText(v)); // the export value, as the spec says
  }
  form.updateFieldAppearances(font);
  // The dropdown with [export, shown] pairs draws its shown text, as a viewer would.
  for (const f of form.getFields()) {
    if (f.constructor.name !== "PDFDropdown") continue;
    const dd = form.getDropdown(f.getName());
    const v = dd.acroField.getValues()[0];
    const opt = dd.acroField.getOptions().find((o) => v && o.value.decodeText() === (v as PDFHexString).decodeText());
    if (opt?.display) {
      const shown = opt.display.decodeText();
      const showing = new Proxy(dd, { get: (t, k, r) => (k === "getSelected" ? () => [shown] : Reflect.get(t, k, r)) });
      dd.updateAppearances(font, (_d, w, fo) => defaultDropdownAppearanceProvider(showing, w, fo));
    }
  }
  return doc.save({ updateFieldAppearances: false });
}

/** Why a fixture cannot be trusted, as sentences: a probe of an answer holds before anything is written, a pre-filled
 *  value does not hold on the untouched file, or the by-hand fill does not satisfy every probe. Empty when sound. */
export async function checkFixture(fx: Fixture): Promise<string[]> {
  const out: string[] = [];
  const blank = await buildPdf(fx.expect.layout);
  // A protected fixture must really be encrypted, and pdf.js must open it with no password and read its fields (the
  // probes below look them up by name).
  if (fx.expect.layout.protect && !(await protectionSeenByPdfJs(blank))) out.push("protect: the built file is not encrypted");
  const before = await seenByPdfJs(blank);
  for (const f of fx.expect.fields) {
    const fails = failingProbes(before, f);
    if (f.value !== undefined) {
      for (const p of f.probes) if (!failingProbes(before, { ...f, probes: [p] }).length && (p.value || p.checked || p.shows)) out.push(`${f.key}: probe on ${p.field} already holds before the fill`);
    } else if (fails.length) out.push(`${f.key}: pre-filled value does not hold untouched: ${fails[0]}`);
  }
  const after = await seenByPdfJs(await byHand(blank, fx.expect.byHand));
  for (const f of fx.expect.fields) {
    const fails = failingProbes(after, f);
    if (fails.length) out.push(`${f.key}: by hand: ${fails[0]}`);
  }
  return out;
}

const norm = (s: string): string => s.normalize("NFC").replace(/\s+/g, " ").trim();

export async function runFixture(fx: Fixture): Promise<FixtureResult> {
  const res: FixtureResult = {
    slug: fx.slug, title: fx.expect.title, expected: fx.expect.fields.length, engineFields: 0, detected: 0, labels: 0, shapes: 0,
    values: fx.expect.fields.filter((f) => f.value !== undefined).length, filled: 0, claimed: 0, falseClaims: 0,
    prefilled: fx.expect.fields.filter((f) => f.value === undefined).length, kept: 0, protected: 0, protectionKept: 0, notes: [],
  };
  const original = await buildPdf(fx.expect.layout);
  const before = await protectionSeenByPdfJs(original);
  if (before) res.protected = 1;
  let reading: PdfReading;
  try {
    reading = await readPdf(original, { pdfjs: PDFJS, fileName: `${fx.slug}.pdf` });
  } catch (e) {
    res.notes.push(`could not read: ${(e as Error).message}`);
    return res;
  }
  if (!reading.structure) {
    res.notes.push(`refused: ${reading.problem?.kind}: ${reading.problem?.title}`);
    return res;
  }
  const fields = fx.expect.fields;
  const matched: (FieldStructure | undefined)[] = fields.map(() => undefined);
  const bindingOf = new Map<string, PdfBinding>(reading.bindings.map((b) => [b.fieldId, b]));
  for (const ef of reading.structure.fields) {
    res.engineFields++;
    const names = bindingOf.get(ef.fieldId)?.names ?? [];
    const i = fields.findIndex((f) => f.names.some((n) => names.includes(n)));
    const f = fields[i];
    if (i < 0 || !f) res.notes.push(`extra: engine field "${ef.fieldId}" ("${ef.label}") is not a field a person would list`);
    else if (matched[i]) res.notes.push(`extra: engine field "${ef.fieldId}" ("${ef.label}") is a second piece of ${f.key}`);
    else {
      matched[i] = ef;
      const allNames = new Set(names);
      if (f.names.some((n) => !allNames.has(n)) || names.some((n) => !f.names.includes(n))) res.notes.push(`pieces: ${f.key} is made of ${names.join(", ")}, want ${f.names.join(", ")}`);
    }
  }
  const values: FormValues = {};
  fields.forEach((f, i) => {
    const ef = matched[i];
    if (!ef) {
      res.notes.push(`missed: ${f.key} ("${f.label}", ${f.kind})`);
      if (f.value !== undefined) res.notes.push(`not filled: ${f.key} (not detected)`);
      return;
    }
    res.detected++;
    const optLabels = (ef.options ?? []).map((o) => norm(o.label));
    const labelOk = norm(ef.label) === norm(f.label) && (!f.optionLabels || JSON.stringify(optLabels) === JSON.stringify(f.optionLabels.map(norm)));
    if (labelOk) res.labels++;
    else res.notes.push(`label: ${f.key} is "${ef.label}"${f.optionLabels ? ` [${optLabels.join(", ")}]` : ""}, want "${f.label}"${f.optionLabels ? ` [${f.optionLabels.join(", ")}]` : ""}`);
    const got = ef.options?.length ?? 0;
    const shapeOk = ef.kind === f.kind && ef.required === f.required && got === (f.options ?? 0) && (f.maxLength === undefined || ef.maxLength === f.maxLength);
    if (shapeOk) res.shapes++;
    else res.notes.push(`shape: ${f.key} is ${ef.kind}/${ef.required ? "required" : "optional"}/${got} options/max ${ef.maxLength ?? "-"}, want ${f.kind}/${f.required ? "required" : "optional"}/${f.options ?? 0} options/max ${f.maxLength ?? "-"}`);
    if (f.value !== undefined) values[ef.fieldId] = f.value;
  });

  let out: Awaited<ReturnType<typeof fillPdf>>;
  try {
    out = await fillPdf(original, reading, values, fontBytes());
  } catch (e) {
    res.notes.push(`no copy saved: ${(e as Error).message}`);
    return res;
  }
  res.claimed = out.written.length;
  const seen = await seenByPdfJs(out.bytes);
  if (before) {
    // The copy of a protected file must be protected the same way, as pdf.js reads it.
    const after = await protectionSeenByPdfJs(out.bytes);
    if (after && after.filter === before.filter && JSON.stringify(after.permissions) === JSON.stringify(before.permissions)) res.protectionKept = 1;
    else res.notes.push(`PROTECTION LOST: the original is ${before.filter} with permissions [${before.permissions}], the copy is ${after ? `${after.filter} with [${after.permissions}]` : "not encrypted"}`);
  }
  fields.forEach((f, i) => {
    const ef = matched[i];
    const why = failingProbes(seen, f);
    if (f.value === undefined) {
      if (!why.length) res.kept++;
      else res.notes.push(`pre-filled value lost: ${f.key}: ${why[0]}`);
      return;
    }
    if (!ef) return;
    if (!why.length) res.filled++;
    else if (out.written.includes(ef.fieldId)) {
      res.falseClaims++;
      res.notes.push(`FALSE CLAIM: ${f.key} reported written, but ${why[0]}`);
    } else res.notes.push(`not filled: ${f.key} (reported failed): ${why[0]}`);
  });
  return res;
}

export async function runRefusals(): Promise<RefusalResult[]> {
  const out: RefusalResult[] = [];
  for (const r of REFUSALS) {
    let got: RefusalResult["got"];
    try {
      const reading = await readPdf(await r.build(), { pdfjs: PDFJS });
      got = reading.problem?.kind ?? "fillable";
    } catch (e) {
      got = e instanceof PdfOpenError ? e.problem.kind : "broken";
    }
    out.push({ slug: r.slug, want: r.want, got });
  }
  return out;
}

export async function runCorpus(corpus = loadCorpus()): Promise<CorpusResult> {
  const fixtures: FixtureResult[] = [];
  for (const fx of corpus) fixtures.push(await runFixture(fx));
  const sum = (k: keyof CorpusResult["totals"]): number => fixtures.reduce((n, f) => n + f[k], 0);
  return {
    fixtures,
    totals: {
      expected: sum("expected"), engineFields: sum("engineFields"), detected: sum("detected"), labels: sum("labels"), shapes: sum("shapes"),
      values: sum("values"), filled: sum("filled"), claimed: sum("claimed"), falseClaims: sum("falseClaims"), prefilled: sum("prefilled"), kept: sum("kept"),
      protected: sum("protected"), protectionKept: sum("protectionKept"),
    },
    refusals: await runRefusals(),
  };
}

// ---------------------------------------------------------------- metrics, table, baseline

type Counts = CorpusResult["totals"];
export interface Metrics { recall: number; precision: number; labels: number; shape: number; fill: number; kept: number; protection: number; refusals: number; falseClaims: number }
const rate = (n: number, d: number): number => (d ? n / d : 1);
export function metrics(c: Counts, refusals: RefusalResult[]): Metrics {
  return {
    recall: rate(c.detected, c.expected), precision: rate(c.detected, c.engineFields), labels: rate(c.labels, c.expected),
    shape: rate(c.shapes, c.expected), fill: rate(c.filled, c.values), kept: rate(c.kept, c.prefilled), protection: rate(c.protectionKept, c.protected),
    refusals: rate(refusals.filter((r) => r.got === r.want).length, refusals.length), falseClaims: c.falseClaims,
  };
}

const frac = (n: number, d: number): string => (d ? `${n}/${d} ${Math.round((100 * n) / d)}%` : "-");
function row(name: string, c: Counts): string[] {
  return [name, frac(c.detected, c.expected), frac(c.detected, c.engineFields), frac(c.labels, c.expected), frac(c.shapes, c.expected), frac(c.filled, c.values), frac(c.kept, c.prefilled), frac(c.protectionKept, c.protected), `${c.falseClaims} of ${c.claimed}`];
}

export function formatTable(r: CorpusResult, details = true): string {
  const head = ["PDF fixture", "recall", "precision", "labels", "shape", "fill", "kept", "protection", "FALSE CLAIMS"];
  const rows = [head, ...r.fixtures.map((f) => row(f.slug, f)), row("TOTAL", r.totals)];
  const widths = head.map((_, i) => Math.max(...rows.map((x) => (x[i] as string).length)));
  const line = (x: string[]): string => x.map((c, i) => (i === 0 ? c.padEnd(widths[i] as number) : c.padStart(widths[i] as number))).join("  ");
  const ok = r.refusals.filter((x) => x.got === x.want).length;
  const out = [
    `PDF form benchmark: ${r.fixtures.length} synthetic Czech PDF forms, built in the run, read back with pdf.js (a different parser from the writer)`,
    "recall, precision, labels (with option labels where listed), shape (kind, required, options, max length where listed) as for web forms;",
    "fill = values pdf.js confirms, the drawn appearance included; kept = pre-filled values still there;",
    "protection = protected originals whose copy pdf.js finds encrypted with the same permissions; FALSE CLAIMS = reported written, refuted by pdf.js.",
    "",
    line(head),
    ...rows.slice(1, -1).map(line),
    widths.map((n) => "-".repeat(n)).join("  "),
    line(rows[rows.length - 1] as string[]),
    "",
    `Refused with the right reason: ${ok}/${r.refusals.length}`,
    ...r.refusals.map((x) => `  ${x.slug.padEnd(12)} ${x.got === x.want ? "ok  " : "MISS"} ${x.got}${x.got === x.want ? "" : ` (want ${x.want})`}`),
  ];
  if (details) {
    out.push("", "Details:");
    for (const f of r.fixtures) if (f.notes.length) out.push(`  ${f.slug}`, ...f.notes.map((n) => `    ${n}`));
  }
  return out.join("\n");
}

export interface PrintMetrics { recall: number; precision: number; labels: number; shape: number; fill: number; falseClaims: number; confidentlyWrong: number }
export interface Baseline {
  note: string;
  totals: Counts;
  metrics: Metrics;
  fixtures: Record<string, Omit<FixtureResult, "slug" | "title" | "notes">>;
  refusals: Record<string, PdfProblemKind | "fillable">;
  /** The print-only section: PDFs with no form field, whose places to write on are found from the printed page. */
  printOnly?: { totals: PrintCounts; metrics: PrintMetrics; fixtures: Record<string, PrintCounts> };
}

export function printMetrics(c: PrintCounts): PrintMetrics {
  return {
    recall: rate(c.detected, c.expected), precision: rate(c.detected, c.engineFields), labels: rate(c.labels, c.expected), shape: rate(c.shapes, c.expected),
    fill: rate(c.filled, c.values), falseClaims: c.falseClaims, confidentlyWrong: c.confidentlyWrong,
  };
}

export function toBaseline(r: CorpusResult, p?: { fixtures: PrintResult[]; totals: PrintCounts }): Baseline {
  const fixtures: Baseline["fixtures"] = {};
  for (const f of r.fixtures) {
    const { slug, title: _t, notes: _n, ...counts } = f;
    fixtures[slug] = counts;
  }
  const m = metrics(r.totals, r.refusals);
  const round = (x: number): number => Math.round(x * 10000) / 10000;
  const out: Baseline = {
    note: "Written only by `npm run bench:forms:update -w @distill/pdf`. corpus.test.ts fails when a total falls below these numbers.",
    totals: r.totals,
    metrics: { recall: round(m.recall), precision: round(m.precision), labels: round(m.labels), shape: round(m.shape), fill: round(m.fill), kept: round(m.kept), protection: round(m.protection), refusals: round(m.refusals), falseClaims: m.falseClaims },
    fixtures,
    refusals: Object.fromEntries(r.refusals.map((x) => [x.slug, x.got])),
  };
  if (p) {
    const pm = printMetrics(p.totals);
    out.printOnly = {
      totals: p.totals,
      metrics: { recall: round(pm.recall), precision: round(pm.precision), labels: round(pm.labels), shape: round(pm.shape), fill: round(pm.fill), falseClaims: pm.falseClaims, confidentlyWrong: pm.confidentlyWrong },
      fixtures: Object.fromEntries(p.fixtures.map(({ slug, notes: _n, ...c }) => [slug, c])),
    };
  }
  return out;
}

export const readBaseline = (): Baseline => JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
export const writeBaseline = (r: CorpusResult, p?: { fixtures: PrintResult[]; totals: PrintCounts }): void => writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(r, p), null, 2)}\n`);

/** Why the run is worse than the baseline, as sentences. Empty when every total holds. */
export function compareToBaseline(r: CorpusResult, b: Baseline, p?: { fixtures: PrintResult[]; totals: PrintCounts }): string[] {
  const out: string[] = [];
  if (p && b.printOnly) {
    const now = printMetrics(p.totals);
    const was = b.printOnly.metrics;
    for (const k of ["recall", "precision", "labels", "shape", "fill"] as const) if (now[k] < was[k] - 1e-4) out.push(`print-only ${k} fell from ${was[k].toFixed(4)} to ${now[k].toFixed(4)}`);
    if (now.falseClaims > was.falseClaims) out.push(`print-only false claims rose from ${was.falseClaims} to ${now.falseClaims}`);
    if (now.confidentlyWrong > was.confidentlyWrong) out.push(`print-only confidently wrong labels rose from ${was.confidentlyWrong} to ${now.confidentlyWrong}`);
    for (const slug of Object.keys(b.printOnly.fixtures)) if (!p.fixtures.some((f) => f.slug === slug)) out.push(`print-only fixture ${slug} is gone`);
    for (const f of p.fixtures) if (!(f.slug in b.printOnly.fixtures)) out.push(`print-only fixture ${f.slug} is not in the baseline`);
  } else if (p && p.fixtures.length) out.push("the print-only section is not in the baseline");
  const now = metrics(r.totals, r.refusals);
  const was = b.metrics;
  for (const k of ["recall", "precision", "labels", "shape", "fill", "kept", "protection", "refusals"] as const) {
    if (typeof was[k] !== "number") continue; // a metric newer than the stored baseline
    if (now[k] < was[k] - 1e-4) out.push(`${k} fell from ${was[k].toFixed(4)} to ${now[k].toFixed(4)}`);
  }
  if (now.falseClaims > was.falseClaims) out.push(`false claims rose from ${was.falseClaims} to ${now.falseClaims}`);
  for (const slug of Object.keys(b.fixtures)) if (!r.fixtures.some((f) => f.slug === slug)) out.push(`fixture ${slug} is gone`);
  for (const f of r.fixtures) if (!(f.slug in b.fixtures)) out.push(`fixture ${f.slug} is not in the baseline`);
  for (const [slug, kind] of Object.entries(b.refusals)) {
    const cur = r.refusals.find((x) => x.slug === slug);
    if (!cur) out.push(`refusal ${slug} is gone`);
    else if (cur.got !== kind && kind === cur.want) out.push(`refusal ${slug} now says ${cur.got}, was ${kind}`);
  }
  for (const x of r.refusals) if (!(x.slug in b.refusals)) out.push(`refusal ${x.slug} is not in the baseline`);
  return out;
}

// ---------------------------------------------------------------- the reader's version

/**
 * What the reader reads each corpus PDF as, for one version of it (PDF_READER): per fixture, sha-256 of the title and
 * the fields' ids, kinds and labels, the things a guide's fingerprint is made of. Written with the baseline. When the
 * reader reads any fixture differently while PDF_READER stays the same, corpus.test.ts fails: a guide written by the
 * old reader would look drifted although its form did not change, so the version must say the reader changed
 * (scripts/guides/drift.mjs tells the two apart, and `npm run guide:new -- --refresh <id>` refreshes a guide's fields).
 */
export const READER_PATH = join(CORPUS_DIR, "reader.json");
export interface ReaderSnapshot { note: string; reader: string; forms: Record<string, string> }

export async function readerSnapshot(): Promise<ReaderSnapshot> {
  const { createHash } = await import("node:crypto");
  const { PDF_READER } = await import("../../src/index.js");
  const { loadPrintCorpus } = await import("./print-forms.js");
  const layouts: [string, Layout][] = [
    ...loadCorpus().map((f) => [f.slug, f.expect.layout] as [string, Layout]),
    ...loadPrintCorpus().map((f) => [f.slug, f.expect.layout] as [string, Layout]),
  ];
  const forms: Record<string, string> = {};
  for (const [slug, layout] of layouts) {
    const r = await readPdf(await buildPdf(layout), { pdfjs: PDFJS, fileName: `${slug}.pdf` });
    const read = { title: r.structure?.title ?? "", fields: (r.structure?.fields ?? []).map((f) => [f.fieldId, f.kind, f.label]) };
    forms[slug] = createHash("sha256").update(JSON.stringify(read)).digest("hex");
  }
  return { note: "Written with the baseline (npm run bench:forms:update -w @distill/pdf). See readerSnapshot in test/bench/pdf-forms.ts.", reader: PDF_READER, forms };
}

export const writeReader = (s: ReaderSnapshot): void => writeFileSync(READER_PATH, `${JSON.stringify(s, null, 2)}\n`);

/** Why the stored snapshot no longer fits the reader, as sentences. Empty when it does. */
export function compareReader(now: ReaderSnapshot, stored: ReaderSnapshot): string[] {
  if (stored.reader !== now.reader) return [`reader.json was written for ${stored.reader}, the reader is now ${now.reader}: run npm run bench:forms:update -w @distill/pdf`];
  const changed = Object.keys(stored.forms).filter((slug) => slug in now.forms && stored.forms[slug] !== now.forms[slug]);
  return changed.length
    ? [`the reader now reads ${changed.join(", ")} differently (title, field ids, kinds or labels) while PDF_READER is still ${now.reader}: raise PDF_READER in packages/pdf/src/read.ts, update the baseline, and refresh the PDF guides (npm run guides:drift, then npm run guide:new -- --refresh <id>)`]
    : [];
}
