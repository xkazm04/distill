/// <reference types="node" />
// The form benchmark: how well Wayfill's engine finds, labels and fills the fields of the synthetic Czech corpus in
// test/corpus. Every fixture runs in its own happy-dom window with page scripts on, so masks, widgets and framework
// stand-ins behave as they would in a browser. Success is judged only by each fixture's DOM probes, never by
// readValues or by writeValues' own `written` list; a by-hand fill (keyboard and mouse events, no engine code) must
// satisfy the same probes first, or the fixture is not measurable and is reported as such. See test/corpus/README.md.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { extractForm, writeValues, type FieldKind, type FieldStructure, type FormValues } from "../../src/index.js";

export const CORPUS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../corpus");
export const BASELINE_PATH = join(CORPUS_DIR, "baseline.json");

export type Capability = "javascript" | "shadow-dom" | "iframe-srcdoc" | "declarative-shadow-dom";
export const CAPABILITIES: readonly Capability[] = ["javascript", "shadow-dom", "iframe-srcdoc", "declarative-shadow-dom"];
const KINDS: readonly FieldKind[] = ["text", "email", "tel", "number", "date", "select", "radio", "checkbox", "textarea", "file", "other"];

/** A probe: the element at `at` (exactly one) must hold `equals` in a property or an attribute after the fill. */
export interface Probe {
  at: string;
  prop?: string;
  attr?: string;
  equals: string | boolean;
}
/** What a person does: type on the keyboard, click, choose in a native select, or pick in a native picker (date). */
export type HandStep = { type: string; text: string } | { click: string } | { choose: string; option: string } | { pick: string; value: string };
export interface ExpectedField {
  key: string;
  /** CSS; " >>> " steps into an open shadow root (or a same-origin iframe's document). An array lists every element of the field. */
  locator: string | string[];
  kind: FieldKind;
  label: string;
  required: boolean;
  options?: number;
  value?: string;
  probes?: Probe[];
  note?: string;
}
/** One step of a form shown in steps: what a person does to reach it (nothing, for the first), and the keys of the
 *  fields it shows. The engine is run again on each step, as the apps re-read a form when the page changes. */
export interface FormStep {
  do?: HandStep[];
  fields: string[];
}
export interface Expectation {
  title: string;
  models: string;
  requires?: Capability[];
  source?: string;
  fields: ExpectedField[];
  /** Absent: one step, every field visible on load. */
  steps?: FormStep[];
  byHand: HandStep[];
}
export interface Fixture {
  slug: string;
  html: string;
  expect: Expectation;
}

export interface FixtureResult {
  slug: string;
  title: string;
  measurable: boolean;
  reason?: string;
  expected: number;
  engineFields: number;
  detected: number;
  labels: number;
  shapes: number;
  values: number;
  filled: number;
  claimed: number;
  falseClaims: number;
  /** One plain line per miss, for the next person reading the report. */
  notes: string[];
}
export interface CorpusResult {
  fixtures: FixtureResult[];
  totals: Omit<FixtureResult, "slug" | "title" | "measurable" | "reason" | "notes">;
}

// ---------------------------------------------------------------- loading

export function loadCorpus(dir = CORPUS_DIR): Fixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".expect.json"))
    .sort()
    .map((f) => {
      const slug = f.slice(0, -".expect.json".length);
      const expect = JSON.parse(readFileSync(join(dir, f), "utf8")) as Expectation;
      const html = readFileSync(join(dir, expect.source ?? `${slug}.html`), "utf8");
      return { slug, html, expect };
    });
}

/** Shape problems in an expectation file, as plain sentences. Empty when it is well-formed. */
export function lintExpectation(fx: Fixture): string[] {
  const out: string[] = [];
  const e = fx.expect;
  if (!e.title || !e.models) out.push("title and models are required");
  for (const c of e.requires ?? []) if (!CAPABILITIES.includes(c)) out.push(`unknown capability ${c}`);
  const keys = new Set<string>();
  for (const f of e.fields) {
    if (keys.has(f.key)) out.push(`duplicate key ${f.key}`);
    keys.add(f.key);
    if (!KINDS.includes(f.kind)) out.push(`${f.key}: unknown kind ${f.kind}`);
    if (!f.label) out.push(`${f.key}: no label`);
    if (typeof f.required !== "boolean") out.push(`${f.key}: required must be true or false`);
    if (f.value !== undefined && !(f.probes && f.probes.length)) out.push(`${f.key}: a value needs at least one probe`);
    for (const p of f.probes ?? []) if ((p.prop === undefined) === (p.attr === undefined)) out.push(`${f.key}: a probe names a prop or an attr`);
  }
  if (!e.fields.some((f) => f.value !== undefined)) out.push("no field has a value to write");
  if (e.steps) {
    const seen = new Map<string, number>();
    e.steps.forEach((st, i) => {
      if (i > 0 && !st.do?.length) out.push(`step ${i + 1}: says nothing a person does to reach it`);
      for (const k of st.fields) {
        if (!keys.has(k)) out.push(`step ${i + 1}: unknown field ${k}`);
        if (seen.has(k)) out.push(`${k}: listed in step ${(seen.get(k) as number) + 1} and step ${i + 1}`);
        seen.set(k, i);
      }
    });
    for (const k of keys) if (!seen.has(k)) out.push(`${k}: in no step`);
  }
  return out;
}

// ---------------------------------------------------------------- the window

const SETTINGS = { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true };
type Win = InstanceType<typeof Window>;

/** A fixture's page in a fresh window with its scripts run; the caller closes it with `window.happyDOM.close()`. */
export async function openFixture(fx: Fixture): Promise<Win> {
  return open(fx.html, urlFor(fx.slug));
}

async function open(html: string, url: string): Promise<Win> {
  const w = new Window({ url, settings: SETTINGS });
  w.document.write(html);
  await w.happyDOM.waitUntilComplete();
  return w;
}
async function settle(w: Win): Promise<void> {
  await w.happyDOM.waitUntilComplete();
  await new Promise((r) => setTimeout(r, 0));
}
async function closeWin(w: Win): Promise<void> {
  await w.happyDOM.close();
}

/** What this environment can represent, found by trying it, not by assuming. */
export async function probeCapabilities(): Promise<Record<Capability, boolean>> {
  const w = await open(
    `<!doctype html><html><body><div id="dsd"><template shadowrootmode="open"><i id="in-dsd"></i></template></div>
    <div id="host"></div><iframe id="frame" srcdoc="<p id='in-frame'>x</p>"></iframe>
    <script>document.body.setAttribute("data-js", "1");
    try { document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = "<b id='in-shadow'></b>"; } catch (e) {}</script>
    </body></html>`,
    "https://capabilities.example/",
  );
  const d = w.document as unknown as Document;
  const frame = d.getElementById("frame") as HTMLIFrameElement | null;
  const caps: Record<Capability, boolean> = {
    javascript: d.body.getAttribute("data-js") === "1",
    "shadow-dom": !!d.getElementById("host")?.shadowRoot?.getElementById("in-shadow"),
    "iframe-srcdoc": !!frame?.contentDocument?.getElementById("in-frame"),
    "declarative-shadow-dom": !!d.getElementById("dsd")?.shadowRoot?.getElementById("in-dsd"),
  };
  await closeWin(w);
  return caps;
}

// ---------------------------------------------------------------- locating, independent of the engine

type Scope = Document | ShadowRoot;

function inner(el: Element): Scope | null {
  if (el.localName === "iframe") return (el as HTMLIFrameElement).contentDocument;
  return el.shadowRoot;
}

/** Elements for a locator; " >>> " steps into a shadow root or a frame. */
export function query(doc: Document, loc: string): Element[] {
  const steps = loc.split(">>>").map((s) => s.trim());
  let scopes: Scope[] = [doc];
  let found: Element[] = [];
  steps.forEach((sel, i) => {
    found = scopes.flatMap((s) => Array.from(s.querySelectorAll(sel)));
    if (i < steps.length - 1) scopes = found.map(inner).filter((s): s is Scope => !!s);
  });
  return found;
}
const locate = (doc: Document, loc: string | string[]): Element[] => [...new Set((Array.isArray(loc) ? loc : [loc]).flatMap((l) => query(doc, l)))];

/** Every scope of the page: the document, open shadow roots and same-origin frames, recursively. */
function allScopes(doc: Document): Scope[] {
  const out: Scope[] = [];
  const visit = (s: Scope): void => {
    out.push(s);
    for (const el of Array.from(s.querySelectorAll("*"))) {
      const i = inner(el);
      if (i) visit(i);
    }
  };
  visit(doc);
  return out;
}

/** The elements an engine fieldId names: by id or name attribute, anywhere on the page. */
function elementsForFieldId(doc: Document, fieldId: string): Element[] {
  return allScopes(doc).flatMap((s) =>
    Array.from(s.querySelectorAll("[id], [name]")).filter((el) => el.getAttribute("id") === fieldId || el.getAttribute("name") === fieldId),
  );
}

function probeHolds(doc: Document, p: Probe): { ok: boolean; actual: string } {
  const els = query(doc, p.at);
  if (els.length !== 1) return { ok: false, actual: `${els.length} elements match` };
  const el = els[0] as Element;
  const actual: unknown = p.attr !== undefined ? el.getAttribute(p.attr) : (el as unknown as Record<string, unknown>)[p.prop as string];
  if (typeof p.equals === "boolean") return { ok: actual === p.equals, actual: String(actual) };
  const text = String(actual ?? "").replace(/\s+/g, " ").trim();
  return { ok: text === p.equals, actual: JSON.stringify(text) };
}

// ---------------------------------------------------------------- a person's hands (no engine code)

function setNative(el: Element, value: string): void {
  let proto: object | null = Object.getPrototypeOf(el);
  while (proto) {
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    if (d?.set) return d.set.call(el, value);
    proto = Object.getPrototypeOf(proto);
  }
  throw new Error("no value setter");
}

function one(doc: Document, loc: string): HTMLElement {
  const els = query(doc, loc);
  if (els.length !== 1) throw new Error(`by-hand step: ${els.length} elements match ${loc}`);
  return els[0] as HTMLElement;
}

/** Keyboard typing at the end of the field: keydown, beforeinput, the character, input, keyup; change and blur at the end. */
function typeInto(w: Win, el: HTMLInputElement, text: string): void {
  const before = el.value;
  el.focus();
  for (const ch of text) {
    if (el.dispatchEvent(new w.KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }) as unknown as Event)) {
      const full = el.maxLength > 0 && el.value.length >= el.maxLength;
      if (!full && el.dispatchEvent(new w.InputEvent("beforeinput", { data: ch, inputType: "insertText", bubbles: true, cancelable: true }) as unknown as Event)) {
        setNative(el, el.value + ch);
        el.dispatchEvent(new w.InputEvent("input", { data: ch, inputType: "insertText", bubbles: true }) as unknown as Event);
      }
    }
    el.dispatchEvent(new w.KeyboardEvent("keyup", { key: ch, bubbles: true }) as unknown as Event);
  }
  if (el.value !== before) el.dispatchEvent(new w.Event("change", { bubbles: true }) as unknown as Event);
  el.blur();
}

async function byHand(w: Win, steps: HandStep[]): Promise<void> {
  const doc = w.document as unknown as Document;
  for (const s of steps) {
    if ("type" in s) typeInto(w, one(doc, s.type) as HTMLInputElement, s.text);
    else if ("click" in s) one(doc, s.click).click();
    else if ("pick" in s) {
      const el = one(doc, s.pick);
      el.focus();
      setNative(el, s.value);
      el.dispatchEvent(new w.Event("input", { bubbles: true }) as unknown as Event);
      el.dispatchEvent(new w.Event("change", { bubbles: true }) as unknown as Event);
      el.blur();
    } else {
      const sel = one(doc, s.choose) as HTMLSelectElement;
      const opt = Array.from(sel.options).find((o) => (o.textContent ?? "").replace(/\s+/g, " ").trim() === s.option);
      if (!opt) throw new Error(`by-hand step: no option "${s.option}" in ${s.choose}`);
      sel.focus();
      opt.selected = true;
      sel.dispatchEvent(new w.Event("input", { bubbles: true }) as unknown as Event);
      sel.dispatchEvent(new w.Event("change", { bubbles: true }) as unknown as Event);
      sel.blur();
    }
    await settle(w);
  }
}

// ---------------------------------------------------------------- scoring

// Case-sensitive on purpose: a name-attribute fallback such as "telefon" is not the label "Telefon".
const normLabel = (s: string): string => s.replace(/\s+/g, " ").trim().replace(/^\*\s*/, "").replace(/[\s*:]+$/, "");
const urlFor = (slug: string): string => `https://${slug}.corpus.example/form`;

function failingProbes(doc: Document, f: ExpectedField): string[] {
  return (f.probes ?? [])
    .map((p) => ({ p, r: probeHolds(doc, p) }))
    .filter((x) => !x.r.ok)
    .map((x) => `${x.p.at} ${x.p.attr !== undefined ? `[${x.p.attr}]` : `.${x.p.prop}`} is ${x.r.actual}, want ${JSON.stringify(x.p.equals)}`);
}

/** Checks the fixture itself in this environment: probes fail on the untouched page and pass after the by-hand fill. */
export async function checkFixture(fx: Fixture): Promise<string[]> {
  const problems: string[] = [];
  const w = await open(fx.html, urlFor(fx.slug));
  const doc = w.document as unknown as Document;
  try {
    const owner = new Map<Element, string>();
    for (const f of fx.expect.fields) {
      const els = locate(doc, f.locator);
      if (!els.length) problems.push(`${f.key}: locator finds nothing`);
      for (const el of els) {
        if (owner.has(el)) problems.push(`${f.key}: shares an element with ${owner.get(el)}`);
        owner.set(el, f.key);
      }
      if (f.value !== undefined && failingProbes(doc, f).length === 0) problems.push(`${f.key}: probes already hold on the untouched page`);
    }
    await byHand(w, fx.expect.byHand);
    for (const f of fx.expect.fields) {
      if (f.value === undefined) continue;
      for (const why of failingProbes(doc, f)) problems.push(`${f.key}: after the by-hand fill ${why}`);
    }
  } catch (e) {
    problems.push(String(e));
  } finally {
    await closeWin(w);
  }
  return problems;
}

const empty = (fx: Fixture): FixtureResult => ({
  slug: fx.slug, title: fx.expect.title, measurable: false, expected: fx.expect.fields.length, engineFields: 0, detected: 0,
  labels: 0, shapes: 0, values: fx.expect.fields.filter((f) => f.value !== undefined).length, filled: 0, claimed: 0, falseClaims: 0, notes: [],
});

export async function runFixture(fx: Fixture, caps: Record<Capability, boolean>): Promise<FixtureResult> {
  const res = empty(fx);
  const missing = (fx.expect.requires ?? []).filter((c) => !caps[c]);
  if (missing.length) return { ...res, reason: `this environment (happy-dom) has no ${missing.join(", ")}` };
  const selfCheck = await checkFixture(fx);
  if (selfCheck.length) return { ...res, reason: `the by-hand fill does not satisfy the probes here: ${selfCheck[0]}` };
  res.measurable = true;

  const w = await open(fx.html, urlFor(fx.slug));
  const doc = w.document as unknown as Document;
  try {
    const fields = fx.expect.fields;
    const steps: FormStep[] = fx.expect.steps ?? [{ fields: fields.map((f) => f.key) }];
    const stepOf = new Map<string, number>();
    steps.forEach((st, k) => st.fields.forEach((key) => stepOf.set(key, k)));
    const matched: (FieldStructure | undefined)[] = fields.map(() => undefined);
    const matchedAt: (number | undefined)[] = fields.map(() => undefined);
    const many = steps.length > 1;

    for (let k = 0; k < steps.length; k++) {
      const st = steps[k] as FormStep;
      const at = many ? ` (step ${k + 1})` : "";
      if (st.do?.length) await byHand(w, st.do);
      // Each step is read as it shows: hidden parts of a form are not the engine's to fill until they appear.
      const structure = await extractForm(doc, urlFor(fx.slug));
      const sets = fields.map((f) => new Set(locate(doc, f.locator)));
      const fresh: number[] = [];
      for (const ef of structure.fields) {
        const els = elementsForFieldId(doc, ef.fieldId);
        const i = sets.findIndex((s) => els.some((el) => s.has(el)));
        if (i >= 0 && (matchedAt[i] ?? k) < k) continue; // read again on a later step: the same field, counted once
        res.engineFields++;
        const f = fields[i];
        if (i < 0 || !f) res.notes.push(`extra${at}: engine field "${ef.fieldId}" ("${ef.label}") is not a field a person would list`);
        else if (matched[i]) res.notes.push(`extra${at}: engine field "${ef.fieldId}" ("${ef.label}") is a second piece of ${f.key}`);
        else if ((stepOf.get(f.key) ?? 0) > k) res.notes.push(`extra${at}: engine field "${ef.fieldId}" is ${f.key}, read while its step was still hidden`);
        else {
          matched[i] = ef;
          matchedAt[i] = k;
          fresh.push(i);
        }
      }

      const values: FormValues = {};
      for (const i of fresh) {
        const f = fields[i] as ExpectedField;
        const ef = matched[i] as FieldStructure;
        res.detected++;
        if (normLabel(ef.label) === normLabel(f.label)) res.labels++;
        else res.notes.push(`label: ${f.key} is "${ef.label}", want "${f.label}"`);
        const want = f.options ?? 0;
        const got = ef.options?.length ?? 0;
        if (ef.kind === f.kind && ef.required === f.required && got === want) res.shapes++;
        else res.notes.push(`shape: ${f.key} is ${ef.kind}/${ef.required ? "required" : "optional"}/${got} options, want ${f.kind}/${f.required ? "required" : "optional"}/${want} options`);
        if (f.value !== undefined) values[ef.fieldId] = f.value;
      }

      const out = writeValues(doc, structure, values);
      await settle(w);
      res.claimed += out.written.length;
      for (const i of fresh) {
        const f = fields[i] as ExpectedField;
        if (f.value === undefined) continue;
        const ef = matched[i] as FieldStructure;
        const why = failingProbes(doc, f);
        if (!why.length) res.filled++;
        else if (out.written.includes(ef.fieldId)) {
          res.falseClaims++;
          res.notes.push(`FALSE CLAIM: ${f.key} reported written, but ${why[0]}`);
        } else res.notes.push(`not filled: ${f.key} (engine reported it failed)`);
      }
    }

    fields.forEach((f, i) => {
      if (matched[i]) return;
      res.notes.push(`missed: ${f.key} ("${f.label}", ${f.kind})${many ? ` in step ${(stepOf.get(f.key) ?? 0) + 1}` : ""}`);
      if (f.value !== undefined) res.notes.push(`not filled: ${f.key} (not detected)`);
    });
  } finally {
    await closeWin(w);
  }
  return res;
}

export async function runCorpus(corpus = loadCorpus()): Promise<CorpusResult> {
  const caps = await probeCapabilities();
  const fixtures: FixtureResult[] = [];
  for (const fx of corpus) fixtures.push(await runFixture(fx, caps));
  const sum = (k: keyof CorpusResult["totals"]): number => fixtures.filter((f) => f.measurable).reduce((n, f) => n + f[k], 0);
  return {
    fixtures,
    totals: {
      expected: sum("expected"), engineFields: sum("engineFields"), detected: sum("detected"), labels: sum("labels"),
      shapes: sum("shapes"), values: sum("values"), filled: sum("filled"), claimed: sum("claimed"), falseClaims: sum("falseClaims"),
    },
  };
}

// ---------------------------------------------------------------- metrics, table, baseline

type Counts = CorpusResult["totals"];
export interface Metrics {
  recall: number;
  precision: number;
  labels: number;
  shape: number;
  fill: number;
  falseClaims: number;
}
const rate = (n: number, d: number): number => (d ? n / d : 1);
export function metrics(c: Counts): Metrics {
  return {
    recall: rate(c.detected, c.expected),
    precision: rate(c.detected, c.engineFields),
    labels: rate(c.labels, c.expected),
    shape: rate(c.shapes, c.expected),
    fill: rate(c.filled, c.values),
    falseClaims: c.falseClaims,
  };
}

const frac = (n: number, d: number): string => (d ? `${n}/${d} ${Math.round((100 * n) / d)}%` : "-");
function row(name: string, c: Counts): string[] {
  return [name, frac(c.detected, c.expected), frac(c.detected, c.engineFields), frac(c.labels, c.expected), frac(c.shapes, c.expected), frac(c.filled, c.values), `${c.falseClaims} of ${c.claimed}`];
}

export function formatTable(r: CorpusResult, details = true): string {
  const measured = r.fixtures.filter((f) => f.measurable);
  const head = ["fixture", "recall", "precision", "labels", "shape", "fill", "FALSE CLAIMS"];
  const rows = [head, ...measured.map((f) => row(f.slug, f)), row("TOTAL", r.totals)];
  const widths = head.map((_, i) => Math.max(...rows.map((x) => (x[i] as string).length)));
  const line = (x: string[]): string => x.map((c, i) => (i === 0 ? c.padEnd(widths[i] as number) : c.padStart(widths[i] as number))).join("  ");
  const out = [
    `Form benchmark: ${measured.length} of ${r.fixtures.length} fixtures measurable here (happy-dom, page scripts on)`,
    "recall = listed fields the engine found; precision = engine fields that are listed fields; labels, shape (kind, required, options) over listed fields;",
    "fill = values the DOM probes confirm; FALSE CLAIMS = values writeValues reported written that the probes refute, of all it reported written.",
    "",
    line(head),
    ...rows.slice(1, -1).map(line),
    widths.map((n) => "-".repeat(n)).join("  "),
    line(rows[rows.length - 1] as string[]),
  ];
  const skipped = r.fixtures.filter((f) => !f.measurable);
  if (skipped.length) out.push("", "Not measurable here (left out of the totals):", ...skipped.map((f) => `  ${f.slug}: ${f.reason}`));
  if (details) {
    out.push("", "Details:");
    for (const f of measured) if (f.notes.length) out.push(`  ${f.slug}`, ...f.notes.map((n) => `    ${n}`));
  }
  return out.join("\n");
}

export interface Baseline {
  note: string;
  totals: Counts;
  metrics: Metrics;
  fixtures: Record<string, { measurable: boolean } & Partial<Counts>>;
}

export function toBaseline(r: CorpusResult): Baseline {
  const fixtures: Baseline["fixtures"] = {};
  for (const f of r.fixtures) {
    const { slug, title: _t, measurable, reason: _r, notes: _n, ...counts } = f;
    fixtures[slug] = measurable ? { measurable, ...counts } : { measurable };
  }
  const m = metrics(r.totals);
  const round = (x: number): number => Math.round(x * 10000) / 10000;
  return {
    note: "Written only by `npm run bench:forms:update`. corpus.test.ts fails when a total falls below these numbers.",
    totals: r.totals,
    metrics: { recall: round(m.recall), precision: round(m.precision), labels: round(m.labels), shape: round(m.shape), fill: round(m.fill), falseClaims: m.falseClaims },
    fixtures,
  };
}

export function readBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}
export function writeBaseline(r: CorpusResult): void {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(r), null, 2)}\n`);
}

/** Why the run is worse than the baseline, as sentences. Empty when every total holds. */
export function compareToBaseline(r: CorpusResult, b: Baseline): string[] {
  const out: string[] = [];
  const now = metrics(r.totals);
  const was = metrics(b.totals);
  for (const k of ["recall", "precision", "labels", "shape", "fill"] as const) {
    if (now[k] < was[k] - 1e-9) out.push(`${k} fell from ${was[k].toFixed(4)} to ${now[k].toFixed(4)}`);
  }
  if (now.falseClaims > was.falseClaims) out.push(`false claims rose from ${was.falseClaims} to ${now.falseClaims}`);
  const slugs = new Set(r.fixtures.map((f) => f.slug));
  for (const [slug, f] of Object.entries(b.fixtures)) {
    const cur = r.fixtures.find((x) => x.slug === slug);
    if (!cur) out.push(`fixture ${slug} is gone`);
    else if (cur.measurable !== f.measurable) out.push(`fixture ${slug} is ${cur.measurable ? "now" : "no longer"} measurable`);
  }
  for (const s of slugs) if (!(s in b.fixtures)) out.push(`fixture ${s} is not in the baseline`);
  return out;
}
