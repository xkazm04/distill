// Validation errors a page shows. A message can repeat what the person typed ("'jan@' není platný e-mail"), so the
// text of an error is in the values class (CLAUDE.md law): page and form extraction leave error elements out, so their
// text never reaches a PageModel, a FormStructure, a cloud-eligible prompt or the person's agent. Only `errorsOf`
// (form.ts readErrors) reads them, into the device-only FormErrors.
import type { FieldError, FieldErrorSource, FormErrors } from "./types.js";
import type { FieldBinding } from "./form.js";
import { attr, byId, collapse, isNoise, parentOf, tag, textOf } from "./dom.js";
import { FIELDISH, hiddenUp, listboxOf } from "./aria.js";

/** Words in a class, id or tag that name an error message: "error", "govuk-error-message", "invalid-feedback",
 *  "mat-error", "chyba" (Czech). camelCase is split first, so "errorText" counts. */
const ERROR_WORD = /(^|[\s_-])(error|errors|err|invalid|chyba|chyby)([\s_-]|$)/i;
const HINT_WORD = /(^|[\s_-])(hint|help|helper|description|form-text|note)([\s_-]|$)/i;
/** Longer than this, an element is a section of the page (a docs page's "Errors" chapter), not a message. */
const MESSAGE_MAX = 1000;

/** A cheap first look: without one of these letters in its class, id or tag, no error word can be there (splitting
 *  camelCase only adds spaces). Saves a huge page the camelCase split on each of its thousands of elements. */
const ERROR_LETTERS = /err|invalid|chyb/i;

const words = (el: Element): string => `${attr(el, "class")} ${attr(el, "id")} ${tag(el)}`.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2");

/** aria-invalid is set and is not "false" ("true", "grammar" and "spelling" all mean invalid). */
export function isInvalid(el: Element): boolean {
  const v = attr(el, "aria-invalid").trim().toLowerCase();
  return v !== "" && v !== "false";
}

/** Help text by its own markup: a <small>, or a hint word in its class or id. */
export const hintLike = (el: Element): boolean => tag(el) === "small" || HINT_WORD.test(`${attr(el, "class")} ${attr(el, "id")}`);

/**
 * An element that looks like an error message by its own markup: role=alert, or an error word in its class, id or tag.
 * It holds no field (a wrapper marked "has-error" holds the field and its label, and is not the message) and is
 * message-sized.
 */
export function looksLikeError(el: Element): boolean {
  if (attr(el, "role").trim().toLowerCase() !== "alert"
    && (!ERROR_LETTERS.test(`${attr(el, "class")} ${attr(el, "id")} ${tag(el)}`) || !ERROR_WORD.test(words(el)))) return false;
  if (el.matches(FIELDISH) || el.querySelector(FIELDISH)) return false;
  return collapse(el.textContent ?? "").length <= MESSAGE_MAX;
}

/** The elements an ARIA attribute of `el` names, in its own tree. */
export function named(el: Element, name: string): Element[] {
  return attr(el, name).split(/\s+/).filter(Boolean).map((id) => byId(el, id)).filter((e): e is Element => !!e);
}

/**
 * The error messages a field links to: its aria-errormessage targets, and while it is aria-invalid, what its
 * aria-describedby names - the targets that look like errors, else every one that is not help text.
 */
export function linkedErrors(el: Element): Element[] {
  const out = named(el, "aria-errormessage");
  if (isInvalid(el)) {
    const described = named(el, "aria-describedby");
    const marked = described.filter(looksLikeError);
    out.push(...(marked.length ? marked : described.filter((d) => !hintLike(d))));
  }
  return out;
}

/**
 * "Is this element an error message?" for one reading of a page (built fresh per reading: the page changes between
 * them). An element linked from a field as its error always is. With `looks`, so is an element that looks like one
 * (see looksLikeError); page extraction passes it when the page holds a form, so a docs page keeps its text.
 */
export function errorElements(looks = true): (el: Element) => boolean {
  const linked = new WeakMap<Node, Set<Element>>();
  const linkedIn = (root: Node & ParentNode): Set<Element> => {
    let set = linked.get(root);
    if (!set) {
      set = new Set();
      for (const el of Array.from(root.querySelectorAll?.("[aria-errormessage], [aria-invalid][aria-describedby]") ?? [])) {
        for (const t of linkedErrors(el)) set.add(t);
      }
      linked.set(root, set);
    }
    return set;
  };
  return (el) => (looks && looksLikeError(el)) || linkedIn(el.getRootNode() as Node & ParentNode).has(el);
}

// ---------------------------------------------------------------- reading them (device-only: FormErrors)

/** A longer message is cut: the person can read the whole of it on the page. */
const TEXT_MAX = 500;
/** Where the search beside a field stops: the next field's label, a heading. */
const STOP = "label, legend, h1, h2, h3, h4, h5, h6";

const cut = (t: string): string => (t.length > TEXT_MAX ? t.slice(0, TEXT_MAX) + "..." : t);

/** Shown on the page now: no hiding attribute up the tree (across shadow roots), and rendered where the browser can
 *  say (a page often keeps its messages in the markup and shows them with CSS). */
export function shownNow(el: Element): boolean {
  if (!el.isConnected || hiddenUp(el)) return false;
  const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  try {
    return typeof check === "function" ? check.call(el, { visibilityProperty: true }) : true;
  } catch {
    return true;
  }
}

/** Distinct texts in order; a text inside another one is the same message. */
function distinct(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) if (t && !out.some((o) => o.includes(t) || t.includes(o))) out.push(t);
  return out;
}

/** The group element around a set of choices (a radiogroup, a group, a fieldset), where the ARIA may sit instead. */
function groupOf(b: FieldBinding): Element | null {
  if (b.els.length < 2 && b.field.kind !== "radio") return null;
  const g = (b.els[0] as Element).closest("[role=radiogroup], [role=group], fieldset");
  return g && b.els.every((e) => g.contains(e)) ? g : null;
}

/** The widest wrapper of the field that holds no other field: at most four levels up, never the form itself. */
function boxOf(b: FieldBinding): Element {
  const own = [...b.els, ...b.els.map(listboxOf).filter((e): e is Element => !!e)];
  const mine = (box: Element): boolean =>
    Array.from(box.querySelectorAll(FIELDISH)).every(
      (f) => (tag(f) === "input" && attr(f, "type").toLowerCase() === "hidden") || own.some((o) => o === f || o.contains(f) || f.contains(o)),
    );
  let cur = b.els[0] as Element;
  while (!b.els.every((x) => cur.contains(x))) {
    const up = parentOf(cur);
    if (!up) break;
    cur = up;
  }
  for (let depth = 0; depth < 4; depth++) {
    const up = parentOf(cur);
    if (!up || ["form", "body", "html"].includes(tag(up)) || !mine(up)) break;
    cur = up;
  }
  return cur;
}

/** True when an element between `e` and `stop` looks like an error: `e` is part of that message. */
function insideMessage(e: Element, stop: Element): boolean {
  for (let p = e.parentElement; p && p !== stop; p = p.parentElement) if (looksLikeError(p)) return true;
  return false;
}

/** The messages under `el` (or `el` itself), outermost only. */
function messagesIn(el: Element): Element[] {
  if (looksLikeError(el)) return [el];
  return Array.from(el.querySelectorAll("*")).filter((e) => looksLikeError(e) && !insideMessage(e, el));
}

/** Messages in up to three element siblings on one side of `box`, until another field, a label or a heading. */
function besides(box: Element, dir: "next" | "previous"): Element[] {
  const out: Element[] = [];
  let sib = dir === "next" ? box.nextElementSibling : box.previousElementSibling;
  for (let n = 0; sib && n < 3; n++) {
    if (sib.matches(STOP) || sib.matches(FIELDISH) || sib.querySelector(FIELDISH)) break;
    out.push(...messagesIn(sib));
    sib = dir === "next" ? sib.nextElementSibling : sib.previousElementSibling;
  }
  return out;
}

/**
 * The browser's own message for a native constraint the value breaks (format, length, range, pattern, or the page's
 * setCustomValidity). An empty required field alone does not count: the guide marks it required, and the browser says
 * so only on a submit. A form marked novalidate checks itself, so the native state is not what it shows.
 */
function nativeMessage(b: FieldBinding): string {
  for (const el of b.els) {
    const c = el as HTMLInputElement;
    if (!["input", "select", "textarea"].includes(tag(el)) || !c.validity || c.willValidate === false) continue;
    if (el.closest("form")?.hasAttribute("novalidate")) continue;
    const v = c.validity;
    const broken = v.customError || v.typeMismatch || v.patternMismatch || v.tooLong || v.tooShort || v.rangeOverflow || v.rangeUnderflow || v.stepMismatch || v.badInput;
    if (v.valid || !broken) continue;
    const m = collapse(c.validationMessage ?? "");
    if (m) return cut(m);
  }
  return "";
}

/** True when the element or an ancestor (across shadow roots) is navigation, a header or footer, an aside or a dialog. */
function inNoise(el: Element): boolean {
  for (let cur: Element | null = el; cur; cur = parentOf(cur)) if (isNoise(cur)) return true;
  return false;
}

/** Every element of a document and of its open shadow roots. */
function allIn(root: Document | ShadowRoot): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    out.push(el);
    if (el.shadowRoot) out.push(...allIn(el.shadowRoot));
  }
  return out;
}

/**
 * The errors a form shows now, read through the bindings writing uses, so ARIA widgets, shadow roots and frames are
 * reached. Per field, the first of: what it links to by ARIA; a message inside its own wrapper; one just after it; one
 * just before it (each message goes to one field only); else the browser's message for a native constraint. Visible
 * messages no field claims are the form's (an error summary: its list items one by one), less those that only repeat
 * a field's. Device-only: see FormErrors.
 */
export function errorsOf(scope: Element, bindings: FieldBinding[]): FormErrors {
  const claimed = new Set<Element>();
  const found = new Map<string, FieldError>();
  const pass = (source: FieldErrorSource, pick: (b: FieldBinding) => Element[]): void => {
    for (const b of bindings) {
      if (found.has(b.field.fieldId)) continue;
      const els = pick(b).filter((e) => !claimed.has(e) && shownNow(e));
      const texts = distinct(els.map((e) => cut(textOf(e))));
      if (!texts.length) continue;
      els.forEach((e) => claimed.add(e));
      found.set(b.field.fieldId, { text: texts.join(" "), source });
    }
  };
  pass("aria", (b) => {
    const g = groupOf(b);
    return [...b.els, ...(g ? [g] : [])].flatMap(linkedErrors);
  });
  pass("nearby", (b) => {
    const box = boxOf(b);
    return Array.from(box.querySelectorAll("*")).filter((e) => looksLikeError(e) && !insideMessage(e, box));
  });
  pass("nearby", (b) => besides(boxOf(b), "next"));
  pass("nearby", (b) => besides(boxOf(b), "previous"));

  const fields: Record<string, FieldError> = {};
  for (const b of bindings) {
    const id = b.field.fieldId;
    const page = found.get(id);
    const native = page ? "" : nativeMessage(b);
    if (page) fields[id] = page;
    else if (native) fields[id] = { text: native, source: "native" };
  }

  // The form's own: visible messages in the form's document (and its shadow roots) that no field claimed, outside any
  // other form and outside navigation and the like. The outermost holds the rest.
  const touches = (e: Element): boolean => [...claimed].some((c) => c === e || c.contains(e) || e.contains(c));
  const loose = allIn(scope.ownerDocument).filter((e) => {
    if (!looksLikeError(e) || touches(e) || !shownNow(e) || inNoise(e)) return false;
    const f = e.closest("form");
    return !f || f === scope || f.contains(scope);
  });
  const outer = loose.filter((e) => !loose.some((o) => o !== e && o.contains(e)));
  const fieldTexts = Object.values(fields).map((f) => f.text);
  const form = distinct(
    outer.flatMap((e) => {
      const items = Array.from(e.querySelectorAll("li")).filter(shownNow);
      return (items.length ? items : [e]).map((x) => cut(textOf(x)));
    }),
  ).filter((t) => !fieldTexts.some((f) => f.includes(t) || t.includes(f)));
  return { fields, form };
}
