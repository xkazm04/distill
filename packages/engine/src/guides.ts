// The guide library: wizards for official forms written against the authority's own instructions (guides/README.md).
// Three things live here, all pure:
// - parseGuide: the door a guide file passes before anything uses it (at load time in the apps, and in
//   `npm run check-guides` for every file in the library). A guide is untrusted input like model output: closed
//   vocabulary, no HTML, field ids that exist, and its steps must come through parseWizard unchanged.
// - matchGuide: which guide (if any) fits the form on screen, and which of its fields are still the same.
// - guideWizard / mergeWizards: the steps the person sees, the guide's own for the unchanged fields and the normal
//   path's (model, else the basic steps) for new or changed fields only.
// Matching is local: the caller holds the whole library, nothing about the form is sent anywhere to look a guide up.
import type {
  FieldKind, FieldStructure, FormGuide, FormStructure, GuideField, GuideQuote, GuideStep, GuideWizard, Wizard, WizardStep,
} from "./types.js";
import { cleanText, hasScriptUrl, isObj, MAX_TEXT } from "./sanitize.js";
import { parseWizard } from "./wizard.js";

/** The reader languages every guide carries. */
export const GUIDE_LANGS = ["en", "uk"] as const;
export type GuideLang = (typeof GUIDE_LANGS)[number];

/**
 * The least overlap at which a guide is still used for a form that changed: matching fields / all fields of both
 * versions (Jaccard). 0.5 means at least half of everything on either version is the same field. Below it the form
 * is more new than checked, and the guide's notes and step grouping cannot be trusted to fit.
 */
export const GUIDE_MIN_OVERLAP = 0.5;

/** The address every PDF form carries (packages/pdf PDF_URL); a PDF guide is known by its title instead. */
const PDF_URL = "pdf://local/";

const MAX_QUOTE = 600;
const MAX_NOTE = 600;
const FIELD_KINDS: readonly FieldKind[] = ["text", "textarea", "email", "tel", "number", "date", "select", "radio", "checkbox", "file", "other"];
const TOP_KEYS = new Set(["guideVersion", "id", "status", "demo", "authority", "formName", "formLang", "officialFormUrl", "instructionsUrl", "draftedOn", "reviewer", "reviewedOn", "match", "wizards", "reviewNotes"]);
const STEP_KEYS = new Set(["stepId", "fieldIds", "question", "explanation", "example", "expectedFormat", "official"]);

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** True for an https address with a host and no credentials. */
export function isHttps(s: unknown): s is string {
  if (typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** An address reduced to what identifies a form: lower-case origin + path, without a trailing slash. "" when unparsable. */
export function formAddress(url: string): string {
  try {
    const u = new URL(url);
    if (u.origin === "null") return "";
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, "") : u.pathname;
    return `${u.origin.toLowerCase()}${path}`;
  } catch {
    return "";
  }
}

/** A label reduced to what two readings of one form share: case, spacing, punctuation and "required" stars go. */
export function sameLabel(label: string): string {
  return label.normalize("NFKC").toLowerCase().replace(/[*:.,;!?()[\]{}"'`_\-–—/\\|]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The FormStructure a guide was written for (no address, nothing required): what its steps are checked against. */
export function guideStructure(g: Pick<FormGuide, "match" | "formLang" | "formName">): FormStructure {
  return {
    fingerprint: g.match.fingerprints[0] ?? "",
    url: "",
    lang: g.formLang,
    title: g.formName.cs,
    fields: g.match.fields.map((f): FieldStructure => ({ fieldId: f.fieldId, kind: f.kind, label: f.label, required: false })),
  };
}

export interface GuideCheck {
  /** The guide, when it passed; null when anything is wrong (a guide is used whole or not at all). */
  guide: FormGuide | null;
  /** Every reason it did not pass, in plain words with the JSON path. Empty when it passed. */
  problems: string[];
}

/**
 * The door for a guide file. Strict: one problem and the guide is not used. `id`, when given, is the id the file's
 * place in the library implies ("cz/oznameni-zmen"), and must be the guide's own.
 */
export function parseGuide(raw: unknown, opts: { id?: string } = {}): GuideCheck {
  const problems: string[] = [];
  const bad = (m: string) => { problems.push(m); };
  if (!isObj(raw)) return { guide: null, problems: ["the guide is not a JSON object"] };
  if (hasScriptUrl(raw)) bad("a script address (javascript:, vbscript: or data:text/html) appears somewhere in the guide");
  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) bad(`unknown key "${k}"`);

  /** Plain text that the door would keep exactly as written: no tags, no entities, no doubled spaces, within `cap`. */
  const text = (path: string, v: unknown, cap = MAX_TEXT, empty = false): string => {
    if (typeof v !== "string") { bad(`${path} must be text`); return ""; }
    if (!v && !empty) { bad(`${path} is empty`); return ""; }
    const clean = cleanText(v, cap) ?? "";
    if (clean !== v) bad(`${path} would not pass the door as written (HTML, an entity, extra spaces, a control character, or longer than ${cap}): ${JSON.stringify(v.slice(0, 80))}`);
    return v;
  };
  const lang = (path: string, v: unknown): void => {
    if (typeof v !== "string" || !/^[a-z]{2,3}$/.test(v)) bad(`${path} must be a language tag like "cs"`);
  };
  const https = (path: string, v: unknown): void => {
    if (!isHttps(v)) bad(`${path} must be an https address`);
  };

  if (raw.guideVersion !== 1) bad("guideVersion must be 1");
  if (typeof raw.id !== "string" || !/^[a-z]{2}\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.id)) bad('id must look like "cz/form-name"');
  else if (opts.id !== undefined && raw.id !== opts.id) bad(`id is "${raw.id}" but the file is ${opts.id}.json`);
  const status = raw.status;
  if (status !== "draft" && status !== "reviewed") bad('status must be "draft" or "reviewed"');
  const demo = raw.demo;
  if (demo !== undefined && typeof demo !== "boolean") bad("demo must be true or false");
  if (demo === true && status !== "draft") bad("a demo guide is never reviewed: its form is made up, so there are no official instructions to check it against");

  const authority = isObj(raw.authority) ? raw.authority : (bad("authority is missing"), {} as Record<string, unknown>);
  text("authority.name", authority.name);
  text("authority.nameEn", authority.nameEn);
  const formName = isObj(raw.formName) ? raw.formName : (bad("formName is missing"), {} as Record<string, unknown>);
  for (const k of ["cs", "en", "uk"]) text(`formName.${k}`, formName[k]);
  lang("formLang", raw.formLang);
  https("officialFormUrl", raw.officialFormUrl);
  https("instructionsUrl", raw.instructionsUrl);
  if (!isIsoDate(raw.draftedOn)) bad("draftedOn must be a date, YYYY-MM-DD");

  if (status === "reviewed") {
    text("reviewer", raw.reviewer, 120);
    if (!isIsoDate(raw.reviewedOn)) bad("a reviewed guide needs reviewedOn, a date YYYY-MM-DD");
    else if (isIsoDate(raw.draftedOn) && raw.reviewedOn < raw.draftedOn) bad("reviewedOn is before draftedOn");
    if (Array.isArray(raw.reviewNotes) && raw.reviewNotes.length) bad("a reviewed guide has no open reviewNotes: resolve them or keep the guide a draft");
  } else if (status === "draft") {
    if (raw.reviewer !== undefined || raw.reviewedOn !== undefined) bad("a draft names no reviewer and no review date: only the commit that marks it reviewed adds them");
  }
  if (raw.reviewNotes !== undefined) {
    if (!Array.isArray(raw.reviewNotes)) bad("reviewNotes must be a list");
    else raw.reviewNotes.forEach((n, i) => text(`reviewNotes[${i}]`, n, 1000));
  }

  // What it matches.
  const match = isObj(raw.match) ? raw.match : (bad("match is missing"), {} as Record<string, unknown>);
  const format = match.format;
  if (format !== "html" && format !== "pdf") bad('match.format must be "html" or "pdf"');
  if (!Array.isArray(match.fingerprints) || !match.fingerprints.length) bad("match.fingerprints must list at least one fingerprint");
  else match.fingerprints.forEach((f, i) => { if (typeof f !== "string" || !/^[0-9a-f]{64}$/.test(f)) bad(`match.fingerprints[${i}] must be a sha-256 hex fingerprint`); });
  if (format === "html") {
    if (match.titles !== undefined) bad("match.titles is for PDF guides only");
    if (!Array.isArray(match.urls) || !match.urls.length) bad("an html guide lists its addresses in match.urls");
    else match.urls.forEach((u, i) => {
      if (demo === true) {
        if (typeof u !== "string" || !/^\/[\w./-]+$/.test(u)) bad(`match.urls[${i}] of a demo guide must be a path like "/demo/form.html"`);
      } else if (!isHttps(u)) bad(`match.urls[${i}] must be an https address`);
      else if (/[?#]/.test(u)) bad(`match.urls[${i}] must be origin + path only, with no query or fragment`);
    });
  }
  if (format === "pdf") {
    if (match.urls !== undefined) bad("match.urls is for web forms only: a PDF has no address");
    if (!Array.isArray(match.titles) || !match.titles.length) bad("a PDF guide lists the document's title in match.titles");
    else match.titles.forEach((t, i) => text(`match.titles[${i}]`, t));
  }
  if (match.reader !== undefined) {
    if (typeof match.reader !== "string" || !/^(html|pdf)\/[1-9]\d*$/.test(match.reader)) bad('match.reader must look like "pdf/2" or "html/1"');
    else if ((format === "html" || format === "pdf") && !match.reader.startsWith(`${format}/`)) bad(`match.reader "${match.reader}" is not a reader of ${String(format)} forms`);
  }
  if (match.source !== undefined && (typeof match.source !== "string" || !/^[0-9a-f]{64}$/.test(match.source))) bad("match.source must be a sha-256 hex digest");
  const fieldIds = new Set<string>();
  if (!Array.isArray(match.fields) || !match.fields.length) bad("match.fields must list the form's fields");
  else match.fields.forEach((f, i) => {
    if (!isObj(f)) { bad(`match.fields[${i}] is not an object`); return; }
    const id = text(`match.fields[${i}].fieldId`, f.fieldId, 200);
    if (id && fieldIds.has(id)) bad(`match.fields[${i}].fieldId "${id}" appears twice`);
    if (id) fieldIds.add(id);
    if (!FIELD_KINDS.includes(f.kind as FieldKind)) bad(`match.fields[${i}].kind "${String(f.kind)}" is not a field kind`);
    text(`match.fields[${i}].label`, f.label, MAX_TEXT, true);
    for (const k of Object.keys(f)) if (k !== "fieldId" && k !== "kind" && k !== "label") bad(`match.fields[${i}] has an unknown key "${k}"`);
  });

  // The wizards, one per reader language, parallel to each other.
  const wizards = isObj(raw.wizards) ? raw.wizards : (bad("wizards is missing"), {} as Record<string, unknown>);
  for (const k of Object.keys(wizards)) if (!(GUIDE_LANGS as readonly string[]).includes(k)) bad(`wizards.${k}: the library carries ${GUIDE_LANGS.join(" and ")} only`);
  const shapes: string[] = [];
  for (const l of GUIDE_LANGS) {
    const w = wizards[l];
    const at = `wizards.${l}`;
    if (!isObj(w)) { bad(`${at} is missing: every guide has both ${GUIDE_LANGS.join(" and ")}`); continue; }
    if (!Array.isArray(w.notes)) bad(`${at}.notes must be a list (it may be empty)`);
    else w.notes.forEach((n, i) => text(`${at}.notes[${i}]`, n, MAX_NOTE));
    if (!Array.isArray(w.steps) || !w.steps.length) { bad(`${at}.steps must list the steps`); continue; }
    const seen = new Set<string>();
    const covered = new Set<string>();
    w.steps.forEach((s, i) => {
      const sp = `${at}.steps[${i}]`;
      if (!isObj(s)) { bad(`${sp} is not an object`); return; }
      for (const k of Object.keys(s)) if (!STEP_KEYS.has(k)) bad(`${sp} has an unknown key "${k}"`);
      const id = text(`${sp}.stepId`, s.stepId, 80);
      if (id && seen.has(id)) bad(`${sp}.stepId "${id}" appears twice`);
      seen.add(id);
      if (!Array.isArray(s.fieldIds) || !s.fieldIds.length) bad(`${sp}.fieldIds must name at least one field`);
      else s.fieldIds.forEach((f) => {
        if (typeof f !== "string" || !fieldIds.has(f)) bad(`${sp}.fieldIds: "${String(f)}" is not a field in match.fields`);
        else if (covered.has(f)) bad(`${sp}.fieldIds: "${f}" is already in an earlier step`);
        else covered.add(f);
      });
      text(`${sp}.question`, s.question);
      text(`${sp}.explanation`, s.explanation);
      if (s.example !== undefined) text(`${sp}.example`, s.example);
      if (s.expectedFormat !== undefined) text(`${sp}.expectedFormat`, s.expectedFormat);
      if (s.official !== undefined) {
        if (!isObj(s.official)) bad(`${sp}.official must be an object`);
        else {
          text(`${sp}.official.text`, s.official.text, MAX_QUOTE);
          lang(`${sp}.official.lang`, s.official.lang);
          if (s.official.url !== undefined) https(`${sp}.official.url`, s.official.url);
          for (const k of Object.keys(s.official)) if (k !== "text" && k !== "lang" && k !== "url") bad(`${sp}.official has an unknown key "${k}"`);
        }
      }
    });
    for (const f of fieldIds) if (!covered.has(f)) bad(`${at}: no step covers the field "${f}"`);
    shapes.push(w.steps.map((s) => (isObj(s) ? `${String(s.stepId)}=${Array.isArray(s.fieldIds) ? s.fieldIds.join(",") : ""}` : "")).join(" "));
  }
  if (shapes.length === GUIDE_LANGS.length && new Set(shapes).size > 1) bad("the wizards differ in their steps: every language has the same step ids over the same fields, in the same order");

  if (problems.length) return { guide: null, problems };
  const guide = raw as unknown as FormGuide;

  // The same door as model output: every step must come through parseWizard as written, in the form's order.
  const structure = guideStructure(guide);
  for (const l of GUIDE_LANGS) {
    const steps = guide.wizards[l].steps;
    const out = parseWizard(steps.map(plainStep), structure, l).steps;
    const want = steps.map(plainStep);
    if (JSON.stringify(out) !== JSON.stringify(want)) {
      const lost = want.filter((s) => !out.some((o) => o.stepId === s.stepId)).map((s) => s.stepId);
      problems.push(`wizards.${l}: the wizard door changed the steps (${lost.length ? `dropped ${lost.join(", ")}` : "steps are not in the form's field order"})`);
    }
  }
  return problems.length ? { guide: null, problems } : { guide, problems };
}

/** A guide step as a plain WizardStep: what the wizard door sees. */
function plainStep(s: GuideStep): WizardStep {
  const out: WizardStep = { stepId: s.stepId, fieldIds: [...s.fieldIds], question: s.question, explanation: s.explanation };
  if (s.example !== undefined) out.example = s.example;
  if (s.expectedFormat !== undefined) out.expectedFormat = s.expectedFormat;
  return out;
}

/** Every guide of a raw library that passes the door. The rest are left out, each with its reasons. */
export function parseLibrary(raw: unknown): { guides: FormGuide[]; rejected: { id: string; problems: string[] }[] } {
  const guides: FormGuide[] = [];
  const rejected: { id: string; problems: string[] }[] = [];
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.guides) ? raw.guides : [];
  list.forEach((g, i) => {
    const r = parseGuide(g);
    if (r.guide) guides.push(r.guide);
    else rejected.push({ id: isObj(g) && typeof g.id === "string" ? g.id : `#${i}`, problems: r.problems });
  });
  return { guides, rejected };
}

export interface GuideMatchResult {
  guide: FormGuide;
  /** True when the form on screen has exactly the guide's fields (by fingerprint, or field by field). */
  exact: boolean;
  /** Fields both versions share: same id, same kind, the same label. */
  same: string[];
  /** Fields of the form on screen that are new, or changed since the guide was written. */
  changed: string[];
  /** How many of the guide's fields are no longer on the form. */
  removed: number;
  /** same / (guide fields + form fields - same). */
  overlap: number;
}

/** True when the form on screen is the guide's form (before its fields are compared). */
function sameForm(g: FormGuide, s: FormStructure): boolean {
  if (g.match.fingerprints.includes(s.fingerprint)) return true;
  if (g.match.format === "pdf") {
    if (s.url !== PDF_URL) return false;
    const t = sameLabel(s.title);
    return !!t && (g.match.titles ?? []).some((x) => sameLabel(x) === t);
  }
  if (s.url === PDF_URL) return false;
  const here = formAddress(s.url);
  if (!here) return false;
  return (g.match.urls ?? []).some((u) => {
    if (u.startsWith("/")) {
      if (!g.demo) return false;
      try { return new URL(s.url).pathname.endsWith(u); } catch { return false; }
    }
    return formAddress(u) === here;
  });
}

/**
 * The guide for the form on screen, or null. Only usable guides count: reviewed ones, the demo guide on the demo
 * form, and drafts only when `drafts` is on (a developer's switch). The best match wins: an exact one, then the
 * largest overlap; below GUIDE_MIN_OVERLAP a guide is not used.
 */
export function matchGuide(s: FormStructure, guides: readonly FormGuide[], opts: { drafts?: boolean } = {}): GuideMatchResult | null {
  let best: GuideMatchResult | null = null;
  for (const g of guides) {
    if (!(g.status === "reviewed" || g.demo === true || opts.drafts === true)) continue;
    if (!sameForm(g, s) || !s.fields.length) continue;
    const theirs = new Map<string, GuideField>(g.match.fields.map((f) => [f.fieldId, f]));
    const same: string[] = [];
    const changed: string[] = [];
    for (const f of s.fields) {
      const t = theirs.get(f.fieldId);
      if (t && t.kind === f.kind && sameLabel(t.label) === sameLabel(f.label)) same.push(f.fieldId);
      else changed.push(f.fieldId);
    }
    const overlap = same.length / (g.match.fields.length + s.fields.length - same.length);
    const exact = g.match.fingerprints.includes(s.fingerprint) || (changed.length === 0 && same.length === g.match.fields.length);
    if (!exact && overlap < GUIDE_MIN_OVERLAP) continue;
    const r: GuideMatchResult = { guide: g, exact, same, changed, removed: g.match.fields.length - same.length, overlap };
    if (!best || (r.exact && !best.exact) || (r.exact === best.exact && r.overlap > best.overlap)) best = r;
  }
  return best;
}

/** The guide's language for a reader, or null when the library has none for them. */
export function guideLang(readerLang: string): GuideLang | null {
  const l = readerLang.toLowerCase().split("-")[0] ?? "";
  return (GUIDE_LANGS as readonly string[]).includes(l) ? (l as GuideLang) : null;
}

export interface GuideSteps {
  /** The guide's steps for the fields that did not change, through the wizard door. */
  wizard: Wizard;
  /** stepId -> the official words the step rests on. */
  quotes: Record<string, GuideQuote>;
  /** The guide's notes about the whole form, in the reader's language. */
  notes: string[];
  /** Fields of the form on screen no guide step covers (new or changed): the normal path makes their steps. */
  rest: string[];
}

/**
 * The steps a matched guide gives the reader. A guide step is kept only when every field it covers is unchanged; a
 * step one of whose fields changed is left to the normal path whole. Null when the guide has no text in the
 * reader's language.
 */
export function guideWizard(m: GuideMatchResult, s: FormStructure, readerLang: string): GuideSteps | null {
  const l = guideLang(readerLang);
  if (!l) return null;
  const text: GuideWizard = m.guide.wizards[l];
  const same = new Set(m.same);
  const keep = text.steps.filter((st) => st.fieldIds.every((id) => same.has(id)));
  const covered = new Set(keep.flatMap((st) => st.fieldIds));
  const sub: FormStructure = { ...s, fields: s.fields.filter((f) => covered.has(f.fieldId)) };
  const wizard = parseWizard(keep.map(plainStep), sub, l);
  wizard.fingerprint = s.fingerprint;
  const quotes: Record<string, GuideQuote> = {};
  for (const st of keep) {
    if (!st.official || !wizard.steps.some((w) => w.stepId === st.stepId)) continue;
    const q = cleanText(st.official.text, MAX_QUOTE);
    if (!q) continue;
    const quote: GuideQuote = { text: q, lang: st.official.lang };
    if (st.official.url && isHttps(st.official.url)) quote.url = st.official.url;
    quotes[st.stepId] = quote;
  }
  const kept = new Set(wizard.steps.flatMap((st) => st.fieldIds));
  const notes = text.notes.map((n) => cleanText(n, MAX_NOTE)).filter((n): n is string => !!n);
  return { wizard, quotes, notes, rest: s.fields.filter((f) => !kept.has(f.fieldId)).map((f) => f.fieldId) };
}

/** The form on screen narrowed to some of its fields: what the normal path builds steps for when a guide covers the rest. */
export function narrowStructure(s: FormStructure, fieldIds: readonly string[]): FormStructure {
  const want = new Set(fieldIds);
  return { ...s, fields: s.fields.filter((f) => want.has(f.fieldId)) };
}

/**
 * One wizard from the guide's steps and the normal path's steps for the rest, in the form's field order. A step id
 * the guide already uses is renamed. Returns the ids of the steps that came from the guide.
 */
export function mergeWizards(s: FormStructure, guide: Wizard, rest: Wizard): { wizard: Wizard; fromGuide: string[] } {
  const order = new Map(s.fields.map((f, i) => [f.fieldId, i]));
  const used = new Set(guide.steps.map((st) => st.stepId));
  const taken = new Set(guide.steps.flatMap((st) => st.fieldIds));
  const extra: WizardStep[] = [];
  for (const st of rest.steps) {
    const fieldIds = st.fieldIds.filter((id) => !taken.has(id) && order.has(id));
    if (!fieldIds.length) continue;
    let stepId = st.stepId;
    for (let n = 2; used.has(stepId); n++) stepId = `${st.stepId}_${n}`;
    used.add(stepId);
    fieldIds.forEach((id) => taken.add(id));
    extra.push({ ...st, stepId, fieldIds });
  }
  const first = (st: WizardStep) => Math.min(...st.fieldIds.map((id) => order.get(id) ?? 0));
  const steps = [...guide.steps, ...extra].sort((a, b) => first(a) - first(b));
  return { wizard: { fingerprint: s.fingerprint, readerLang: guide.readerLang, steps }, fromGuide: guide.steps.map((st) => st.stepId) };
}
