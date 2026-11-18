// The AcroForm of a PDF as pdf-lib reads it: every field a person can fill, with its widgets' boxes, and the facts
// that decide whether the file may be changed at all (a signature, a lock). Structure only: a field's value is read
// here only by readField, which is device-only and never feeds a FormStructure or a PageModel.
import {
  PDFAcroCheckBox, PDFAcroRadioButton, PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName,
  PDFNumber, PDFOptionList, PDFRadioGroup, PDFSignature, PDFString, PDFTextField, type PDFField, type PDFWidgetAnnotation,
} from "@cantoo/pdf-lib";
import type { FieldOption } from "@distill/engine";
import type { Box } from "./types.js";

export interface RawWidget {
  box: Box;
  /** A checkbox or radio widget's "on" appearance state, decoded. */
  onValue?: string;
  /** Its place among all the field's widgets (hidden ones included), which /Opt follows. */
  index: number;
}

export interface RawField {
  name: string;
  type: "text" | "checkbox" | "radio" | "choice";
  widgets: RawWidget[];
  /** The field's tooltip (/TU): its accessible name in PDF terms. */
  tooltip: string;
  required: boolean;
  maxLen?: number;
  comb?: boolean;
  multiline?: boolean;
  /** Choice: export value and shown text. Radio (and a checkbox whose widgets have different "on" states): the
   *  export value of each widget, in widget order. */
  options?: FieldOption[];
}

const decode = (o: unknown): string =>
  o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : "";

/** Widget flags: Hidden (2) and NoView (32) mean the person never sees it. */
const hiddenWidget = (w: PDFWidgetAnnotation): boolean => {
  const f = w.dict.lookup(PDFName.of("F"));
  const n = f instanceof PDFNumber ? f.asNumber() : 0;
  return (n & 2) !== 0 || (n & 32) !== 0;
};

/** Which page each annotation dictionary sits on. */
function pageIndex(doc: PDFDocument): Map<PDFDict, number> {
  const out = new Map<PDFDict, number>();
  doc.getPages().forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const d = annots.lookup(k);
      if (d instanceof PDFDict) out.set(d, i);
    }
  });
  return out;
}

function widgetsOf(field: PDFField, pages: Map<PDFDict, number>, doc: PDFDocument): RawWidget[] {
  const out: RawWidget[] = [];
  field.acroField.getWidgets().forEach((w, index) => {
    if (hiddenWidget(w)) return;
    let page = pages.get(w.dict);
    if (page === undefined) {
      const p = w.P();
      if (p) page = doc.getPages().findIndex((x) => x.ref === p);
    }
    if (page === undefined || page < 0) return; // a widget on no page cannot be seen
    const r = w.getRectangle();
    if (!(r.width > 1 && r.height > 1)) return;
    const onValue = w.getOnValue();
    out.push({ box: { page, x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y + r.height }, index, ...(onValue ? { onValue: onValue.decodeText() } : {}) });
  });
  return out;
}

/** The /Opt export values of a button field, when it has them. */
function buttonOpt(field: PDFField): string[] | null {
  const opt = field.acroField.dict.lookup(PDFName.of("Opt"));
  if (!(opt instanceof PDFArray)) return null;
  return Array.from({ length: opt.size() }, (_, i) => decode(opt.lookup(i)));
}

/** The fields a person can fill, in the form's own order. Read-only, password, file, push-button and signature fields
 *  are left out, as are widgets nobody can see. */
export function readFields(doc: PDFDocument): RawField[] {
  const pages = pageIndex(doc);
  const out: RawField[] = [];
  for (const field of doc.getForm().getFields()) {
    if (field.isReadOnly()) continue;
    const widgets = widgetsOf(field, pages, doc);
    if (!widgets.length) continue;
    const tooltip = decode(field.acroField.dict.lookup(PDFName.of("TU"))).replace(/\s+/g, " ").trim();
    const base = { name: field.getName(), widgets, tooltip, required: field.isRequired() };
    if (field instanceof PDFTextField) {
      if (field.isPassword() || field.isFileSelector()) continue;
      const max = field.getMaxLength();
      out.push({ ...base, type: "text", ...(max ? { maxLen: max } : {}), ...(field.isCombed() ? { comb: true } : {}), ...(field.isMultiline() ? { multiline: true } : {}) });
    } else if (field instanceof PDFCheckBox) {
      const ons = [...new Set(widgets.map((w) => w.onValue).filter((v): v is string => !!v))];
      if (ons.length > 1) {
        // Boxes that share a name but not an "on" state: only one can be ticked, so it is a choice of one.
        const opt = buttonOpt(field);
        const all = field.acroField.getWidgets().length;
        const values = widgets.map((w) => (opt && opt.length === all ? (opt[w.index] as string) : w.onValue ?? ""));
        out.push({ ...base, type: "radio", options: values.map((v) => ({ value: v, label: v })) });
      } else out.push({ ...base, type: "checkbox" });
    } else if (field instanceof PDFRadioGroup) {
      const opt = buttonOpt(field);
      const all = field.acroField.getWidgets().length;
      const values = widgets.map((w) => (opt && opt.length === all ? (opt[w.index] as string) : w.onValue ?? ""));
      out.push({ ...base, type: "radio", options: values.map((v) => ({ value: v, label: v })) });
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const options = field.acroField.getOptions().map((o) => {
        const value = o.value.decodeText();
        return { value, label: (o.display ?? o.value).decodeText() || value };
      }).filter((o) => o.value !== "");
      out.push({ ...base, type: "choice", options });
    }
    // Push buttons and signature fields are not answers a person types.
  }
  return out;
}

/**
 * Why the file must not be changed, in plain words, or "" when it may be: a signed signature field (rewriting the file
 * breaks the signature), a document that allows no changes (DocMDP), or one that may only be appended to (SigFlags).
 */
export function lockReason(doc: PDFDocument): string {
  const perms = doc.catalog.lookup(PDFName.of("Perms"));
  if (perms instanceof PDFDict && perms.has(PDFName.of("DocMDP"))) return "certified";
  const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (acro instanceof PDFDict) {
    const flags = acro.lookup(PDFName.of("SigFlags"));
    if (flags instanceof PDFNumber && (flags.asNumber() & 2) !== 0) return "append-only";
  }
  for (const f of doc.getForm().getFields()) {
    if (f instanceof PDFSignature && f.acroField.dict.lookup(PDFName.of("V")) instanceof PDFDict) return "signed";
  }
  return "";
}

// ---------------------------------------------------------------- reading a value (device-only)

/** The value a field holds now, as the wizard shows it: text, "true" for a ticked box, the export value of a choice.
 *  "" when empty. Device-only: never put into a FormStructure, a PageModel or a prompt. */
export function readField(doc: PDFDocument, name: string): string {
  let field: PDFField;
  try {
    field = doc.getForm().getField(name);
  } catch {
    return "";
  }
  if (field instanceof PDFTextField) return field.getText() ?? "";
  if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) {
    const acro = field.acroField as PDFAcroCheckBox | PDFAcroRadioButton;
    const v = acro.dict.lookup(PDFName.of("V"));
    if (!(v instanceof PDFName) || v.decodeText() === "Off") return "";
    const widgets = acro.getWidgets();
    const ons = widgets.map((w) => w.getOnValue()?.decodeText() ?? "");
    if (field instanceof PDFCheckBox && new Set(ons.filter(Boolean)).size <= 1) return "true";
    const opt = buttonOpt(field);
    const at = ons.indexOf(v.decodeText());
    return opt && opt.length === widgets.length && at >= 0 ? (opt[at] as string) : v.decodeText();
  }
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const v = field.acroField.dict.lookup(PDFName.of("V"));
    if (v instanceof PDFArray) return v.size() ? decode(v.lookup(0)) : "";
    return decode(v);
  }
  return "";
}
