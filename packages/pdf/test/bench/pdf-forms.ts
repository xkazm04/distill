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
import { buildPdf, fontBytes, type Layout } from "../corpus/build.js";
import { REFUSALS } from "../corpus/refusals.js";

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
  notes: string[];
}
export interface RefusalResult { slug: string; want: PdfProblemKind; got: PdfProblemKind | "fillable" }
export interface CorpusResult {
  fixtures: FixtureResult[];
  totals: Omit<FixtureResult, "slug" | "title" | "notes">;
  refusals: RefusalResult[];
}

// ---------------------------------------------------------------- loading

export function loadCorpus(dir = CORPUS_DIR): Fixture[] {
  return readdirSync(dir).filter((f) => f.endsWith(".pdf.json")).sort().map((f) => ({
    slug: f.slice(0, -".pdf.json".length),
    expect: JSON.parse(readFileSync(join(dir, f), "utf8")) as Expectation,
  }));
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
  const doc = await PDFDocument.load(bytes);
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
    prefilled: fx.expect.fields.filter((f) => f.value === undefined).length, kept: 0, notes: [],
  };
  const original = await buildPdf(fx.expect.layout);
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

  const out = await fillPdf(original, reading, values, fontBytes());
  res.claimed = out.written.length;
  const seen = await seenByPdfJs(out.bytes);
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
    },
    refusals: await runRefusals(),
  };
}

// ---------------------------------------------------------------- metrics, table, baseline

type Counts = CorpusResult["totals"];
export interface Metrics { recall: number; precision: number; labels: number; shape: number; fill: number; kept: number; refusals: number; falseClaims: number }
const rate = (n: number, d: number): number => (d ? n / d : 1);
export function metrics(c: Counts, refusals: RefusalResult[]): Metrics {
  return {
    recall: rate(c.detected, c.expected), precision: rate(c.detected, c.engineFields), labels: rate(c.labels, c.expected),
    shape: rate(c.shapes, c.expected), fill: rate(c.filled, c.values), kept: rate(c.kept, c.prefilled),
    refusals: rate(refusals.filter((r) => r.got === r.want).length, refusals.length), falseClaims: c.falseClaims,
  };
}

const frac = (n: number, d: number): string => (d ? `${n}/${d} ${Math.round((100 * n) / d)}%` : "-");
function row(name: string, c: Counts): string[] {
  return [name, frac(c.detected, c.expected), frac(c.detected, c.engineFields), frac(c.labels, c.expected), frac(c.shapes, c.expected), frac(c.filled, c.values), frac(c.kept, c.prefilled), `${c.falseClaims} of ${c.claimed}`];
}

export function formatTable(r: CorpusResult, details = true): string {
  const head = ["PDF fixture", "recall", "precision", "labels", "shape", "fill", "kept", "FALSE CLAIMS"];
  const rows = [head, ...r.fixtures.map((f) => row(f.slug, f)), row("TOTAL", r.totals)];
  const widths = head.map((_, i) => Math.max(...rows.map((x) => (x[i] as string).length)));
  const line = (x: string[]): string => x.map((c, i) => (i === 0 ? c.padEnd(widths[i] as number) : c.padStart(widths[i] as number))).join("  ");
  const ok = r.refusals.filter((x) => x.got === x.want).length;
  const out = [
    `PDF form benchmark: ${r.fixtures.length} synthetic Czech PDF forms, built in the run, read back with pdf.js (a different parser from the writer)`,
    "recall, precision, labels (with option labels where listed), shape (kind, required, options, max length where listed) as for web forms;",
    "fill = values pdf.js confirms, the drawn appearance included; kept = pre-filled values still there; FALSE CLAIMS = reported written, refuted by pdf.js.",
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

export interface Baseline {
  note: string;
  totals: Counts;
  metrics: Metrics;
  fixtures: Record<string, Omit<FixtureResult, "slug" | "title" | "notes">>;
  refusals: Record<string, PdfProblemKind | "fillable">;
}

export function toBaseline(r: CorpusResult): Baseline {
  const fixtures: Baseline["fixtures"] = {};
  for (const f of r.fixtures) {
    const { slug, title: _t, notes: _n, ...counts } = f;
    fixtures[slug] = counts;
  }
  const m = metrics(r.totals, r.refusals);
  const round = (x: number): number => Math.round(x * 10000) / 10000;
  return {
    note: "Written only by `npm run bench:forms:update -w @distill/pdf`. corpus.test.ts fails when a total falls below these numbers.",
    totals: r.totals,
    metrics: { recall: round(m.recall), precision: round(m.precision), labels: round(m.labels), shape: round(m.shape), fill: round(m.fill), kept: round(m.kept), refusals: round(m.refusals), falseClaims: m.falseClaims },
    fixtures,
    refusals: Object.fromEntries(r.refusals.map((x) => [x.slug, x.got])),
  };
}

export const readBaseline = (): Baseline => JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
export const writeBaseline = (r: CorpusResult): void => writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(r), null, 2)}\n`);

/** Why the run is worse than the baseline, as sentences. Empty when every total holds. */
export function compareToBaseline(r: CorpusResult, b: Baseline): string[] {
  const out: string[] = [];
  const now = metrics(r.totals, r.refusals);
  const was = b.metrics;
  for (const k of ["recall", "precision", "labels", "shape", "fill", "kept", "refusals"] as const) {
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
