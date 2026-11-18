/// <reference types="node" />
// Builds the synthetic PDF forms of the corpus from their <slug>.pdf.json layouts, in the test run itself: nothing is
// downloaded and no real office's PDF is committed. Printed text uses the same embedded Noto Sans as the filler, so
// pdf.js reads it back as Unicode; fields are made with pdf-lib's own form API (no Distill code).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@cantoo/fontkit";
import { PDFDocument, PDFHexString, PDFName, rgb, type PDFFont, type PDFForm, type PDFPage } from "@cantoo/pdf-lib";

export const CORPUS_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
export const FONT_PATH = resolve(CORPUS_DIR, "../../fonts/NotoSans-Regular.ttf");
export const fontBytes = (): Uint8Array => new Uint8Array(readFileSync(FONT_PATH));

/** [x, y, width, height] in PDF units, origin bottom-left. */
type Rect = [number, number, number, number];

export interface TextSpec { at: [number, number]; size?: number; text: string }
export type FieldSpec =
  | { type: "text"; name: string; rect: Rect; tooltip?: string; maxLen?: number; comb?: boolean; multiline?: boolean; required?: boolean; readOnly?: boolean; prefill?: string }
  | { type: "checkbox"; name: string; rect: Rect; tooltip?: string; required?: boolean; prefill?: boolean }
  | { type: "radio"; name: string; tooltip?: string; required?: boolean; options: { value: string; rect: Rect }[] }
  | { type: "dropdown"; name: string; rect: Rect; tooltip?: string; required?: boolean; options: (string | [string, string])[] }
  | { type: "signature"; name: string; rect: Rect };
/** A ruled line, drawn as a stroke (or, `fill`, as a thin filled box, as some tools draw lines). */
export interface LineSpec { from: [number, number]; to: [number, number]; width?: number; fill?: boolean }
/** A box drawn on the page (not a form field): square or rounded corners, `thick` borders drawn as filled bars. */
export interface RectSpec { rect: Rect; width?: number; radius?: number; dashed?: boolean }
/** A print-only page draws its lines and boxes; `image` paints a grey picture over the whole page (a scan). */
export interface PageSpec { size?: [number, number]; text: TextSpec[]; fields: FieldSpec[]; lines?: LineSpec[]; rects?: RectSpec[]; image?: boolean }
/**
 * Protection as an author's PDF tool sets it, applied with pdf-lib's own `encrypt` (no Distill code): an owner password,
 * an optional password to open the file, the permissions, and the cipher. The forms of the Czech corridor that are
 * protected use AES-128 (ipc.gov.cz: printing, filling in forms, accessibility) or AES-256 (VZP: the same, plus
 * annotations), each with only an owner password.
 */
export interface Protect {
  algorithm?: "AES-128" | "AES-256";
  userPassword?: string;
  permissions: { printing?: false | "lowResolution" | "highResolution"; modifying?: boolean; copying?: boolean; annotating?: boolean; fillingForms?: boolean; contentAccessibility?: boolean; documentAssembly?: boolean };
}
export interface Layout { title?: string; lang?: string; protect?: Protect; pages: PageSpec[] }

/** A 2 x 2 grey PNG: what a scanned page is, as far as reading it goes (a picture, no text). */
const GREY_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAAAAABX3VL4AAAADklEQVR4nGM4sY9hyyUACSADDViXdnkAAAAASUVORK5CYII=", "base64"));

const tooltip = (form: PDFForm, name: string, t?: string): void => {
  if (t) form.getField(name).acroField.dict.set(PDFName.of("TU"), PDFHexString.fromText(t));
};

/** Draws the layout into a new PDF and returns its bytes. */
export async function buildPdf(layout: Layout): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font: PDFFont = await doc.embedFont(fontBytes(), { subset: true });
  if (layout.title) doc.setTitle(layout.title);
  if (layout.lang) doc.catalog.set(PDFName.of("Lang"), PDFHexString.fromText(layout.lang));
  const form = doc.getForm();
  const prefilled: string[] = [];
  for (const spec of layout.pages) {
    const page: PDFPage = doc.addPage(spec.size ?? [595, 842]);
    if (spec.image) {
      const png = await doc.embedPng(GREY_PNG);
      page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    }
    for (const t of spec.text) page.drawText(t.text, { x: t.at[0], y: t.at[1], size: t.size ?? 10, font, color: rgb(0, 0, 0) });
    for (const l of spec.lines ?? []) {
      const w = l.width ?? 0.6;
      if (l.fill) {
        const [x1, y1] = l.from, [x2, y2] = l.to;
        page.drawRectangle({ x: Math.min(x1, x2), y: Math.min(y1, y2) - (y1 === y2 ? w / 2 : 0), width: Math.max(Math.abs(x2 - x1), w), height: Math.max(Math.abs(y2 - y1), w), color: rgb(0, 0, 0) });
      } else page.drawLine({ start: { x: l.from[0], y: l.from[1] }, end: { x: l.to[0], y: l.to[1] }, thickness: w, color: rgb(0, 0, 0) });
    }
    for (const r of spec.rects ?? []) {
      const [x, y, w, h] = r.rect;
      const bw = r.width ?? 0.8;
      const dash = r.dashed ? { borderDashArray: [3, 2] } : {};
      if (r.radius) {
        const k = r.radius;
        // An SVG path, y down from the box's top-left corner.
        const d = `M ${k} 0 H ${w - k} Q ${w} 0 ${w} ${k} V ${h - k} Q ${w} ${h} ${w - k} ${h} H ${k} Q 0 ${h} 0 ${h - k} V ${k} Q 0 0 ${k} 0 Z`;
        page.drawSvgPath(d, { x, y: y + h, borderWidth: bw, borderColor: rgb(0, 0, 0), ...dash });
      } else page.drawRectangle({ x, y, width: w, height: h, borderWidth: bw, borderColor: rgb(0, 0, 0), ...dash });
    }
    for (const f of spec.fields) {
      const box = (r: Rect) => ({ x: r[0], y: r[1], width: r[2], height: r[3], borderWidth: 1, borderColor: rgb(0.3, 0.3, 0.3), backgroundColor: rgb(1, 1, 1) });
      if (f.type === "text") {
        const tf = form.createTextField(f.name);
        if (f.maxLen) tf.setMaxLength(f.maxLen);
        if (f.comb) tf.enableCombing();
        if (f.multiline) tf.enableMultiline();
        if (f.required) tf.enableRequired();
        tf.addToPage(page, box(f.rect));
        if (f.prefill) { tf.setText(f.prefill); prefilled.push(f.name); }
        if (f.readOnly) tf.enableReadOnly();
      } else if (f.type === "checkbox") {
        const cb = form.createCheckBox(f.name);
        cb.addToPage(page, box(f.rect));
        if (f.required) cb.enableRequired();
        if (f.prefill) cb.check();
      } else if (f.type === "radio") {
        const rg = form.createRadioGroup(f.name);
        for (const o of f.options) rg.addOptionToPage(o.value, page, box(o.rect));
        if (f.required) rg.enableRequired();
      } else if (f.type === "dropdown") {
        const dd = form.createDropdown(f.name);
        dd.addOptions(f.options.map((o) => (typeof o === "string" ? o : o[0])));
        if (f.options.some((o) => typeof o !== "string")) {
          // Export value and shown text differ: /Opt holds [export, shown] pairs.
          dd.acroField.dict.set(PDFName.of("Opt"), doc.context.obj(f.options.map((o) => (typeof o === "string" ? PDFHexString.fromText(o) : [PDFHexString.fromText(o[0]), PDFHexString.fromText(o[1])]))));
        }
        dd.addToPage(page, box(f.rect));
        if (f.required) dd.enableRequired();
      } else {
        // An unsigned signature field: something to sign later, not something to fill, and no lock.
        const ctx = doc.context;
        const widget = ctx.obj({ Type: "Annot", Subtype: "Widget", FT: "Sig", T: PDFHexString.fromText(f.name), Rect: [f.rect[0], f.rect[1], f.rect[0] + f.rect[2], f.rect[1] + f.rect[3]], F: 4, P: page.ref });
        const ref = ctx.register(widget);
        page.node.addAnnot(ref);
        form.acroForm.addField(ref);
      }
      if (f.type !== "signature") tooltip(form, f.name, f.tooltip);
    }
  }
  if (layout.pages.some((p) => p.fields.length)) form.updateFieldAppearances(font);
  if (layout.protect) {
    const p = layout.protect;
    doc.encrypt({ ownerPassword: "author-only-4d1e", userPassword: p.userPassword ?? "", permissions: p.permissions, algorithm: p.algorithm ?? "AES-256" });
  }
  return doc.save();
}

/** A fixture file as written. One with `"source": "<slug>"` takes that fixture's layout, fields and byHand, and adds its
 *  own `title`, `models` and `protect` (the same form, protected by its author). */
export function readLayout(slug: string): unknown {
  const own = JSON.parse(readFileSync(join(CORPUS_DIR, `${slug}.pdf.json`), "utf8")) as { source?: string; protect?: Protect; layout?: Layout };
  if (!own.source) return own;
  const base = readLayout(own.source) as { layout: Layout };
  const { source: _s, protect, ...rest } = own;
  return { ...base, ...rest, layout: { ...base.layout, ...(protect ? { protect } : {}) } };
}
