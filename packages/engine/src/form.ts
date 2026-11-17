import type { FieldKind, FieldOption, FieldStructure, FormStructure, FormValues } from "./types.js";
import { publicUrl } from "./url.js";
import { attr, blocked, collapse, isHidden, pageLang, SKIP_TAGS, tag, textOf } from "./dom.js";
import { fingerprint } from "./fingerprint.js";

const IGNORED_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);
const CSRF_RE = /(csrf|xsrf|authenticity[_-]?token|__requestverificationtoken|^_?token$|nonce|honeypot)/i;
const HINT_RE = /(^|[\s_-])(hint|help|helper|description|form-text|note)([\s_-]|$)/i;
const CONTROL_SELECTOR = "input, select, textarea";

interface Control {
  el: Element;
  legends: string[];
  heading: string;
}

/** A field as found in the document: its structure plus the live elements behind it (one, or a radio/checkbox group). */
export interface FieldBinding {
  field: FieldStructure;
  els: Element[];
}

const cleanLabel = (s: string): string => collapse(s).replace(/\s*[*:]+\s*$/, "").replace(/^\*\s*/, "").trim();

function kindOf(el: Element): FieldKind {
  const t = tag(el);
  if (t === "select") return "select";
  if (t === "textarea") return "textarea";
  const type = attr(el, "type").toLowerCase() || "text";
  if (type === "text" || type === "search" || type === "url") return "text";
  if (type === "email" || type === "tel" || type === "checkbox" || type === "radio" || type === "file") return type;
  if (type === "number" || type === "range") return "number";
  if (type === "date" || type === "datetime-local" || type === "month" || type === "week" || type === "time") return "date";
  return "other";
}

function gather(scope: Element): Control[] {
  const out: Control[] = [];
  const heading = { v: "" };
  const walk = (el: Element, legends: string[]): void => {
    for (const child of Array.from(el.children)) {
      const t = tag(child);
      if (SKIP_TAGS.has(t) || t === "legend" || isHidden(child)) continue;
      if (/^h[1-6]$/.test(t)) {
        heading.v = cleanLabel(textOf(child));
        continue;
      }
      if (t === "input" || t === "select" || t === "textarea") {
        out.push({ el: child, legends, heading: heading.v });
        continue;
      }
      if (t === "fieldset") {
        const lg = Array.from(child.children).find((c) => tag(c) === "legend");
        walk(child, lg ? [...legends, cleanLabel(textOf(lg))] : legends);
        continue;
      }
      walk(child, legends);
    }
  };
  walk(scope, []);
  return out;
}

const isControlKept = (el: Element): boolean => {
  if (el.hasAttribute("disabled")) return false;
  const t = tag(el);
  if (t === "input" && IGNORED_TYPES.has(attr(el, "type").toLowerCase())) return false;
  return !(CSRF_RE.test(attr(el, "name")) || (t === "input" && CSRF_RE.test(attr(el, "id"))));
};

function labelText(label: Element): string {
  return cleanLabel(textOf(label, (e) => ["input", "select", "textarea", "button"].includes(tag(e))));
}

function nearbyText(el: Element): string {
  let cur: Element | null = el;
  for (let depth = 0; depth < 3 && cur; depth++) {
    let sib: Node | null = cur.previousSibling;
    while (sib) {
      if (sib.nodeType === 3) {
        const t = collapse(sib.nodeValue ?? "");
        if (t) return t.length <= 80 ? cleanLabel(t) : "";
      } else if (sib.nodeType === 1) {
        const s = sib as Element;
        if (isHidden(s) || SKIP_TAGS.has(tag(s))) {
          sib = sib.previousSibling;
          continue;
        }
        if (s.matches(CONTROL_SELECTOR) || s.querySelector(CONTROL_SELECTOR)) return "";
        const t = textOf(s);
        if (t) return t.length <= 80 ? cleanLabel(t) : "";
      }
      sib = sib.previousSibling;
    }
    const parent: Element | null = cur.parentElement;
    if (!parent || ["form", "fieldset", "body"].includes(tag(parent))) break;
    cur = parent;
  }
  return "";
}

interface Ctx {
  doc: Document;
  labelByFor: Map<string, Element>;
}

function textOfIds(ids: string, ctx: Ctx): string {
  return ids
    .split(/\s+/)
    .map((id) => ctx.doc.getElementById(id))
    .filter((e): e is HTMLElement => !!e)
    .map((e) => textOf(e))
    .join(" ");
}

function accessibleName(el: Element, ctx: Ctx): string {
  const labelledBy = attr(el, "aria-labelledby");
  if (labelledBy) {
    const t = cleanLabel(textOfIds(labelledBy, ctx));
    if (t) return t;
  }
  return cleanLabel(attr(el, "aria-label"));
}

function fieldLabel(el: Element, ctx: Ctx): string {
  const id = attr(el, "id");
  const byFor = id ? ctx.labelByFor.get(id) : undefined;
  if (byFor && labelText(byFor)) return labelText(byFor);
  const wrap = el.closest("label");
  if (wrap && labelText(wrap)) return labelText(wrap);
  return (
    accessibleName(el, ctx) ||
    nearbyText(wrap ?? el) ||
    cleanLabel(attr(el, "placeholder")) ||
    cleanLabel(attr(el, "title")) ||
    attr(el, "name")
  );
}

function optionLabel(el: Element, ctx: Ctx): string {
  const id = attr(el, "id");
  const byFor = id ? ctx.labelByFor.get(id) : undefined;
  if (byFor && labelText(byFor)) return labelText(byFor);
  const wrap = el.closest("label");
  if (wrap && labelText(wrap)) return labelText(wrap);
  const aria = accessibleName(el, ctx);
  if (aria) return aria;
  let sib: Node | null = el.nextSibling;
  while (sib && sib.nodeType === 3 && !collapse(sib.nodeValue ?? "")) sib = sib.nextSibling;
  if (sib && sib.nodeType === 3) return cleanLabel(sib.nodeValue ?? "");
  if (sib && sib.nodeType === 1 && !(sib as Element).matches(CONTROL_SELECTOR) && textOf(sib)) return cleanLabel(textOf(sib));
  return attr(el, "value");
}

function hintOf(el: Element, ctx: Ctx): string {
  const describedBy = attr(el, "aria-describedby");
  if (describedBy) {
    const t = collapse(textOfIds(describedBy, ctx));
    if (t) return t;
  }
  const anchor = el.closest("label") ?? el;
  const next = anchor.nextElementSibling;
  if (next && !isHidden(next) && tag(next) !== "label" && !next.matches(CONTROL_SELECTOR) && !next.querySelector(CONTROL_SELECTOR)) {
    const cls = `${attr(next, "class")} ${attr(next, "id")}`;
    if (tag(next) === "small" || HINT_RE.test(cls)) return textOf(next);
  }
  return "";
}

function groupLabel(members: Element[], controls: Control[], ctx: Ctx): { label: string; usedLegend?: string } {
  const first = members[0] as Element;
  const names = new Set(members.map((m) => attr(m, "name")));
  const fieldset = first.closest("fieldset");
  if (fieldset) {
    const lg = Array.from(fieldset.children).find((c) => tag(c) === "legend");
    if (lg) {
      const inside = controls.filter((c) => fieldset.contains(c.el));
      if (inside.every((c) => names.has(attr(c.el, "name")))) {
        const text = cleanLabel(textOf(lg));
        if (text) return { label: text, usedLegend: text };
      }
    }
  }
  const grp = first.closest('[role="radiogroup"], [role="group"]');
  if (grp) {
    const n = accessibleName(grp, ctx);
    if (n) return { label: n };
  }
  const near = nearbyText(first.closest("label") ?? first);
  return { label: near || attr(first, "name") };
}

/** Find the fields of one form (or form-like region). */
export function buildBindings(scope: Element, doc: Document): FieldBinding[] {
  const ctx: Ctx = { doc, labelByFor: new Map() };
  for (const l of Array.from(doc.querySelectorAll("label[for]"))) {
    const f = attr(l, "for");
    if (f && !ctx.labelByFor.has(f)) ctx.labelByFor.set(f, l);
  }
  const controls = gather(scope).filter((c) => isControlKept(c.el));
  const nameCount = new Map<string, number>();
  for (const c of controls) {
    const k = `${attr(c.el, "type").toLowerCase()}:${attr(c.el, "name")}`;
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }
  const bindings: FieldBinding[] = [];
  const used = new Set<string>();
  const uniqueId = (base: string): string => {
    const first = base || `f${bindings.length}`;
    let id = first;
    for (let n = 2; used.has(id); n++) id = `${first}_${n}`;
    used.add(id);
    return id;
  };
  const done = new Set<Element>();

  for (const c of controls) {
    if (done.has(c.el)) continue;
    const el = c.el;
    const kind = kindOf(el);
    const name = attr(el, "name");
    const type = attr(el, "type").toLowerCase();
    const grouped = (kind === "radio" || kind === "checkbox") && !!name && (kind === "radio" || (nameCount.get(`${type}:${name}`) ?? 0) > 1);
    const members = grouped
      ? controls.filter((o) => attr(o.el, "type").toLowerCase() === type && attr(o.el, "name") === name).map((o) => o.el)
      : [el];
    members.forEach((m) => done.add(m));

    let label: string;
    let usedLegend: string | undefined;
    let options: FieldOption[] | undefined;
    if (grouped) {
      const g = groupLabel(members, controls, ctx);
      label = g.label;
      usedLegend = g.usedLegend;
      options = members.map((m) => ({ value: attr(m, "value") || "on", label: optionLabel(m, ctx) }));
    } else {
      label = fieldLabel(el, ctx);
      if (kind === "select") {
        options = Array.from(el.querySelectorAll("option"))
          .map((o) => ({ value: o.hasAttribute("value") ? attr(o, "value") : textOf(o), label: textOf(o) }))
          .filter((o) => o.value !== "");
      }
    }
    const section = [...c.legends].reverse().find((l) => l && l !== usedLegend) || c.heading || undefined;
    const field: FieldStructure = {
      fieldId: uniqueId(grouped ? name : attr(el, "id") || name),
      kind,
      label,
      required: members.some((m) => m.hasAttribute("required") || attr(m, "aria-required").toLowerCase() === "true"),
    };
    if (options && options.length) field.options = options;
    const placeholder = collapse(attr(el, "placeholder"));
    if (placeholder && !grouped) field.placeholder = placeholder;
    const pattern = attr(el, "pattern");
    if (pattern && !grouped) field.pattern = pattern;
    const max = parseInt(attr(el, "maxlength"), 10);
    if (Number.isFinite(max) && max > 0 && !grouped) field.maxLength = max;
    const hint = hintOf(grouped ? (members[members.length - 1] as Element) : el, ctx);
    if (hint) field.hint = hint;
    if (section) field.section = section;
    bindings.push({ field, els: members });
  }
  return bindings;
}

/** The fillable forms of a document, in order. Forms in navigation, headers, footers, asides and banners are skipped. */
export function listForms(doc: Document): Element[] {
  const scopes = Array.from(doc.querySelectorAll("form")).filter((f) => !blocked(f));
  const usable = scopes.filter((f) => buildBindings(f, doc).length > 0);
  if (usable.length) return usable;
  if (!scopes.length && doc.body && buildBindings(doc.body, doc).length >= 2) return [doc.body];
  return [];
}

export async function extractForm(doc: Document, url: string, formIndex = 0): Promise<FormStructure> {
  const scope = listForms(doc)[formIndex];
  const fields = scope ? buildBindings(scope, doc).map((b) => b.field) : [];
  const h1 = doc.querySelector("h1");
  return {
    fingerprint: await fingerprint(url, fields),
    url: publicUrl(url),
    lang: pageLang(doc),
    title: collapse(doc.title ?? "") || (h1 ? textOf(h1) : ""),
    fields,
  };
}

/** Find the live elements behind a structure: the form whose fields overlap it most. */
function bindStructure(doc: Document, structure: FormStructure): Map<string, FieldBinding> {
  const want = new Set(structure.fields.map((f) => f.fieldId));
  let best: FieldBinding[] = [];
  let bestScore = 0;
  for (const scope of listForms(doc)) {
    const b = buildBindings(scope, doc);
    const score = b.filter((x) => want.has(x.field.fieldId)).length;
    if (score > bestScore) {
      best = b;
      bestScore = score;
    }
  }
  return new Map(best.map((b) => [b.field.fieldId, b]));
}

const TRUE_RE = /^(true|yes|y|1|on|checked|ano)$/i;
const splitList = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);

/** Reads each field as a string. Radio: the checked option's value. Checkbox group: checked values joined by ",".
 *  Single checkbox: "true" or "false". Empty fields are omitted. Device-only. */
export function readValues(doc: Document, structure: FormStructure): FormValues {
  const bound = bindStructure(doc, structure);
  const out: FormValues = {};
  for (const f of structure.fields) {
    const b = bound.get(f.fieldId);
    if (!b) continue;
    const first = b.els[0] as Element;
    let v = "";
    if (f.kind === "radio") {
      const hit = b.els.find((e) => (e as HTMLInputElement).checked);
      v = hit ? attr(hit, "value") || "on" : "";
    } else if (f.kind === "checkbox") {
      if (b.els.length > 1) v = b.els.filter((e) => (e as HTMLInputElement).checked).map((e) => attr(e, "value") || "on").join(",");
      else v = (first as HTMLInputElement).checked ? "true" : "false";
    } else if (f.kind !== "file") {
      v = (first as HTMLInputElement).value ?? "";
    }
    if (v !== "") out[f.fieldId] = v;
  }
  return out;
}

function nativeSet(el: Element, prop: "value" | "checked", v: string | boolean): void {
  let proto: object | null = Object.getPrototypeOf(el);
  while (proto) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (d?.set) {
      d.set.call(el, v);
      return;
    }
    proto = Object.getPrototypeOf(proto);
  }
  (el as unknown as Record<string, unknown>)[prop] = v;
}

function fire(el: Element): void {
  const E = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.Event ?? Event;
  el.dispatchEvent(new E("input", { bubbles: true }));
  el.dispatchEvent(new E("change", { bubbles: true }));
}

/** D.M.YYYY, D/M/YYYY or D-M-YYYY to the ISO form an <input type="date"> takes. */
function toIsoDate(v: string): string {
  const m = /^\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})\s*$/.exec(v);
  return m ? `${m[3]}-${(m[2] as string).padStart(2, "0")}-${(m[1] as string).padStart(2, "0")}` : v.trim();
}

function setChecked(el: Element, on: boolean): boolean {
  nativeSet(el, "checked", on);
  fire(el);
  return (el as HTMLInputElement).checked === on;
}

function writeOne(b: FieldBinding, value: string): boolean {
  const { field, els } = b;
  const first = els[0] as Element;
  if (field.kind === "file") return false;
  if (field.kind === "radio") {
    const want = value.trim().toLowerCase();
    const byValue = els.find((e) => (attr(e, "value") || "on") === value);
    const byLabel = els.find((_, i) => (field.options?.[i]?.label ?? "").toLowerCase() === want);
    const hit = byValue ?? byLabel;
    return hit ? setChecked(hit, true) : false;
  }
  if (field.kind === "checkbox") {
    if (els.length > 1) {
      const wanted = splitList(value).map((s) => s.toLowerCase());
      let ok = true;
      els.forEach((e, i) => {
        const val = (attr(e, "value") || "on").toLowerCase();
        const lab = (field.options?.[i]?.label ?? "").toLowerCase();
        ok = setChecked(e, wanted.includes(val) || wanted.includes(lab)) && ok;
      });
      return ok;
    }
    const v = value.trim();
    return setChecked(first, TRUE_RE.test(v) || (v !== "" && v.toLowerCase() === attr(first, "value").toLowerCase()));
  }
  if (tag(first) === "select") {
    const opts = Array.from((first as HTMLSelectElement).options);
    const want = value.trim().toLowerCase();
    const hit =
      opts.find((o) => o.value === value) ?? opts.find((o) => collapse(o.text).toLowerCase() === want) ?? opts.find((o) => o.value.toLowerCase() === want);
    if (!hit) return false;
    nativeSet(first, "value", hit.value);
    hit.selected = true;
    fire(first);
    return (first as HTMLSelectElement).value === hit.value;
  }
  const next = field.kind === "date" ? toIsoDate(value) : value;
  nativeSet(first, "value", next);
  fire(first);
  return next === "" || (first as HTMLInputElement).value !== "";
}

/** Writes values into the original fields with the native setter and bubbling input + change events. */
export function writeValues(doc: Document, structure: FormStructure, values: FormValues): { written: string[]; failed: string[] } {
  const bound = bindStructure(doc, structure);
  const written: string[] = [];
  const failed: string[] = [];
  for (const [id, value] of Object.entries(values)) {
    const b = bound.get(id);
    let ok = false;
    if (b) {
      try {
        ok = writeOne(b, String(value));
      } catch {
        ok = false;
      }
    }
    (ok ? written : failed).push(id);
  }
  return { written, failed };
}
