import type { FieldKind, FieldOption, FieldStructure, FormErrors, FormStructure, FormValues } from "./types.js";
import { publicUrl } from "./url.js";
import { attr, blocked, byId, collapse, fold, isHidden, pageLang, SKIP_TAGS, tag, textOf as rawTextOf } from "./dom.js";
import { errorElements, errorsOf } from "./errors.js";
import { fingerprint } from "./fingerprint.js";
import { FIELDISH, inputCombobox, itemValue, listboxOf, listOptions, widgetRole } from "./aria.js";
import { readOne, writeOne } from "./fill.js";

const IGNORED_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);
const CSRF_RE = /(csrf|xsrf|authenticity[_-]?token|__requestverificationtoken|^_?token$|nonce|honeypot)/i;
const HINT_RE = /(^|[\s_-])(hint|help|helper|description|form-text|note)([\s_-]|$)/i;
const CONTROL_SELECTOR = "input, select, textarea";
const NATIVE = new Set(["input", "select", "textarea"]);

interface Control {
  el: Element;
  legends: string[];
  heading: string;
}

export type DatePart = "day" | "month" | "year";

/** A field as found in the document: its structure plus the live elements behind it. Engine-internal: the wire
 *  carries only `field`. */
export interface FieldBinding {
  field: FieldStructure;
  /** One element, a radio/checkbox group, or the pieces of a split date in page order. */
  els: Element[];
  /** How the elements are driven when they are not native controls written directly: ARIA widgets clicked and read
   *  through aria-checked, a combobox or listbox whose option is chosen, or a date split into day, month and year. */
  via?: "aria" | "combobox" | "listbox" | "date";
  /** For `via: "date"`: the part each element of `els` holds. */
  parts?: DatePart[];
}

/** "Is this an error message?" for the form being read (see errors.ts). Set by buildBindings for the length of one
 *  synchronous reading, so every label, hint and nearby text below leaves the page's error messages out: their text
 *  can repeat what the person typed, and a FormStructure feeds cloud-eligible prompts. */
let isError: (el: Element) => boolean = () => false;

/** Visible text, with the page's error messages left out. */
const textOf = (node: Node, skip?: (el: Element) => boolean, includeHidden = false): string =>
  rawTextOf(node, (e) => isError(e) || !!skip?.(e), includeHidden);

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

/** The controls of a scope in page order: native inputs, selects and textareas, and ARIA widgets. Hidden parts are
 *  skipped on purpose (honeypots, and steps the person cannot see yet). Open shadow roots are entered; a closed one
 *  cannot be and is not. Frames are separate scopes (see formScopes). */
function gather(scope: Element): Control[] {
  const out: Control[] = [];
  const heading = { v: "" };
  const walk = (parent: Element | ShadowRoot, legends: string[]): void => {
    for (const child of Array.from(parent.children)) {
      const t = tag(child);
      if (SKIP_TAGS.has(t) || t === "legend" || isHidden(child)) continue;
      if (/^h[1-6]$/.test(t)) {
        heading.v = cleanLabel(textOf(child));
        continue;
      }
      if (NATIVE.has(t)) {
        out.push({ el: child, legends, heading: heading.v });
        continue;
      }
      const role = widgetRole(child);
      // An ARIA 1.1 combobox wraps its own text input: the input is the field, so walk in.
      if (role && !(role === "combobox" && child.querySelector(CONTROL_SELECTOR))) {
        out.push({ el: child, legends, heading: heading.v });
        continue;
      }
      const shadow = child.shadowRoot;
      if (shadow) {
        walk(shadow, legends);
        if (!shadow.querySelector("slot")) continue; // light children show only through a slot
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
  if (widgetRole(el)) return attr(el, "aria-disabled").toLowerCase() !== "true";
  const t = tag(el);
  if (t === "input" && IGNORED_TYPES.has(attr(el, "type").toLowerCase())) return false;
  return !(CSRF_RE.test(attr(el, "name")) || (t === "input" && CSRF_RE.test(attr(el, "id"))));
};

const isRequired = (el: Element): boolean => el.hasAttribute("required") || attr(el, "aria-required").toLowerCase() === "true";

function labelText(label: Element): string {
  return cleanLabel(textOf(label, (e) => ["input", "select", "textarea", "button"].includes(tag(e))));
}

/** Fields under `el` (native controls and ARIA widgets), hidden inputs left out. */
const fieldsIn = (el: Element): number =>
  Array.from(el.querySelectorAll(FIELDISH)).filter((e) => !(tag(e) === "input" && attr(e, "type").toLowerCase() === "hidden")).length;

/** The short text just before the field: in its own or its wrappers' previous siblings (a table's previous cell). */
function nearbyText(el: Element): string {
  let cur: Element | null = el;
  for (let depth = 0; depth < 8 && cur; depth++) {
    let sib: Node | null = cur.previousSibling;
    while (sib) {
      if (sib.nodeType === 3) {
        const t = collapse(sib.nodeValue ?? "");
        if (t) return t.length <= 80 ? cleanLabel(t) : "";
      } else if (sib.nodeType === 1) {
        const s = sib as Element;
        if (isHidden(s) || SKIP_TAGS.has(tag(s)) || isError(s)) {
          sib = sib.previousSibling;
          continue;
        }
        if (s.matches(FIELDISH) || s.querySelector(FIELDISH)) return "";
        const t = textOf(s);
        if (t) return t.length <= 80 ? cleanLabel(t) : "";
      }
      sib = sib.previousSibling;
    }
    const parent: Element | null = cur.parentElement;
    if (!parent || ["form", "fieldset", "body"].includes(tag(parent))) break;
    // Past three levels, climb only through wrappers that hold this one field (a component library's nesting), never
    // into a container of other fields, whose text names the group rather than this field.
    if (depth >= 2 && fieldsIn(parent) > 1) break;
    cur = parent;
  }
  return "";
}

interface Ctx {
  /** label[for] by id, per tree (the document, or a shadow root): a label names a control in its own tree only. */
  labels: WeakMap<Node, Map<string, Element>>;
}

function labelFor(el: Element, ctx: Ctx): Element | undefined {
  const id = attr(el, "id");
  if (!id) return undefined;
  const root = el.getRootNode() as Node & ParentNode;
  let map = ctx.labels.get(root);
  if (!map) {
    map = new Map();
    for (const l of Array.from(root.querySelectorAll?.("label[for]") ?? [])) {
      if (isError(l)) continue; // a validation library's message can be a label[for] too
      const f = attr(l, "for");
      if (f && !map.has(f)) map.set(f, l);
    }
    ctx.labels.set(root, map);
  }
  return map.get(id);
}

/** The text of the elements these ids name, in el's own tree. A named element that is hidden still counts, as the
 *  accessible-name rules say for aria-labelledby and aria-describedby. */
function textOfIds(el: Element, ids: string): string {
  return ids
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => byId(el, id))
    .filter((e): e is Element => !!e && !isError(e))
    .map((e) => textOf(e, undefined, isHidden(e)))
    .join(" ");
}

function accessibleName(el: Element): string {
  const labelledBy = attr(el, "aria-labelledby");
  if (labelledBy) {
    const t = cleanLabel(textOfIds(el, labelledBy));
    if (t) return t;
  }
  return cleanLabel(attr(el, "aria-label"));
}

/** A toggle widget (role=checkbox, switch, radio) is named by its own text when nothing else names it. A combobox's
 *  own text is the value shown in it, so it never names the field. */
const ownName = (el: Element): string => (["checkbox", "switch", "radio"].includes(widgetRole(el)) ? cleanLabel(textOf(el)) : "");

function fieldLabel(el: Element, ctx: Ctx): string {
  const byFor = labelFor(el, ctx);
  if (byFor && labelText(byFor)) return labelText(byFor);
  const wrap = el.closest("label");
  if (wrap && labelText(wrap)) return labelText(wrap);
  return (
    accessibleName(el) ||
    ownName(el) ||
    nearbyText(wrap ?? el) ||
    cleanLabel(attr(el, "placeholder")) ||
    cleanLabel(attr(el, "title")) ||
    attr(el, "name")
  );
}

function optionLabel(el: Element, ctx: Ctx): string {
  const byFor = labelFor(el, ctx);
  if (byFor && labelText(byFor)) return labelText(byFor);
  const wrap = el.closest("label");
  if (wrap && labelText(wrap)) return labelText(wrap);
  const aria = accessibleName(el);
  if (aria) return aria;
  if (widgetRole(el)) return ownName(el) || attr(el, "data-value") || attr(el, "value");
  let sib: Node | null = el.nextSibling;
  while (sib && sib.nodeType === 3 && !collapse(sib.nodeValue ?? "")) sib = sib.nextSibling;
  if (sib && sib.nodeType === 3) return cleanLabel(sib.nodeValue ?? "");
  if (sib && sib.nodeType === 1 && !(sib as Element).matches(CONTROL_SELECTOR) && textOf(sib)) return cleanLabel(textOf(sib));
  return attr(el, "value");
}

function hintOf(el: Element): string {
  const describedBy = attr(el, "aria-describedby");
  if (describedBy) {
    const t = collapse(textOfIds(el, describedBy));
    if (t) return t;
  }
  const anchor = el.closest("label") ?? el;
  const next = anchor.nextElementSibling;
  if (next && !isHidden(next) && !isError(next) && tag(next) !== "label" && !next.matches(CONTROL_SELECTOR) && !next.querySelector(CONTROL_SELECTOR)) {
    const cls = `${attr(next, "class")} ${attr(next, "id")}`;
    if (tag(next) === "small" || HINT_RE.test(cls)) return textOf(next);
  }
  return "";
}

/** True when every field inside `box` is one of `members`. */
const holdsOnly = (box: Element, members: Set<Element>, controls: Control[]): boolean =>
  controls.filter((c) => box.contains(c.el)).every((c) => members.has(c.el));

function groupLabel(members: Element[], controls: Control[]): { label: string; usedLegend?: string } {
  const first = members[0] as Element;
  const set = new Set(members);
  const fieldset = first.closest("fieldset");
  if (fieldset) {
    const lg = Array.from(fieldset.children).find((c) => tag(c) === "legend");
    if (lg && holdsOnly(fieldset, set, controls)) {
      const text = cleanLabel(textOf(lg));
      if (text) return { label: text, usedLegend: text };
    }
  }
  const grp = first.closest('[role="radiogroup"], [role="group"]');
  if (grp) {
    const n = accessibleName(grp);
    if (n) return { label: n };
  }
  const near = nearbyText(first.closest("label") ?? first);
  return { label: near || attr(first, "name") };
}

// ---------------------------------------------------------------- dates split into day, month and year

const PARTS: DatePart[] = ["day", "month", "year"];
/** Words that name a date part, in the languages of the corridor and their neighbours, folded (no diacritics). */
const PART_WORDS: Record<DatePart, Set<string>> = {
  day: new Set(["day", "dd", "den", "dag", "tag", "tt", "jour", "jj", "dia", "giorno", "gg", "dzien", "день"]),
  month: new Set(["month", "mm", "mesic", "monat", "mois", "mes", "mese", "miesiac", "maand", "місяць", "месяц"]),
  year: new Set(["year", "yyyy", "yy", "rok", "rrrr", "rr", "jahr", "jjjj", "annee", "ano", "anno", "aaaa", "jaar", "rik", "рік", "год"]),
};
const words = (s: string): string[] => fold(s.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const partsIn = (s: string): Set<DatePart> => new Set(words(s).flatMap((w) => PARTS.filter((p) => PART_WORDS[p].has(w))));
const onlyPartWords = (s: string): boolean => {
  const w = words(s);
  return w.length > 0 && w.every((x) => PARTS.some((p) => PART_WORDS[p].has(x)));
};

/** The date part one control holds, from its own id, name, aria-label, placeholder and title, then its label; a
 *  select also by its options (12 months, 28-31 days, four-digit years). "" when unclear. */
function partOf(el: Element, ctx: Ctx): DatePart | "" {
  const own = ["id", "name", "aria-label", "placeholder", "title"].map((a) => attr(el, a)).join(" ");
  const lab = labelFor(el, ctx);
  const wrap = el.closest("label");
  for (const text of [own, `${lab ? labelText(lab) : ""} ${wrap ? labelText(wrap) : ""}`]) {
    const found = partsIn(text);
    if (found.size === 1) return [...found][0] as DatePart;
  }
  if (tag(el) === "select") {
    const vals = Array.from((el as HTMLSelectElement).options).map((o) => o.value).filter((v) => v !== "");
    if (vals.length === 12) return "month";
    if (vals.length >= 28 && vals.length <= 31) return "day";
    if (vals.length && vals.every((v) => /^\d{4}$/.test(v))) return "year";
  }
  return "";
}

function commonBox(els: Element[]): Element | null {
  for (let el = (els[0] as Element).parentElement; el; el = el.parentElement) if (els.every((e) => el.contains(e))) return el;
  return null;
}

const PIECE_KINDS = new Set<FieldKind>(["text", "number", "tel", "select"]);

/** Three adjacent controls that hold a day, a month and a year, alone in their container: one date field. */
function dateGroups(controls: Control[], ctx: Ctx): Map<Element, { els: Element[]; parts: DatePart[] }> {
  const out = new Map<Element, { els: Element[]; parts: DatePart[] }>();
  for (let i = 0; i + 2 < controls.length; i++) {
    const trio = controls.slice(i, i + 3).map((c) => c.el);
    if (!trio.every((el) => !widgetRole(el) && !inputCombobox(el) && PIECE_KINDS.has(kindOf(el)))) continue;
    const parts = trio.map((el) => partOf(el, ctx));
    const unknown = parts.indexOf("");
    if (unknown >= 0 && parts.filter((p) => !p).length === 1 && !parts.includes("year") && attr(trio[unknown] as Element, "maxlength") === "4") {
      parts[unknown] = "year";
    }
    if (parts.includes("") || new Set(parts).size !== 3) continue;
    const box = commonBox(trio);
    if (!box || !holdsOnly(box, new Set(trio), controls)) continue;
    out.set(trio[0] as Element, { els: trio, parts: parts as DatePart[] });
    i += 2;
  }
  return out;
}

/** The label of a split date: its fieldset's legend or group's name when they hold only the pieces, else the first
 *  piece's label unless that label only says "Day". */
function dateLabel(els: Element[], controls: Control[], ctx: Ctx): { label: string; usedLegend?: string } {
  const set = new Set(els);
  const first = els[0] as Element;
  const fieldset = first.closest("fieldset");
  const lg = fieldset ? Array.from(fieldset.children).find((c) => tag(c) === "legend") : undefined;
  if (fieldset && lg && holdsOnly(fieldset, set, controls)) {
    const text = cleanLabel(textOf(lg));
    if (text) return { label: text, usedLegend: text };
  }
  const grp = first.closest('[role="group"]');
  if (grp && holdsOnly(grp, set, controls)) {
    const n = accessibleName(grp);
    if (n) return { label: n };
  }
  const lab = labelFor(first, ctx) ?? first.closest("label");
  const box = commonBox(els);
  for (const t of [lab ? labelText(lab) : "", accessibleName(first), box ? nearbyText(box) : "", nearbyText(first)]) {
    if (t && !onlyPartWords(t)) return { label: t };
  }
  return { label: attr(first, "name") };
}

// ---------------------------------------------------------------- bindings

/** Find the fields of one form (or form-like region). */
export function buildBindings(scope: Element): FieldBinding[] {
  const outer = isError;
  isError = errorElements();
  try {
    return bindingsOf(scope);
  } finally {
    isError = outer;
  }
}

function bindingsOf(scope: Element): FieldBinding[] {
  const ctx: Ctx = { labels: new WeakMap() };
  const all = gather(scope).filter((c) => isControlKept(c.el));
  // A listbox a combobox opens is that combobox's list, not a field of its own.
  const owned = new Set<Element>();
  for (const c of all) {
    if (widgetRole(c.el) === "combobox" || inputCombobox(c.el)) {
      const lb = listboxOf(c.el);
      if (lb) owned.add(lb);
    }
  }
  const controls = all.filter((c) => !owned.has(c.el));
  const dates = dateGroups(controls, ctx);
  const nameCount = new Map<string, number>();
  for (const c of controls) {
    if (widgetRole(c.el)) continue;
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

  interface Extra {
    options?: FieldOption[];
    usedLegend?: string;
    /** The one control whose placeholder, pattern and maxlength describe the field. */
    single?: Element;
    via?: FieldBinding["via"];
    parts?: DatePart[];
    /** Elements whose required flag counts (a radiogroup carries aria-required for its radios). */
    requiredBy?: Element[];
  }
  const add = (c: Control, members: Element[], idBase: string, kind: FieldKind, label: string, x: Extra = {}): void => {
    members.forEach((m) => done.add(m));
    const section = [...c.legends].reverse().find((l) => l && l !== x.usedLegend) || c.heading || undefined;
    const field: FieldStructure = { fieldId: uniqueId(idBase), kind, label, required: (x.requiredBy ?? members).some(isRequired) };
    if (x.options && x.options.length) field.options = x.options;
    const one = x.single;
    if (one) {
      const placeholder = collapse(attr(one, "placeholder"));
      if (placeholder) field.placeholder = placeholder;
      const pattern = attr(one, "pattern");
      if (pattern) field.pattern = pattern;
      const max = parseInt(attr(one, "maxlength"), 10);
      if (Number.isFinite(max) && max > 0) field.maxLength = max;
    }
    const hint = hintOf(one ?? (members[members.length - 1] as Element));
    if (hint) field.hint = hint;
    if (section) field.section = section;
    const b: FieldBinding = { field, els: members };
    if (x.via) b.via = x.via;
    if (x.parts) b.parts = x.parts;
    bindings.push(b);
  };
  const itemOptions = (members: Element[]): FieldOption[] =>
    members.map((m) => {
      const label = optionLabel(m, ctx);
      return { value: itemValue(m, label), label };
    });

  for (const c of controls) {
    if (done.has(c.el)) continue;
    const el = c.el;
    const date = dates.get(el);
    if (date) {
      const g = dateLabel(date.els, controls, ctx);
      add(c, date.els, attr(el, "id") || attr(el, "name"), "date", g.label, { usedLegend: g.usedLegend, via: "date", parts: date.parts });
      continue;
    }

    const role = widgetRole(el);
    if (role === "radio") {
      const grp = el.closest("[role=radiogroup]") ?? el.parentElement;
      const groupOf = (e: Element): Element | null => e.closest("[role=radiogroup]") ?? e.parentElement;
      const members = controls.filter((o) => !done.has(o.el) && widgetRole(o.el) === "radio" && groupOf(o.el) === grp).map((o) => o.el);
      const g = groupLabel(members, controls);
      add(c, members, (grp && attr(grp, "id")) || attr(el, "id"), "radio", g.label, {
        options: itemOptions(members), usedLegend: g.usedLegend, via: "aria", requiredBy: grp ? [...members, grp] : members,
      });
      continue;
    }
    if (role === "checkbox") {
      const box = el.closest('[role="group"], fieldset');
      const members = box
        ? controls.filter((o) => !done.has(o.el) && widgetRole(o.el) === "checkbox" && o.el.closest('[role="group"], fieldset') === box).map((o) => o.el)
        : [el];
      if (members.length > 1 && box) {
        const g = groupLabel(members, controls);
        add(c, members, attr(box, "id") || attr(el, "id"), "checkbox", g.label, {
          options: itemOptions(members), usedLegend: g.usedLegend, via: "aria", requiredBy: [...members, box],
        });
      } else {
        add(c, [el], attr(el, "id"), "checkbox", fieldLabel(el, ctx), { via: "aria" });
      }
      continue;
    }
    if (role === "switch") {
      add(c, [el], attr(el, "id"), "checkbox", fieldLabel(el, ctx), { via: "aria" });
      continue;
    }
    if (role === "combobox") {
      add(c, [el], attr(el, "id"), "select", fieldLabel(el, ctx), { options: listOptions(listboxOf(el)), via: "combobox" });
      continue;
    }
    if (role === "listbox") {
      const multi = attr(el, "aria-multiselectable").toLowerCase() === "true";
      add(c, [el], attr(el, "id"), multi ? "checkbox" : "select", fieldLabel(el, ctx), { options: listOptions(el), via: "listbox" });
      continue;
    }

    const name = attr(el, "name");
    if (inputCombobox(el)) {
      // The options are read only while the box is empty: once something is typed, a suggestion list may repeat it,
      // and a typed value never goes into the structure.
      const options = (el as HTMLInputElement).value === "" ? listOptions(listboxOf(el)) : [];
      add(c, [el], attr(el, "id") || name, "select", fieldLabel(el, ctx), { options, single: el, via: "combobox" });
      continue;
    }
    const kind = kindOf(el);
    const type = attr(el, "type").toLowerCase();
    const grouped = (kind === "radio" || kind === "checkbox") && !!name && (kind === "radio" || (nameCount.get(`${type}:${name}`) ?? 0) > 1);
    if (grouped) {
      const members = controls
        .filter((o) => !widgetRole(o.el) && attr(o.el, "type").toLowerCase() === type && attr(o.el, "name") === name)
        .map((o) => o.el);
      const g = groupLabel(members, controls);
      add(c, members, name, kind, g.label, {
        options: members.map((m) => ({ value: attr(m, "value") || "on", label: optionLabel(m, ctx) })),
        usedLegend: g.usedLegend,
      });
      continue;
    }
    let options: FieldOption[] | undefined;
    if (kind === "select") {
      options = Array.from(el.querySelectorAll("option"))
        .map((o) => ({ value: o.hasAttribute("value") ? attr(o, "value") : textOf(o), label: textOf(o) }))
        .filter((o) => o.value !== "");
    }
    add(c, [el], attr(el, "id") || name, kind, fieldLabel(el, ctx), { options, single: el });
  }
  return bindings;
}

// ---------------------------------------------------------------- forms across shadow roots and frames

/** Elements matching `sel` in `root` and in every open shadow root under it. */
function deepQuery(root: Document | ShadowRoot, sel: string): Element[] {
  const out = Array.from(root.querySelectorAll(sel));
  for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) out.push(...deepQuery(el.shadowRoot, sel));
  return out;
}

/** This document and its same-origin frames, recursively, visible frames only. A cross-origin frame cannot be read
 *  (its contentDocument is null, or reading it throws) and is skipped without a sound. */
function documentsOf(doc: Document, depth = 0, seen = new Set<Document>()): Document[] {
  if (seen.has(doc)) return [];
  seen.add(doc);
  const out = [doc];
  if (depth >= 3) return out;
  for (const frame of deepQuery(doc, "iframe, frame")) {
    if (blocked(frame)) continue;
    let inner: Document | null = null;
    try {
      inner = (frame as HTMLIFrameElement).contentDocument;
      if (inner && !inner.documentElement) inner = null;
    } catch {
      inner = null;
    }
    if (inner) out.push(...documentsOf(inner, depth + 1, seen));
  }
  return out;
}

interface FormScope {
  scope: Element;
  bindings: FieldBinding[];
}

/**
 * The fillable forms of the page, in order, each with its fields: the top document's first, then each same-origin
 * frame's. Forms in navigation, headers, footers, asides and banners are skipped. A document with no form at all
 * offers its body when that holds two fields or more. Field ids are unique within a form, and a frame's field never
 * reuses an id that a form of another document already has.
 */
function formScopes(doc: Document): FormScope[] {
  const out: FormScope[] = [];
  const taken = new Map<string, Document>();
  for (const d of documentsOf(doc)) {
    const forms = deepQuery(d, "form").filter((f) => !blocked(f));
    let found = forms.map((scope) => ({ scope, bindings: buildBindings(scope) })).filter((s) => s.bindings.length > 0);
    if (!forms.length && d.body) {
      const b = buildBindings(d.body);
      if (b.length >= 2) found = [{ scope: d.body, bindings: b }];
    }
    for (const s of found) {
      const own = new Set(s.bindings.map((b) => b.field.fieldId));
      for (const b of s.bindings) {
        const owner = taken.get(b.field.fieldId);
        if (owner && owner !== d) {
          let id = b.field.fieldId;
          for (let n = 2; taken.has(id) || own.has(id); n++) id = `${b.field.fieldId}_${n}`;
          own.add(id);
          b.field.fieldId = id;
        }
        taken.set(b.field.fieldId, d);
      }
    }
    out.push(...found);
  }
  return out;
}

/** The fillable forms of a page, in order (see formScopes). A scope may live in a shadow root or a frame. */
export function listForms(doc: Document): Element[] {
  return formScopes(doc).map((s) => s.scope);
}

export async function extractForm(doc: Document, url: string, formIndex = 0): Promise<FormStructure> {
  const s = formScopes(doc)[formIndex];
  const fields = s ? s.bindings.map((b) => b.field) : [];
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
  return boundForm(doc, structure).map;
}

/** The form whose fields overlap the structure most, with its bindings by field id. */
function boundForm(doc: Document, structure: FormStructure): { scope: Element | null; map: Map<string, FieldBinding> } {
  const want = new Set(structure.fields.map((f) => f.fieldId));
  let best: FieldBinding[] = [];
  let scope: Element | null = null;
  let bestScore = 0;
  for (const s of formScopes(doc)) {
    const score = s.bindings.filter((x) => want.has(x.field.fieldId)).length;
    if (score > bestScore) {
      best = s.bindings;
      scope = s.scope;
      bestScore = score;
    }
  }
  const map = new Map(best.map((b) => [b.field.fieldId, b]));
  // A combobox's options are read only while it is empty; once filled, the structure the caller holds still has them.
  for (const f of structure.fields) {
    const b = map.get(f.fieldId);
    if (b && !b.field.options && f.options?.length) b.field = { ...b.field, options: f.options };
  }
  return { scope, map };
}

/** Reads each field as a string. Radio: the checked option's value. Checkbox group: checked values joined by ",".
 *  Single checkbox: "true" or "false". A split date: YYYY-MM-DD once all three parts hold a number. Empty fields
 *  are omitted. Device-only. */
export function readValues(doc: Document, structure: FormStructure): FormValues {
  const bound = bindStructure(doc, structure);
  const out: FormValues = {};
  for (const f of structure.fields) {
    const b = bound.get(f.fieldId);
    if (!b) continue;
    const v = readOne(b);
    if (v !== "") out[f.fieldId] = v;
  }
  return out;
}

/**
 * The validation errors the page shows now for the structure's form: per field (by ARIA link, beside the field, or the
 * browser's own check of a native constraint) and for the form as a whole (an error summary). Read through the same
 * bindings as writing, so ARIA widgets, shadow roots and same-origin frames are reached. VALUES CLASS, device-only like
 * readValues: an error can repeat what the person typed. See FormErrors and errors.ts.
 */
export function readErrors(doc: Document, structure: FormStructure): FormErrors {
  const { scope, map } = boundForm(doc, structure);
  if (!scope) return { fields: {}, form: [] };
  const bindings = structure.fields.map((f) => map.get(f.fieldId)).filter((b): b is FieldBinding => !!b);
  return errorsOf(scope, bindings);
}

/** Writes values into the original fields the way a person would reach them (native setter with input + change, a
 *  real click on choices, key-level typing for masks that take keystrokes only, choosing a combobox's option), then
 *  reads each one back. `written` lists only the fields the page confirmed; everything else is `failed`. */
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
