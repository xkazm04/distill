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
export interface PageSpec { size?: [number, number]; text: TextSpec[]; fields: FieldSpec[] }
export interface Layout { title?: string; lang?: string; pages: PageSpec[] }

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
    for (const t of spec.text) page.drawText(t.text, { x: t.at[0], y: t.at[1], size: t.size ?? 10, font, color: rgb(0, 0, 0) });
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
  form.updateFieldAppearances(font);
  return doc.save();
}

export const readLayout = (slug: string): unknown => JSON.parse(readFileSync(join(CORPUS_DIR, `${slug}.pdf.json`), "utf8"));
