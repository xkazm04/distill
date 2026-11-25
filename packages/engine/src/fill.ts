// Writing a field into the page and reading it back. The rule: a field is reported written only when the page,
// read back afterwards, holds what was meant (a mask may lay the characters out its own way). When the engine cannot
// confirm a write it reports the field failed, so the person is told to fill that one by hand; never the reverse.
import type { DatePart, FieldBinding } from "./form.js";
import type { FieldOption, FieldStructure } from "./types.js";
import { attr, collapse, fold, tag, textOf } from "./dom.js";
import { hiddenUp, isOn, itemValue, listboxOf, optionEls, optionText } from "./aria.js";

const TRUE_RE = /^(true|yes|y|1|on|checked|ano)$/i;
const splitList = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------- the element's own properties and events

/** The prototype's accessor, past any instance-level patch a framework puts on the element (React's value tracker). */
function accessor(el: Element, prop: "value" | "checked"): PropertyDescriptor | undefined {
  let proto: object | null = Object.getPrototypeOf(el);
  while (proto) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (d?.set || d?.get) return d;
    proto = Object.getPrototypeOf(proto);
  }
  return undefined;
}

function nativeSet(el: Element, prop: "value" | "checked", v: string | boolean): void {
  const d = accessor(el, prop);
  if (d?.set) d.set.call(el, v);
  else (el as unknown as Record<string, unknown>)[prop] = v;
}

function nativeGet(el: Element, prop: "value" | "checked"): unknown {
  const d = accessor(el, prop);
  return d?.get ? d.get.call(el) : (el as unknown as Record<string, unknown>)[prop];
}

const valueOf = (el: Element): string => String(nativeGet(el, "value") ?? "");
const checkedOf = (el: Element): boolean => nativeGet(el, "checked") === true;

type Ctor = new (type: string, init?: Record<string, unknown>) => Event;

/** Dispatches an event built in the element's own window (frames have their own), bubbling and composed so it
 *  leaves a shadow root as a real one does. Returns false when a listener cancelled it. */
function dispatch(el: Element, type: string, kinds: string[], init: Record<string, unknown> = {}): boolean {
  const w = el.ownerDocument.defaultView as unknown as Record<string, Ctor | undefined> | null;
  const g = globalThis as unknown as Record<string, Ctor | undefined>;
  const names = [...kinds, "Event"];
  const E = names.map((k) => w?.[k]).find(Boolean) ?? names.map((k) => g[k]).find(Boolean) ?? (Event as unknown as Ctor);
  return el.dispatchEvent(new E(type, { bubbles: true, composed: true, ...init }));
}

function fire(el: Element): void {
  dispatch(el, "input", []);
  dispatch(el, "change", []);
}

/** A person's click on a widget: pointer and mouse down and up, then the click. */
function press(el: Element): void {
  dispatch(el, "pointerdown", ["PointerEvent", "MouseEvent"], { cancelable: true, button: 0 });
  dispatch(el, "mousedown", ["MouseEvent"], { cancelable: true, button: 0 });
  dispatch(el, "pointerup", ["PointerEvent", "MouseEvent"], { cancelable: true, button: 0 });
  dispatch(el, "mouseup", ["MouseEvent"], { cancelable: true, button: 0 });
  const h = el as HTMLElement;
  if (typeof h.click === "function") h.click();
  else dispatch(el, "click", ["MouseEvent"], { cancelable: true, button: 0 });
}

const focus = (el: Element): void => (el as HTMLElement).focus?.();

// ---------------------------------------------------------------- text, with masks

/** The characters that carry meaning: letters and digits, in lower case. Spaces, dots, slashes and dashes are a
 *  mask's layout, so "120 00" holds "12000". */
const meaningful = (s: string): string => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** True when `actual` holds `want`: the same meaningful characters, or the mask's fixed part (what the field shows
 *  when emptied, such as "+420 ") followed by them. A value with no letter or digit must match exactly. */
function holds(actual: string, want: string, fixed = ""): boolean {
  const w = meaningful(want);
  if (!w) return collapse(actual) === collapse(want);
  const a = meaningful(actual);
  return a === w || (!!meaningful(fixed) && a === meaningful(fixed) + w);
}

/** `want` without a leading copy of the mask's fixed part ("+420 777..." typed into a "+420 " mask). */
function afterFixed(want: string, fixed: string): string {
  const f = meaningful(fixed);
  if (!f) return want;
  let acc = "";
  for (let i = 0; i < want.length; i++) {
    acc += meaningful(want[i] as string);
    if (acc === f) return want.slice(i + 1).replace(/^\s+/, "");
    if (!f.startsWith(acc)) return want;
  }
  return want;
}

/** Key-level typing at the end of the field, for masks that take keystrokes only. `finish` sends change and blur. */
function typeKeys(el: Element, text: string, finish = true): void {
  focus(el);
  for (const ch of text) {
    if (dispatch(el, "keydown", ["KeyboardEvent"], { key: ch, cancelable: true })) {
      const cur = valueOf(el);
      const max = (el as HTMLInputElement).maxLength;
      const full = typeof max === "number" && max > 0 && cur.length >= max;
      if (!full && dispatch(el, "beforeinput", ["InputEvent"], { data: ch, inputType: "insertText", cancelable: true })) {
        nativeSet(el, "value", cur + ch);
        dispatch(el, "input", ["InputEvent"], { data: ch, inputType: "insertText" });
      }
    }
    dispatch(el, "keyup", ["KeyboardEvent"], { key: ch });
  }
  if (finish) {
    dispatch(el, "change", []);
    (el as HTMLElement).blur?.();
  }
}

/** Empties the field with Backspace as a person would. Returns what is left: a mask's fixed part, or "". */
function clearByKeys(el: Element): string {
  focus(el);
  for (let n = valueOf(el).length + 2; n > 0 && valueOf(el) !== ""; n--) {
    const before = valueOf(el);
    if (
      dispatch(el, "keydown", ["KeyboardEvent"], { key: "Backspace", cancelable: true }) &&
      dispatch(el, "beforeinput", ["InputEvent"], { inputType: "deleteContentBackward", cancelable: true })
    ) {
      nativeSet(el, "value", valueOf(el).slice(0, -1));
      dispatch(el, "input", ["InputEvent"], { inputType: "deleteContentBackward" });
    }
    dispatch(el, "keyup", ["KeyboardEvent"], { key: "Backspace" });
    if (valueOf(el) === before) break; // the page keeps this part: a fixed prefix
  }
  return valueOf(el);
}

/** Puts back what the field held before a write that could not be confirmed; key by key when the page keeps its own
 *  buffer (a keystroke-only mask whose content the Backspaces emptied). Best effort: a page may still refuse. */
function restore(el: Element, before: string): void {
  if (valueOf(el) === before) return;
  nativeSet(el, "value", before);
  fire(el);
  if (valueOf(el) === before || tag(el) === "select") return;
  const fixed = clearByKeys(el);
  typeKeys(el, afterFixed(before, fixed));
}

/** Empties a text field. Confirmed when nothing meaningful is left, or only what the page itself starts it with. */
function clearText(el: Element): boolean {
  nativeSet(el, "value", "");
  fire(el);
  const now = meaningful(valueOf(el));
  return now === "" || now === meaningful(String((el as HTMLInputElement).defaultValue ?? ""));
}

/** Native setter and input + change first; when the page does not keep it, Backspace and key-level typing; when that
 *  does not hold either, the field is put back as it was and the write fails. */
function writeText(el: Element, want: string, same: (actual: string, fixed: string) => boolean = (a, f) => holds(a, want, f)): boolean {
  if (want === "") return clearText(el);
  const before = valueOf(el);
  nativeSet(el, "value", want);
  fire(el);
  if (same(valueOf(el), "")) return true;
  const fixed = clearByKeys(el);
  typeKeys(el, afterFixed(want, fixed));
  if (same(valueOf(el), fixed)) return true;
  restore(el, before);
  return false;
}

// ---------------------------------------------------------------- choices

/** The element of a choice group that `value` names: by its value, or by its option's label (any case). */
function pick(els: Element[], options: FieldOption[] | undefined, value: string, own: (el: Element, i: number) => string): Element | undefined {
  const want = value.trim().toLowerCase();
  return els.find((e, i) => own(e, i) === value) ?? els.find((_, i) => (options?.[i]?.label ?? "").toLowerCase() === want);
}
const nativeValue = (e: Element): string => attr(e, "value") || "on";

/** Ticks or unticks a native checkbox or radio with a real click, so a framework that listens to clicks hears it. */
function setChecked(el: Element, on: boolean): boolean {
  if (checkedOf(el) !== on) (el as HTMLElement).click();
  return checkedOf(el) === on;
}

function writeSelect(sel: Element, value: string): boolean {
  const opts = Array.from((sel as HTMLSelectElement).options);
  const want = value.trim().toLowerCase();
  const hit =
    opts.find((o) => o.value === value) ?? opts.find((o) => collapse(o.text).toLowerCase() === want) ?? opts.find((o) => o.value.toLowerCase() === want);
  if (!hit) return !want && valueOf(sel) === "";
  nativeSet(sel, "value", hit.value);
  hit.selected = true;
  fire(sel);
  return valueOf(sel) === hit.value;
}

function writeNative(b: FieldBinding, value: string): boolean {
  const { field, els } = b;
  const first = els[0] as Element;
  if (field.kind === "radio") {
    if (!value.trim()) return !els.some(checkedOf); // nothing chosen, nothing asked; a radio cannot be unchosen
    const hit = pick(els, field.options, value, nativeValue);
    return hit ? setChecked(hit, true) : false;
  }
  if (field.kind === "checkbox") {
    if (els.length > 1) {
      const wanted = splitList(value).map((s) => s.toLowerCase());
      let ok = true;
      els.forEach((e, i) => {
        const lab = (field.options?.[i]?.label ?? "").toLowerCase();
        ok = setChecked(e, wanted.includes(nativeValue(e).toLowerCase()) || wanted.includes(lab)) && ok;
      });
      return ok;
    }
    const v = value.trim();
    return setChecked(first, TRUE_RE.test(v) || (v !== "" && v.toLowerCase() === attr(first, "value").toLowerCase()));
  }
  if (tag(first) === "select") return writeSelect(first, value);
  return writeText(first, field.kind === "date" ? toIsoDate(value) : value);
}

// ---------------------------------------------------------------- ARIA widgets

function writeAria(b: FieldBinding, value: string): boolean {
  const { field, els } = b;
  const own = (_: Element, i: number): string => field.options?.[i]?.value ?? "";
  if (field.kind === "radio") {
    if (!value.trim()) return !els.some((e) => isOn(e));
    const hit = pick(els, field.options, value, own);
    if (!hit) return false;
    if (!isOn(hit)) press(hit);
    return isOn(hit);
  }
  if (els.length > 1) {
    const wanted = splitList(value).map((s) => s.toLowerCase());
    let ok = true;
    els.forEach((e, i) => {
      const o = field.options?.[i];
      const want = wanted.includes((o?.value ?? "").toLowerCase()) || wanted.includes((o?.label ?? "").toLowerCase());
      if (isOn(e) !== want) press(e);
      ok = isOn(e) === want && ok;
    });
    return ok;
  }
  const el = els[0] as Element;
  const on = TRUE_RE.test(value.trim());
  if (isOn(el) !== on) press(el);
  return isOn(el) === on;
}

/** The option of a listbox that `value` (an option value) or `text` (its label, any case) names; a visible one first. */
function findOption(lb: Element | null, value: string | undefined, text: string): Element | null {
  const opts = optionEls(lb).filter((o) => attr(o, "aria-disabled").toLowerCase() !== "true");
  const match = (o: Element): boolean => (value !== undefined && itemValue(o, optionText(o)) === value) || fold(optionText(o)) === fold(text);
  return opts.find((o) => match(o) && !hiddenUp(o)) ?? opts.find(match) ?? null;
}

const shownText = (cb: Element): string => textOf(cb, (e) => attr(e, "role").toLowerCase() === "listbox");

/** A combobox: typing (or opening it) is not choosing. Open or type, find the option, choose it, and confirm the
 *  choice took: the shown value is the option's, and the list closed or marked it selected because of the click. */
function writeCombobox(b: FieldBinding, value: string): boolean {
  const cb = b.els[0] as Element;
  const want = value.trim();
  const known = b.field.options?.find((o) => o.value === value) ?? b.field.options?.find((o) => fold(o.label) === fold(want));
  const text = known?.label ?? want;
  const isInput = tag(cb) === "input";
  if (!want) return isInput ? clearText(cb) : !optionEls(listboxOf(cb)).some((o) => isOn(o, "aria-selected"));

  if (isInput) {
    const before = valueOf(cb);
    focus(cb);
    nativeSet(cb, "value", text);
    dispatch(cb, "input", ["InputEvent"], { data: text, inputType: "insertText" });
    let opt = findOption(listboxOf(cb), known?.value, text);
    if (!opt) {
      clearByKeys(cb);
      typeKeys(cb, text, false);
      opt = findOption(listboxOf(cb), known?.value, text);
    }
    if (!opt) {
      restore(cb, before);
      return false;
    }
    const lb = listboxOf(cb);
    const expanded = attr(cb, "aria-expanded") === "true";
    const shown = !!lb && !hiddenUp(lb);
    const selBefore = isOn(opt, "aria-selected");
    press(opt);
    const lbAfter = listboxOf(cb);
    const closed = (expanded && attr(cb, "aria-expanded") !== "true") || (shown && (!lbAfter || hiddenUp(lbAfter) || !opt.isConnected));
    const ok = holds(valueOf(cb), optionText(opt)) && (closed || (!selBefore && isOn(opt, "aria-selected")));
    if (!ok) restore(cb, before);
    return ok;
  }

  const opened = attr(cb, "aria-expanded") !== "true";
  if (opened) press(cb);
  const opt = findOption(listboxOf(cb), known?.value, text);
  if (!opt) {
    if (opened && attr(cb, "aria-expanded") === "true") press(cb); // close what we opened
    return false;
  }
  const lb = listboxOf(cb);
  const expanded = attr(cb, "aria-expanded") === "true";
  const shown = !!lb && !hiddenUp(lb);
  press(opt);
  const lbAfter = listboxOf(cb);
  const closed = (expanded && attr(cb, "aria-expanded") !== "true") || (shown && (!lbAfter || hiddenUp(lbAfter) || !opt.isConnected));
  return holds(shownText(cb), optionText(opt)) || (closed && isOn(opt, "aria-selected"));
}

/** A listbox on its own: click the options, confirmed by aria-selected. */
function writeListbox(b: FieldBinding, value: string): boolean {
  const lb = b.els[0] as Element;
  const opts = optionEls(lb);
  const sel = (o: Element): boolean => isOn(o, "aria-selected");
  if (b.field.kind === "checkbox") {
    const wanted = splitList(value).map(fold);
    let ok = true;
    for (const o of opts) {
      const want = wanted.includes(fold(itemValue(o, optionText(o)))) || wanted.includes(fold(optionText(o)));
      if (sel(o) !== want) press(o);
      ok = sel(o) === want && ok;
    }
    return ok;
  }
  if (!value.trim()) return !opts.some(sel);
  const known = b.field.options?.find((o) => o.value === value);
  const opt = findOption(lb, known?.value ?? value, known?.label ?? value);
  if (!opt) return false;
  if (!sel(opt)) press(opt);
  return sel(opt);
}

// ---------------------------------------------------------------- dates

/** D.M.YYYY, D/M/YYYY or D-M-YYYY to the ISO form an <input type="date"> takes. */
export function toIsoDate(v: string): string {
  const m = /^\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})\s*$/.exec(v);
  return m ? `${m[3]}-${(m[2] as string).padStart(2, "0")}-${(m[1] as string).padStart(2, "0")}` : v.trim();
}

function parseDate(v: string): Record<DatePart, number> | null {
  let day: number, month: number, year: number;
  const dmy = /^\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})\s*$/.exec(v);
  const iso = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/.exec(v);
  if (dmy) [day, month, year] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const digitsOf = (s: string): number | null => (/\d/.test(s) ? Number(s.replace(/\D/g, "")) : null);

/** The option of a day, month or year select that holds `n`: by numeric value, by numeric text, or a month by place. */
function numberOption(sel: Element, part: DatePart, n: number): HTMLOptionElement | undefined {
  const opts = Array.from((sel as HTMLSelectElement).options).filter((o) => o.value !== "");
  const num = (s: string): number | null => (/^\s*\d+\s*$/.test(s) ? Number(s) : null);
  return opts.find((o) => num(o.value) === n) ?? opts.find((o) => num(collapse(o.text)) === n) ?? (part === "month" && opts.length === 12 ? opts[n - 1] : undefined);
}

function writeDate(b: FieldBinding, value: string): boolean {
  const parts = b.parts ?? [];
  const before = b.els.map(valueOf);
  if (!value.trim()) {
    const ok = b.els.every((el) => (tag(el) === "select" ? writeSelect(el, "") : clearText(el)));
    if (!ok) b.els.forEach((el, i) => restore(el, before[i] as string));
    return ok;
  }
  const d = parseDate(value);
  if (!d) return false;
  let ok = true;
  b.els.forEach((el, i) => {
    if (!ok) return;
    const part = parts[i] as DatePart;
    const short = part === "year" && (el as HTMLInputElement).maxLength === 2;
    const n = short ? d.year % 100 : d[part];
    if (tag(el) === "select") {
      const opt = numberOption(el, part, n);
      ok = !!opt && writeSelect(el, opt.value);
    } else {
      ok = writeText(el, part === "year" && !short ? String(n) : pad2(n), (actual) => digitsOf(actual) === n);
    }
  });
  if (!ok) b.els.forEach((el, i) => restore(el, before[i] as string));
  return ok;
}

function readDate(b: FieldBinding): string {
  const got: Partial<Record<DatePart, number>> = {};
  b.els.forEach((el, i) => {
    const part = (b.parts ?? [])[i] as DatePart;
    let n = digitsOf(valueOf(el));
    if (tag(el) === "select" && part === "month" && n === null) {
      const opts = Array.from((el as HTMLSelectElement).options).filter((o) => o.value !== "");
      const at = opts.findIndex((o) => o.value === valueOf(el));
      if (opts.length === 12 && at >= 0) n = at + 1;
    }
    if (n !== null) got[part] = n;
  });
  if (!got.day || !got.month || !got.year || got.year < 1000) return "";
  return `${got.year}-${pad2(got.month)}-${pad2(got.day)}`;
}

// ---------------------------------------------------------------- the same answer

/** The option value `v` names: an option's value as written, else an option whose value or label matches in any case;
 *  `v` itself (trimmed) when no option names it. The write path accepts both, so the comparison does too. */
function optionValueOf(options: FieldOption[] | undefined, v: string): string {
  const t = v.trim();
  const low = t.toLowerCase();
  const hit = options?.find((o) => o.value === t) ?? options?.find((o) => o.value.toLowerCase() === low || collapse(o.label).toLowerCase() === low);
  return (hit?.value ?? t).toLowerCase();
}

/**
 * True when the page holding `held` already holds the answer `want` for this field: the rule writeOne uses to accept a
 * write, so Wayfill can tell "nothing to write" from "write this" and an untouched field is never written (cleared).
 * Text by its meaningful characters (a mask's spaces and dots do not count), a date by its ISO form (D.M.YYYY and the
 * browser's YYYY-MM-DD are the same date), a tick group by the set of option values (labels name their options), a
 * single tick by on/off, a choice by its option value. Device-only, like the values it compares.
 */
export function sameAnswer(field: FieldStructure, want: string, held: string): boolean {
  const w = want.trim();
  const h = held.trim();
  if (field.kind === "checkbox") {
    if ((field.options?.length ?? 0) > 1) {
      const set = (v: string): string => [...new Set(splitList(v).map((x) => optionValueOf(field.options, x)))].sort().join("\n");
      return set(w) === set(h);
    }
    const own = (field.options?.[0]?.value ?? "").toLowerCase();
    const on = (v: string): boolean => TRUE_RE.test(v) || (v !== "" && v.toLowerCase() !== "false" && v.toLowerCase() === own);
    return on(w) === on(h);
  }
  if (!w || !h) return !w && !h;
  if ((field.kind === "select" || field.kind === "radio") && field.options?.length) {
    return optionValueOf(field.options, w) === optionValueOf(field.options, h);
  }
  if (field.kind === "date" && toIsoDate(w) === toIsoDate(h)) return true;
  return holds(h, w);
}

// ---------------------------------------------------------------- the two entry points

/** Writes one field and confirms it by reading the page back. False when the page did not take the value, or when the
 *  write cannot be confirmed. */
export function writeOne(b: FieldBinding, value: string): boolean {
  if (b.field.kind === "file") return false;
  switch (b.via) {
    case "date": return writeDate(b, value);
    case "combobox": return writeCombobox(b, value);
    case "listbox": return writeListbox(b, value);
    case "aria": return writeAria(b, value);
    default: return writeNative(b, value);
  }
}

/** Reads one field as a string (see readValues). Device-only. */
export function readOne(b: FieldBinding): string {
  const { field, els } = b;
  const first = els[0] as Element;
  if (field.kind === "file") return "";
  switch (b.via) {
    case "date":
      return readDate(b);
    case "combobox": {
      if (tag(first) === "input") {
        const v = valueOf(first);
        return field.options?.find((o) => fold(o.label) === fold(v) && v.trim() !== "")?.value ?? v;
      }
      const sel = optionEls(listboxOf(first)).find((o) => isOn(o, "aria-selected"));
      if (sel) return itemValue(sel, optionText(sel));
      const shown = shownText(first);
      return field.options?.find((o) => fold(o.label) === fold(shown))?.value ?? "";
    }
    case "listbox":
      return optionEls(first).filter((o) => isOn(o, "aria-selected")).map((o) => itemValue(o, optionText(o))).join(",");
    case "aria": {
      const on = els.map((e, i) => (isOn(e) ? (field.options?.[i]?.value ?? "") : null)).filter((v): v is string => v !== null);
      if (field.kind === "radio") return on[0] ?? "";
      if (els.length > 1) return on.join(",");
      return isOn(first) ? "true" : "false";
    }
  }
  if (field.kind === "radio") {
    const hit = els.find(checkedOf);
    return hit ? nativeValue(hit) : "";
  }
  if (field.kind === "checkbox") {
    if (els.length > 1) return els.filter(checkedOf).map(nativeValue).join(",");
    return checkedOf(first) ? "true" : "false";
  }
  return valueOf(first);
}
