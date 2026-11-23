// Round 4, card 4 (r4-04): a form in your language. The form's own words (labels, hints, placeholders, the options of
// each list, buttons, legend and fieldset titles) are read and swapped in place like Translate's text; a value the person
// typed is never read, and an error message (which can repeat it) only for an on-device translation. Keep <language>,
// Original and close bring every word back; the form submits exactly what it did before.
//
// What is read, and only inside the page's forms (a form in the page's main area, with at least two fields to fill):
// - text nodes, grouped by their nearest block (a label, a legend, a cell, a button...), so a label stays one sentence;
// - the attributes a person reads: placeholder, aria-label, title, and a value-less button's label (an <input
//   type=button|reset>, or a submit input without a name: one with a name sends its value with the form);
// - each option's text and each optgroup's label.
// What is never read: an input's or a textarea's value, the value attribute of an option, contenteditable areas, an
// <output>, live regions (aria-live, role=alert/status/log: what a page writes there as the person types), and any
// error message (looksLikeError, aria-errormessage targets, what an invalid field's aria-describedby names). Errors are
// read only by formErrors, for the values-class task translateErrors (device only, no cloud fallback).
//
// The option fix: an <option> without a value attribute submits its text. Before its text is translated, the page's own
// text (as the browser would submit it: whitespace collapsed) is pinned as its value attribute, so the form sends exactly
// the same data; the pin goes whenever the option shows its own words again (Keep <language>, Original, close).
//
// Every write keeps the page's value to go back to and only replaces what Distill itself wrote: a text node or attribute
// the page changed meanwhile is left as the page made it.
import { isInvalid, looksLikeError } from "@distill/engine";
import type { CaptionMoreText, TextBlock } from "../messages";
import { pageControl } from "./formCheck";
import { quietly, readerLang, spread } from "./translate";

/** On each element that shows a translation of the form's words now. */
export const FORM_TRANSLATED = "data-distill-form-translated";
/** On an option whose page text Distill pinned as its value attribute while its text shows a translation. */
export const FORM_VALUE = "data-distill-form-value";

/** Never read for the form's words. Options and optgroups have their own reading; errors are filtered separately. */
const SKIP = [
  "script", "style", "noscript", "template", "textarea", "select", "datalist", "option", "optgroup", "input", "svg", "math",
  "output", "[contenteditable]:not([contenteditable=false])", "[translate=no]", ".notranslate", "[data-distill-hide]",
  "[aria-live]:not([aria-live=off])", "[role=alert]", "[role=status]", "[role=log]", "[role=timer]", "distill-caption",
].join(", ");
/** The block a text node belongs to: its nearest one of these. */
const UNIT = "label, legend, button, td, th, p, li, dt, dd, h1, h2, h3, h4, h5, h6, caption, summary, figcaption, small, div, fieldset, section, form";
/** Fields a person fills. */
const FIELDS = "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea";
/** A form here is not the page's form: the site's header search, a footer newsletter box. */
const BOILER = "header, nav, footer, aside, [role=banner], [role=navigation], [role=contentinfo], [role=complementary], [role=search], distill-caption";
/** Fewer fields than this: a search box or a login, not a form to translate. */
const MIN_FIELDS = 2;
/** A block longer than this is a page section inside the form, not its words (cut so one call stays small). */
const TEXT_MAX = 3000;
/** At most this many units per page (a huge form is translated in its first part). */
const MAX_UNITS = 600;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();
const hasWords = (s: string): boolean => /\p{L}/u.test(s);
/** What the browser submits for an option without a value attribute: its text, ASCII whitespace stripped and collapsed. */
const optionValueOf = (text: string): string => text.replace(/[\t\n\f\r ]+/g, " ").replace(/^ | $/g, "");

interface TextUnit {
  id: string;
  kind: "text" | "error";
  el: Element;
  nodes: Text[];
  source: string[];
  translation?: string[];
  /** The block's words as handed over. */
  text: string;
  /** The element's own lang attribute before Distill wrote one (null: none). */
  lang: string | null;
}
interface AttrUnit { id: string; kind: "attr"; el: Element; name: string; source: string; translation?: string }
type Unit = TextUnit | AttrUnit;

interface Watch { observer: MutationObserver; doc: Document; tabId: number; timer?: ReturnType<typeof setTimeout>; last: number }

interface State {
  units: Map<string, Unit>;
  /** Text nodes and attributes already read, so a second reading hands over only what is new. */
  seenNodes: WeakSet<Text>;
  seenAttrs: WeakMap<Element, Set<string>>;
  /** The error unit read from each error element (its message may change: then it is read again). */
  errorOf: WeakMap<Element, TextUnit>;
  next: number;
  nextError: number;
  keepSource: boolean;
  originalOn: boolean;
  target: string;
  watch: Watch | null;
}

let state: State | null = null;

function ensure(): State {
  state ??= {
    units: new Map(), seenNodes: new WeakSet(), seenAttrs: new WeakMap(), errorOf: new WeakMap(), next: 0, nextError: 0,
    keepSource: false, originalOn: false, target: readerLang(), watch: null,
  };
  return state;
}

// ---- Which forms ---------------------------------------------------------------------------------------------------

/** Not hidden from the person (jsdom and old browsers cannot say: then it counts as shown). */
function drawn(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  try { return typeof check === "function" ? check.call(el, { visibilityProperty: true }) : true; } catch { return true; }
}

/** A field a person can fill and see (a styled checkbox or radio hides its box: it counts). */
function fillable(el: Element): boolean {
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  return type === "checkbox" || type === "radio" || drawn(el);
}

/** The forms whose words are translated: in the page's main area (not its header, navigation, sidebar or footer, not
 *  hidden by Clean), not a panel of the page's own settings, and with at least MIN_FIELDS fields to fill. */
export function formScopes(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll("form")).filter((f) =>
    !f.closest(BOILER) && !f.closest("[data-distill-hide]") && (f.getAttribute("role") ?? "").toLowerCase() !== "search"
    && drawn(f) && !pageControl(f)
    && Array.from(f.querySelectorAll(FIELDS)).filter(fillable).length >= MIN_FIELDS);
}

// ---- Errors: never among the form's words --------------------------------------------------------------------------

/** The elements fields name as their error: aria-errormessage always; while invalid, everything aria-describedby names
 *  (a hint the page turns into an error while the field is invalid is treated as the error it may now be). */
function linkedErrors(scope: Element): Set<Element> {
  const out = new Set<Element>();
  const doc = scope.ownerDocument;
  const named = (el: Element, attr: string) => (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean)
    .map((id) => doc.getElementById(id)).filter((e): e is HTMLElement => !!e);
  for (const f of Array.from(scope.querySelectorAll("[aria-errormessage], [aria-invalid][aria-describedby]"))) {
    named(f, "aria-errormessage").forEach((e) => out.add(e));
    if (isInvalid(f)) named(f, "aria-describedby").forEach((e) => out.add(e));
  }
  return out;
}

/** Inside an error message: the element or one of its ancestors up to the scope looks like one or is linked as one. */
function inError(el: Element, scope: Element, linked: ReadonlySet<Element>): boolean {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    if (linked.has(cur) || looksLikeError(cur)) return true;
    if (cur === scope) break;
  }
  return false;
}

// ---- Reading -------------------------------------------------------------------------------------------------------

function seenAttr(s: State, el: Element, name: string): boolean {
  let set = s.seenAttrs.get(el);
  if (!set) { set = new Set(); s.seenAttrs.set(el, set); }
  if (set.has(name)) return true;
  set.add(name);
  return false;
}

/** A unit of text nodes: `all` in document order, the spaces between words included (they keep words apart in the
 *  block's text); only the nodes with words are written into. */
function addText(s: State, el: Element, all: Text[], kind: "text" | "error"): TextUnit | null {
  const text = collapse(all.map((n) => n.nodeValue ?? "").join(""));
  const nodes = all.filter((n) => /\S/.test(n.nodeValue ?? ""));
  if (!nodes.length || !hasWords(text) || text.length > TEXT_MAX || s.units.size >= MAX_UNITS) return null;
  const id = kind === "text" ? `f${s.next++}` : `e${s.nextError++}`;
  const unit: TextUnit = { id, kind, el, nodes, source: nodes.map((n) => n.nodeValue ?? ""), text, lang: el.getAttribute("lang") };
  s.units.set(id, unit);
  return unit;
}

function addAttr(s: State, el: Element, name: string): AttrUnit | null {
  const value = el.getAttribute(name);
  if (value === null || !hasWords(value) || value.length > TEXT_MAX || s.units.size >= MAX_UNITS || seenAttr(s, el, name)) return null;
  const unit: AttrUnit = { id: `f${s.next++}`, kind: "attr", el, name, source: value };
  s.units.set(unit.id, unit);
  return unit;
}

/** The attributes of `el` a person reads, by kind of element. Never an input's value, except a button's label that is
 *  not sent with the form. */
function readableAttrs(el: Element): string[] {
  const out: string[] = [];
  const t = el.localName;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if ((t === "input" && type !== "hidden") || t === "textarea") out.push("placeholder");
  if (el.hasAttribute("aria-label")) out.push("aria-label");
  if (el.hasAttribute("title") && (t === "input" || t === "select" || t === "textarea" || t === "button" || t === "abbr")) out.push("title");
  if (t === "input" && (type === "button" || type === "reset" || (type === "submit" && !el.hasAttribute("name")))) out.push("value");
  if (t === "optgroup") out.push("label");
  return out;
}

/** Reads the forms' words not read before, as new units. */
function readForms(doc: Document, s: State): TextBlock[] {
  const out: TextBlock[] = [];
  for (const scope of formScopes(doc)) {
    const linked = linkedErrors(scope);
    // Text nodes, by their block.
    const byUnit = new Map<Element, Text[]>();
    const walker = doc.createTreeWalker(scope, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const parent = n.parentElement;
      if (!parent || s.seenNodes.has(n) || parent.closest(SKIP) || inError(parent, scope, linked)) continue;
      const unitEl = parent.closest(UNIT) ?? scope;
      const list = byUnit.get(unitEl) ?? [];
      list.push(n);
      byUnit.set(unitEl, list);
    }
    for (const [el, nodes] of byUnit) {
      const unit = addText(s, el, nodes, "text");
      nodes.forEach((n) => s.seenNodes.add(n));
      if (unit) out.push({ id: unit.id, text: unit.text });
    }
    // Options: each its own unit (the value fix happens as it is translated).
    for (const opt of Array.from(scope.querySelectorAll("option"))) {
      if (opt.closest("[translate=no], .notranslate")) continue;
      const nodes = Array.from(opt.childNodes).filter((c): c is Text => c.nodeType === 3 && !s.seenNodes.has(c as Text));
      if (!nodes.some((n) => /\S/.test(n.nodeValue ?? ""))) continue;
      nodes.forEach((n) => s.seenNodes.add(n));
      const unit = addText(s, opt, nodes, "text");
      if (unit) out.push({ id: unit.id, text: unit.text });
    }
    // Attributes.
    for (const el of [scope, ...Array.from(scope.querySelectorAll("*"))]) {
      if (el.closest("[translate=no], .notranslate, [contenteditable]:not([contenteditable=false]), output") || inError(el, scope, linked)) continue;
      for (const name of readableAttrs(el)) {
        const unit = addAttr(s, el, name);
        if (unit) out.push({ id: unit.id, text: collapse(unit.source) });
      }
    }
  }
  return out;
}

/** The form's own words not handed over before (ids `f0...`). Never a value, never an error message. */
export function formText(doc: Document): TextBlock[] {
  return readForms(doc, ensure());
}

/** The error elements the forms show now: outermost ones, shown, holding words. */
function errorElements(doc: Document): Element[] {
  const out: Element[] = [];
  for (const scope of formScopes(doc)) {
    const linked = linkedErrors(scope);
    for (const el of Array.from(scope.querySelectorAll("*"))) {
      if (!(linked.has(el) || looksLikeError(el)) || !drawn(el) || out.some((o) => o.contains(el))) continue;
      if (!hasWords(el.textContent ?? "")) continue;
      out.push(el);
    }
  }
  return out;
}

function errorNodes(el: Element): Text[] {
  const walker = el.ownerDocument.createTreeWalker(el, 4);
  const out: Text[] = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.parentElement?.closest("script, style, template")) out.push(n);
  }
  return out;
}

/** The text a unit's nodes hold now. */
const nowText = (u: TextUnit): string => collapse(u.nodes.map((n) => (n.isConnected ? n.nodeValue ?? "" : "")).join(""));

/**
 * The error messages the forms show now that were not handed over yet (ids `e0...`). VALUES CLASS: a message can repeat
 * what the person typed, so these go only to the on-device task translateErrors, never to a model that may run in the
 * cloud. An element whose message changed since it was read is read again.
 */
export function formErrors(doc: Document): TextBlock[] {
  const s = ensure();
  const out: TextBlock[] = [];
  for (const el of errorElements(doc)) {
    const known = s.errorOf.get(el);
    if (known) {
      const now = nowText(known);
      if (now === collapse(known.source.join("")) || (known.translation && now === collapse(known.translation.join("")))) continue;
      s.units.delete(known.id); // the page wrote a new message: the old one is gone
    }
    const unit = addText(s, el, errorNodes(el), "error");
    if (!unit) continue;
    s.errorOf.set(el, unit);
    out.push({ id: unit.id, text: unit.text });
  }
  return out;
}

// ---- Showing -------------------------------------------------------------------------------------------------------

const live = (s: State): boolean => !s.keepSource && !s.originalOn;
const shown = (s: State, u: Unit): boolean => u.translation !== undefined && live(s);

/** Puts unit `u` into the view it should show now. Only what Distill wrote itself is replaced. */
function show(s: State, u: Unit): void {
  if (u.translation === undefined) return;
  const on = shown(s, u);
  if (u.kind === "attr") {
    const from = on ? u.source : u.translation;
    const to = on ? u.translation : u.source;
    if (u.el.getAttribute(u.name) === from) u.el.setAttribute(u.name, to);
  } else {
    const from = on ? u.source : u.translation;
    const to = on ? u.translation : u.source;
    u.nodes.forEach((n, i) => { if (n.isConnected && n.nodeValue === from[i]) n.nodeValue = to[i] ?? ""; });
    if (u.el.localName === "option") pin(u, on);
    if (on) u.el.setAttribute("lang", s.target);
    else if (u.lang === null) u.el.removeAttribute("lang");
    else u.el.setAttribute("lang", u.lang);
  }
}

/** An option without a value attribute submits its text: while it shows a translation, its own text is its value. */
function pin(u: TextUnit, on: boolean): void {
  const el = u.el;
  if (on && !el.hasAttribute("value")) {
    el.setAttribute("value", optionValueOf(u.source.join("")));
    el.setAttribute(FORM_VALUE, "");
  } else if (!on && el.hasAttribute(FORM_VALUE)) {
    el.removeAttribute("value");
    el.removeAttribute(FORM_VALUE);
  }
}

/** The marker on every element that shows a translation now, and on none other. */
function mark(s: State): void {
  const on = new Set<Element>();
  for (const u of s.units.values()) if (shown(s, u)) on.add(u.el);
  for (const u of s.units.values()) {
    if (on.has(u.el)) u.el.setAttribute(FORM_TRANSLATED, "");
    else u.el.removeAttribute(FORM_TRANSLATED);
  }
}

/** Distill's own writes: the form watcher and the main text's watcher never take them for the page's. */
function write<T>(s: State, fn: () => T): T {
  const w = s.watch;
  if (w) noticed(w, w.observer.takeRecords());
  try { return quietly(fn); } finally { w?.observer.takeRecords(); }
}

function render(s: State): void {
  write(s, () => { for (const u of s.units.values()) show(s, u); mark(s); });
}

/** Puts translations in; returns how many units changed. A unit the page changed meanwhile is left as it is. */
function apply(blocks: readonly TextBlock[], kind: "text" | "error"): number {
  const s = state;
  if (!s) return 0;
  return write(s, () => {
    let n = 0;
    for (const b of blocks) {
      const u = s.units.get(typeof b.id === "string" ? b.id : "");
      const text = typeof b.text === "string" ? collapse(b.text) : "";
      if (!u || !text || u.translation !== undefined) continue;
      if ((u.kind === "error") !== (kind === "error")) continue; // an error is put in only by the on-device answer
      if (u.kind === "attr") {
        if (u.el.getAttribute(u.name) !== u.source) continue;
        u.translation = text;
      } else {
        if (u.nodes.some((node, i) => !node.isConnected || node.nodeValue !== u.source[i])) continue;
        u.translation = spread(text, u.source);
      }
      show(s, u);
      n++;
    }
    mark(s);
    return n;
  });
}

/** Puts these translations of the form's words in place (from translateBlocks, through parseTranslation). */
export function applyFormText(_doc: Document, blocks: readonly TextBlock[]): number {
  return apply(blocks, "text");
}

/** Puts these on-device translations of the error messages in place (translateErrors only). */
export function applyFormErrors(_doc: Document, blocks: readonly TextBlock[]): number {
  return apply(blocks, "error");
}

/** Keep <language> (true): the form's own words; false: the translation again. */
export function formSource(_doc: Document, on: boolean): void {
  if (!state) return;
  state.keepSource = on;
  render(state);
}

/** Original on (true): the form's own words whatever else; off: as Distill shows it. */
export function formOriginal(on: boolean): void {
  if (!state) return;
  state.originalOn = on;
  render(state);
}

/** Close: every word, attribute and pinned value back, the watcher gone. */
export function clearFormText(): void {
  const s = state;
  if (!s) return;
  stopWatching(s);
  s.originalOn = true;
  render(s);
  state = null;
}

// ---- Watching for new words and new errors ---------------------------------------------------------------------------
// While a translation shows, the form may show an error after a check, open a further part, or rebuild a list. The page
// side only counts what is new and tells the caption frame (CaptionMoreText, never the words); the frame asks for it.

const QUIET_MS = 400;
const MIN_GAP_MS = 800;

/** Starts telling the caption frame of tab `tabId` when the forms show words or errors not handed over yet. */
export function watchForm(doc: Document, tabId: number): void {
  const s = state;
  if (!s || s.watch || typeof MutationObserver === "undefined") return;
  const w: Watch = { doc, tabId, last: 0, observer: new MutationObserver((records) => noticed(w, records)) };
  s.watch = w;
  for (const scope of formScopes(doc)) {
    w.observer.observe(scope, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-invalid", "aria-hidden", "aria-describedby"] });
  }
}

function stopWatching(s: State): void {
  const w = s.watch;
  if (!w) return;
  w.observer.disconnect();
  if (w.timer !== undefined) clearTimeout(w.timer);
  s.watch = null;
}

function noticed(w: Watch, records: readonly MutationRecord[]): void {
  if (!records.length || state?.watch !== w || w.timer !== undefined) return;
  const wait = Math.max(QUIET_MS, w.last + MIN_GAP_MS - Date.now());
  w.timer = setTimeout(() => { w.timer = undefined; look(w); }, wait);
}

/** How many words or errors wait, without reading any of them into a unit (nothing is handed over here). */
function waiting(doc: Document, s: State): number {
  let n = 0;
  for (const scope of formScopes(doc)) {
    const linked = linkedErrors(scope);
    const walker = doc.createTreeWalker(scope, 4);
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      const p = t.parentElement;
      if (p && !s.seenNodes.has(t) && hasWords(t.nodeValue ?? "") && !p.closest(SKIP) && !inError(p, scope, linked)) n++;
    }
    for (const opt of Array.from(scope.querySelectorAll("option"))) {
      if (Array.from(opt.childNodes).some((c) => c.nodeType === 3 && hasWords(c.nodeValue ?? "") && !s.seenNodes.has(c as Text))) n++;
    }
  }
  for (const el of errorElements(doc)) {
    const known = s.errorOf.get(el);
    if (!known) { n++; continue; }
    const now = nowText(known);
    if (now !== collapse(known.source.join("")) && !(known.translation && now === collapse(known.translation.join("")))) n++;
  }
  return n;
}

function look(w: Watch): void {
  const s = state;
  if (!s || s.watch !== w) return;
  w.last = Date.now();
  if (!live(s)) return; // Keep <language> or Original: nothing is handed over until the translation shows again
  const count = waiting(w.doc, s);
  if (!count) return;
  const msg: CaptionMoreText = { type: "distill:caption:moreText", tabId: w.tabId, count };
  try { void chrome.runtime.sendMessage(msg).catch(() => undefined); } catch { stopWatching(s); }
}

/** TESTS ONLY: forget everything (the page is replaced between tests). */
export function resetFormText(): void {
  if (state) stopWatching(state);
  state = null;
}
