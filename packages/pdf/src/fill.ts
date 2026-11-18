// Writing answers into a copy of the PDF, and confirming them. The person's file is never changed: every write starts
// again from the original bytes and produces new ones. A field counts as written only when a fresh parse of the new
// bytes holds the intended value and a visible appearance for it; anything else is failed.
//
// Text is drawn with an embedded subset of Noto Sans (SIL OFL 1.1, fonts/OFL.txt): the 14 standard PDF fonts cannot
// encode several Czech letters (ě, ř, ů, ť, ď, ň) or Cyrillic, and would draw garbage. A character the embedded font
// does not have fails its field instead of being drawn wrong.
import fontkit from "@cantoo/fontkit";
import {
  PDFAcroChoice, PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFOptionList,
  PDFRadioGroup, PDFStream, PDFString, PDFTextField, defaultDropdownAppearanceProvider, type PDFFont, type PDFField,
} from "@cantoo/pdf-lib";
import type { FormValues } from "@distill/engine";
import { readField } from "./fields.js";
import type { DatePart, PdfBinding, PdfReading } from "./types.js";

/** The font bytes, or a way to get them when the first text is written (the web app fetches them only then). */
export type FontSource = Uint8Array | (() => Promise<Uint8Array>);

interface GlyphFont { hasGlyphForCodePoint(cp: number): boolean }

class WriteError extends Error {}

// ---------------------------------------------------------------- values

/** D.M.YYYY, D/M/YYYY, D-M-YYYY or YYYY-MM-DD to day, month and year. */
export function parseDate(v: string): Record<DatePart, number> | null {
  const dmy = /^\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})\s*$/.exec(v);
  const iso = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(v);
  let day: number, month: number, year: number;
  if (dmy) [day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year };
}
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** A value as a row of boxes takes it: no spaces, and no "/", "-" or "." when that is what makes it fit. */
function fitChars(value: string, n: number): string {
  const v = value.replace(/\s+/g, "");
  if ([...v].length <= n) return v;
  const bare = v.replace(/[/.\-–]/g, "");
  return [...bare].length <= n ? bare : v;
}

const isTicked = (v: string): boolean => v.trim() !== "" && v.trim().toLowerCase() !== "false";

/** What reading the field back must give for `value` to count as written. */
function expected(b: PdfBinding, value: string, maxLen?: number): string {
  switch (b.via) {
    case "checkbox": return isTicked(value) ? "true" : "";
    case "date": {
      if (!value.trim()) return "";
      const d = parseDate(value);
      return d ? `${d.year}-${pad2(d.month)}-${pad2(d.day)}` : "\u0000invalid";
    }
    case "chars": return fitChars(value, b.names.length);
    case "text": return maxLen && [...value].length > maxLen ? fitChars(value, maxLen) : value;
    default: return value;
  }
}

/** The value of a binding as the wizard shows it, read from a parsed document. Device-only. */
export function readBinding(doc: PDFDocument, b: PdfBinding): string {
  switch (b.via) {
    case "chars": return b.names.map((n) => readField(doc, n)).join("");
    case "date": {
      const got: Partial<Record<DatePart, number>> = {};
      b.names.forEach((n, i) => {
        const v = readField(doc, n).replace(/\D/g, "");
        if (v) got[(b.parts ?? [])[i] as DatePart] = Number(v);
      });
      if (!got.day || !got.month || !got.year) return "";
      const year = got.year < 100 ? 2000 + got.year : got.year;
      return `${year}-${pad2(got.month)}-${pad2(got.day)}`;
    }
    default: return readField(doc, b.names[0] as string);
  }
}

/**
 * The values the PDF holds now, per field of the structure. Empty fields are omitted. DEVICE-ONLY, like the engine's
 * readValues: never put into a cloud-eligible prompt, Firestore or anything the agent reads.
 */
export async function readPdfValues(bytes: Uint8Array, reading: PdfReading): Promise<FormValues> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const out: FormValues = {};
  for (const b of reading.bindings) {
    const v = readBinding(doc, b);
    if (v !== "") out[b.fieldId] = v;
  }
  return out;
}

// ---------------------------------------------------------------- writing

interface Ctx {
  doc: PDFDocument;
  fontBytes: () => Promise<Uint8Array>;
  font?: PDFFont;
  glyphs?: GlyphFont;
}

async function fontFor(ctx: Ctx, text: string): Promise<PDFFont> {
  if (!ctx.font) {
    const bytes = await ctx.fontBytes();
    ctx.doc.registerFontkit(fontkit);
    ctx.font = await ctx.doc.embedFont(bytes, { subset: true });
    ctx.glyphs = fontkit.create(bytes as never) as unknown as GlyphFont;
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (/\s/u.test(ch)) continue;
    if (!ctx.glyphs?.hasGlyphForCodePoint(cp)) throw new WriteError(`no glyph for U+${cp.toString(16).toUpperCase()}`);
  }
  return ctx.font;
}

/** Line height of the embedded font per point of size (Noto Sans: about 1.36). */
const lineFactor = (font: PDFFont): number => font.heightAtSize(1);

interface Fit { multiline: boolean; comb: boolean; cells: number; da: string }

/** The facts of a text field that decide how its text is laid out. */
const fitOf = (field: PDFTextField): Fit => ({
  multiline: field.isMultiline(), comb: field.isCombed(), cells: field.getMaxLength() ?? 1, da: field.acroField.getDefaultAppearance() ?? "",
});

/**
 * A font size at which `text` fits its box as pdf-lib lays it out: the form's own size when it set one (at most 12pt),
 * else 11pt, down to 5pt. One line keeps a quarter of the box free, so descenders (j, ý, ň) stay inside it; several
 * lines use pdf-lib's line height (1.2 x the font's height) and keep the last line's descenders inside too.
 */
function fitSize(fit: Fit, font: PDFFont, text: string, w: number, h: number): number {
  const da = /([\d.]+)\s+Tf/.exec(fit.da);
  const own = da ? Number(da[1]) : 0;
  const start = own > 0 ? Math.min(own, 12) : 11;
  const inner = { w: w - 6, h: h - 4 };
  const lines = (size: number): number => {
    let n = 0;
    for (const para of text.split(/\r\n|\r|\n/)) {
      let line = "";
      n++;
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > inner.w && line) { n++; line = word; } else line = next;
      }
    }
    return n;
  };
  for (let size = start; size >= 5; size -= 0.5) {
    const em = size * lineFactor(font);
    if (fit.multiline) {
      if (lines(size) * 1.2 * em + 0.3 * size <= inner.h) return size;
      continue;
    }
    const widest = fit.comb ? Math.max(0, ...[...text].map((c) => font.widthOfTextAtSize(c, size))) : font.widthOfTextAtSize(text, size);
    const room = fit.comb ? w / Math.max(1, fit.cells) - 1 : inner.w;
    if (em <= 0.75 * h && widest <= room) return size;
  }
  throw new WriteError("too long for the box");
}

async function writeText(ctx: Ctx, name: string, value: string): Promise<void> {
  const field = ctx.doc.getForm().getTextField(name);
  const text = field.isMultiline() ? value : value.replace(/\s*[\r\n]+\s*/g, " ");
  const max = field.getMaxLength();
  const fitted = max && [...text].length > max ? fitChars(text, max) : text;
  if (max && [...fitted].length > max) throw new WriteError("longer than the field allows");
  const font = await fontFor(ctx, fitted);
  const widget = field.acroField.getWidgets()[0];
  const r = widget?.getRectangle() ?? { width: 100, height: 14 };
  field.setText(fitted === "" ? undefined : fitted);
  if (fitted !== "") field.setFontSize(fitSize(fitOf(field), font, fitted, r.width, r.height));
  field.updateAppearances(font);
}

function writeTick(ctx: Ctx, name: string, value: string): void {
  const box = ctx.doc.getForm().getCheckBox(name);
  if (isTicked(value)) box.check(); else box.uncheck();
  // A box with no drawn "on" state shows nothing when ticked: draw both states then.
  if (!box.acroField.getWidgets().every((w) => w.getAppearances()?.normal instanceof PDFDict)) box.defaultUpdateAppearances();
}

/** Radio groups, and same-named tick boxes with different "on" states: the widget whose export value matches. */
function writeChoiceOfOne(ctx: Ctx, name: string, value: string): void {
  const field = ctx.doc.getForm().getField(name);
  if (!(field instanceof PDFRadioGroup || field instanceof PDFCheckBox)) throw new WriteError("not a button");
  const acro = field.acroField;
  const widgets = acro.getWidgets();
  if (!value.trim()) {
    acro.dict.set(PDFName.of("V"), PDFName.of("Off"));
    for (const w of widgets) w.setAppearanceState(PDFName.of("Off"));
    return;
  }
  const opt = acro.dict.lookup(PDFName.of("Opt"));
  let at = -1;
  if (opt instanceof PDFArray && opt.size() === widgets.length) {
    for (let i = 0; i < opt.size(); i++) {
      const o = opt.lookup(i);
      const text = o instanceof PDFString || o instanceof PDFHexString || o instanceof PDFName ? o.decodeText() : "";
      if (text === value) { at = i; break; }
    }
  }
  const on = at >= 0 ? widgets[at]?.getOnValue() : widgets.map((w) => w.getOnValue()).find((n) => n?.decodeText() === value);
  if (!on) throw new WriteError("not one of the options");
  acro.dict.set(PDFName.of("V"), on);
  for (const w of widgets) w.setAppearanceState(w.getOnValue() === on ? on : PDFName.of("Off"));
}

async function writeSelect(ctx: Ctx, name: string, value: string): Promise<void> {
  const field = ctx.doc.getForm().getField(name);
  if (!(field instanceof PDFDropdown || field instanceof PDFOptionList)) throw new WriteError("not a choice");
  const acro = field.acroField as PDFAcroChoice;
  const options = acro.getOptions().map((o) => ({ value: o.value.decodeText(), display: (o.display ?? o.value).decodeText() }));
  const at = options.findIndex((o) => o.value === value);
  const match = options[at];
  if (value && !match) throw new WriteError("not one of the options");
  // /V holds the export value (ISO 32000-1, 12.7.4.4). pdf-lib's setValues checks a value against the shown text
  // instead and refuses an export code that differs from it, so /V and the selected index /I are set here.
  if (value) {
    acro.dict.set(PDFName.of("V"), PDFHexString.fromText(value));
    acro.dict.set(PDFName.of("I"), ctx.doc.context.obj([at]));
  } else {
    acro.dict.delete(PDFName.of("V"));
    acro.dict.delete(PDFName.of("I"));
  }
  const shown = match?.display ?? "";
  const font = await fontFor(ctx, shown);
  if (shown) {
    const r = field.acroField.getWidgets()[0]?.getRectangle() ?? { width: 100, height: 14 };
    const da = field.acroField.getDefaultAppearance() ?? "";
    field.setFontSize(fitSize({ multiline: field instanceof PDFOptionList, comb: false, cells: 1, da }, font, shown, r.width, r.height));
  }
  if (field instanceof PDFDropdown) {
    // The box shows the option's text, which can differ from the value it submits.
    const showing = new Proxy(field, { get: (t, k, r) => (k === "getSelected" ? () => (shown ? [shown] : []) : Reflect.get(t, k, r)) });
    field.updateAppearances(font, (_f, w, fo) => defaultDropdownAppearanceProvider(showing, w, fo));
  } else field.updateAppearances(font);
}

async function writeBinding(ctx: Ctx, b: PdfBinding, value: string): Promise<void> {
  switch (b.via) {
    case "text": return writeText(ctx, b.names[0] as string, value);
    case "chars": {
      const chars = [...fitChars(value, b.names.length)];
      if (chars.length > b.names.length) throw new WriteError("longer than the boxes");
      for (const ch of chars) await fontFor(ctx, ch); // every character checked before any box changes
      for (let i = 0; i < b.names.length; i++) await writeText(ctx, b.names[i] as string, chars[i] ?? "");
      return;
    }
    case "date": {
      const d = value.trim() ? parseDate(value) : null;
      if (value.trim() && !d) throw new WriteError("not a date");
      for (let i = 0; i < b.names.length; i++) {
        const name = b.names[i] as string;
        const part = (b.parts ?? [])[i] as DatePart;
        const short = part === "year" && ctx.doc.getForm().getTextField(name).getMaxLength() === 2;
        await writeText(ctx, name, !d ? "" : part === "year" ? (short ? pad2(d.year % 100) : String(d.year)) : pad2(d[part]));
      }
      return;
    }
    case "checkbox": return writeTick(ctx, b.names[0] as string, value);
    case "radio": return writeChoiceOfOne(ctx, b.names[0] as string, value);
    case "choice": return writeSelect(ctx, b.names[0] as string, value);
  }
}

/** The widgets of these fields all have a normal appearance, and a ticked or chosen button shows its "on" state. */
function shows(doc: PDFDocument, b: PdfBinding): boolean {
  for (const name of b.names) {
    let field: PDFField;
    try { field = doc.getForm().getField(name); } catch { return false; }
    const widgets = field.acroField.getWidgets();
    if (field instanceof PDFTextField || field instanceof PDFDropdown || field instanceof PDFOptionList) {
      if (!widgets.every((w) => { const n = w.getAppearances()?.normal; return n instanceof PDFStream || n instanceof PDFDict; })) return false;
    } else if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) {
      const v = field.acroField.dict.lookup(PDFName.of("V"));
      const on = v instanceof PDFName && v.decodeText() !== "Off" ? v : null;
      for (const w of widgets) {
        const as = w.getAppearanceState();
        const want = on && w.getOnValue() === on ? on : PDFName.of("Off");
        if (as !== want) return false;
      }
    }
  }
  return true;
}

async function produce(original: Uint8Array, reading: PdfReading, values: FormValues, fontBytes: () => Promise<Uint8Array>) {
  const doc = await PDFDocument.load(original, { updateMetadata: false, throwOnInvalidObject: false });
  const ctx: Ctx = { doc, fontBytes };
  const byId = new Map(reading.bindings.map((b) => [b.fieldId, b]));
  const attempted: string[] = [];
  const refused: string[] = [];
  for (const [id, raw] of Object.entries(values)) {
    const b = byId.get(id);
    if (!b) { refused.push(id); continue; }
    try {
      await writeBinding(ctx, b, String(raw).normalize("NFC"));
      attempted.push(id);
    } catch {
      refused.push(id);
    }
  }
  if (ctx.font) {
    // A viewer that redraws a field uses the font its /DA names: put the embedded font in the form's resources.
    const acro = doc.getForm().acroForm.dict;
    const dr = acro.lookupMaybe(PDFName.of("DR"), PDFDict) ?? doc.context.obj({});
    if (!acro.has(PDFName.of("DR"))) acro.set(PDFName.of("DR"), dr);
    const fonts = dr.lookupMaybe(PDFName.of("Font"), PDFDict) ?? doc.context.obj({});
    if (!dr.has(PDFName.of("Font"))) dr.set(PDFName.of("Font"), fonts);
    fonts.set(PDFName.of(ctx.font.name), ctx.font.ref);
  }
  const bytes = await doc.save({ updateFieldAppearances: false });
  return { bytes, attempted, refused };
}

/**
 * Writes `values` into a copy of `original` and confirms each one by parsing the new bytes afresh. Returns the new
 * bytes (the original is untouched), `written` for fields the new file holds with a visible appearance, `failed` for
 * everything else. A field that failed is left as the original had it.
 */
export async function fillPdf(original: Uint8Array, reading: PdfReading, values: FormValues, font: FontSource): Promise<{ bytes: Uint8Array; written: string[]; failed: string[] }> {
  let cached: Promise<Uint8Array> | null = null;
  const fontBytes = () => (cached ??= typeof font === "function" ? font() : Promise.resolve(font));
  const byId = new Map(reading.bindings.map((b) => [b.fieldId, b]));
  let todo: FormValues = { ...values };
  const failed = new Set<string>();
  for (let pass = 0; pass < 2; pass++) {
    const { bytes, attempted, refused } = await produce(original, reading, todo, fontBytes);
    refused.forEach((id) => failed.add(id));
    const check = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    const unconfirmed: string[] = [];
    for (const id of attempted) {
      const b = byId.get(id) as PdfBinding;
      const max = b.via === "text" ? readMax(check, b) : undefined;
      const want = expected(b, String(values[id]).normalize("NFC"), max);
      const got = readBinding(check, b).normalize("NFC");
      const same = b.via === "text" && !isMultiline(check, b) ? got === want.replace(/\s*[\r\n]+\s*/g, " ") : got === want;
      if (!same || !shows(check, b)) unconfirmed.push(id);
    }
    if (!unconfirmed.length || pass === 1) {
      unconfirmed.forEach((id) => failed.add(id));
      const written = Object.keys(values).filter((id) => !failed.has(id));
      return { bytes, written, failed: Object.keys(values).filter((id) => failed.has(id)) };
    }
    // Something was changed but not confirmed: write again without it, so the copy never holds half an answer.
    unconfirmed.forEach((id) => failed.add(id));
    todo = Object.fromEntries(Object.entries(values).filter(([id]) => !failed.has(id)));
  }
  throw new Error("unreachable");
}

function readMax(doc: PDFDocument, b: PdfBinding): number | undefined {
  try { return doc.getForm().getTextField(b.names[0] as string).getMaxLength(); } catch { return undefined; }
}
function isMultiline(doc: PDFDocument, b: PdfBinding): boolean {
  try { return doc.getForm().getTextField(b.names[0] as string).isMultiline(); } catch { return false; }
}
