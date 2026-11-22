// #9 Ready to send?: how far the page's form is filled, and the next empty field. Uses the engine's form reader; it
// looks only at whether a field is filled, never at what is in it, and types nothing. The values readValues returns
// stay inside `scan` (a yes/no per field comes out); only counts leave this file (FormProgress).
//
// Async, unlike the round-1 stub: extractForm (the engine's form reader) is async because the form's fingerprint is a
// SHA-256 (on plain http pages too: the engine falls back to its own, see engine sha256.ts). content.ts awaits every
// handler, so the wire (ContentReplies) is unchanged.
import { extractForm, readErrors, readValues, type FieldStructure, type FormStructure } from "@distill/engine";
import { fieldElements } from "@distill/web/dom";
import type { FormProgress } from "../messages";
import { markOnPage } from "./contact";

/** A form with fewer fields a person can see than this is a search box or a login, not "the page's form". */
const MIN_FIELDS = 3;
/** Forms read at most (a page with more is a directory of forms; the largest of the first ones is enough). */
const MAX_FORMS = 12;
/** A field named like a robot trap: it must stay empty, so it is never counted or visited. */
const TRAP = /(^|[_\-[\]])(website|url|www|homepage|hp|honeypot|hpot|antispam|spam|bot|trap|nickname|leave[_-]?blank)([_\-[\]]|$)/i;

/** `required` is the engine's reading (FieldStructure.required): the attributes, and what old forms use instead (a
 *  required class, the word or a star in the label), so the side panel's Wayfill counts the same fields. */
interface Field { field: FieldStructure; el: HTMLElement | null; filled: boolean; required: boolean }
interface Scan { structure: FormStructure; fields: Field[] }

/** Whether a person can see the field (or, for a styled checkbox or radio, its label). */
function seen(el: HTMLElement): boolean {
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  const visible = (e: Element): boolean => {
    if (typeof (e as HTMLElement).checkVisibility === "function"
      && !(e as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const cs = win.getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    // Pushed off the page (left: -9999px) or clipped to nothing: a trap for robots.
    const doc = e.ownerDocument.documentElement;
    if (r.right <= 0 || r.bottom + win.scrollY <= 0 || r.left >= Math.max(doc.scrollWidth, win.innerWidth)) return false;
    return !/rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(cs.clip) && cs.clipPath !== "inset(50%)";
  };
  if (visible(el)) return true;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  if (type !== "checkbox" && type !== "radio") return false;
  const label = el.closest("label") ?? (el.id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
  return !!label && visible(label);
}

function trap(el: HTMLElement): boolean {
  const name = `${el.getAttribute("name") ?? ""} ${el.id}`;
  if (!TRAP.test(name)) return false;
  return el.tabIndex === -1 || el.getAttribute("autocomplete") === "off" || !!el.closest("[aria-hidden=true]") || !seen(el);
}

/** The first option of a select that only asks to choose ("-- vyberte --", "Please select"). */
const PLACEHOLDER = /^[\s\-–—_.:*]*(vyberte|zvolte|vyber|select|choose|please|bitte|wählen|auswählen|seleccione|choisissez|wybierz)\b|^[\s\-–—_.:*]*$/i;

/** A field counts as filled when it holds something: a checked box, a chosen file, a non-empty value, a choice that
 *  is not the select's "please choose" line. */
function isFilled(f: FieldStructure, el: HTMLElement | null, value: string | undefined): boolean {
  if (f.kind === "file") return !!(el as HTMLInputElement | null)?.files?.length;
  if (value === undefined || value === "") return false;
  if (f.kind === "checkbox" && value === "false") return false;
  if (el instanceof HTMLSelectElement && !el.multiple && el.selectedIndex === 0 && PLACEHOLDER.test(el.options[0]?.text ?? "")) return false;
  return true;
}

/** The page's main form: the one with the most fields a person can see (at least MIN_FIELDS). */
async function scan(doc: Document): Promise<Scan | null> {
  const url = doc.location?.href ?? "";
  let best: Scan | null = null;
  for (let i = 0; i < MAX_FORMS; i++) {
    const structure = await extractForm(doc, url, i);
    if (!structure.fields.length) break;
    const els = new Map(structure.fields.map((f) => [f.fieldId, fieldElements(doc, [f.fieldId])[0] ?? null]));
    // A field the reader found but Distill cannot point at (no id or name) still counts: the person sees it.
    const shown = structure.fields.filter((f) => { const el = els.get(f.fieldId); return !el || (seen(el) && !trap(el)); });
    if (shown.length < MIN_FIELDS || (best && shown.length <= best.fields.length)) continue;
    const kept = { ...structure, fields: shown };
    // The person's values: read here, turned into yes/no, and dropped. They never leave this function.
    const values = readValues(doc, kept);
    best = { structure: kept, fields: shown.map((f) => { const el = els.get(f.fieldId) ?? null; return { field: f, el, filled: isFilled(f, el, values[f.fieldId]), required: f.required }; }) };
  }
  return best;
}

function count(doc: Document, s: Scan): FormProgress {
  const errors = readErrors(doc, s.structure);
  return {
    fields: s.fields.length,
    filled: s.fields.filter((f) => f.filled).length,
    required: s.fields.filter((f) => f.required).length,
    requiredLeft: s.fields.filter((f) => f.required && !f.filled).length,
    errors: Object.keys(errors.fields).length + errors.form.length,
  };
}

/** The page's main form (the largest shown), counted; null when the page has none. */
export async function formProgress(doc: Document): Promise<FormProgress | null> {
  const s = await scan(doc);
  return s ? count(doc, s) : null;
}

/** Scrolls to the next empty required field (else the next empty one), focuses it, and counts again. "Next" means
 *  after the field the person is in, so pressing it again walks on through the empty fields. */
export async function nextField(doc: Document): Promise<FormProgress | null> {
  const s = await scan(doc);
  if (!s) return null;
  const reachable = s.fields.filter((f) => !f.filled && f.el);
  const active = doc.activeElement;
  const here = s.fields.findIndex((f) => !!f.el && !!active && (f.el === active || (f.el.getAttribute("name") !== null && f.el.getAttribute("name") === active.getAttribute("name"))));
  const after = (list: Field[]) => {
    const order = (f: Field) => s.fields.indexOf(f);
    return list.find((f) => order(f) > here) ?? list[0];
  };
  const target = after(reachable.filter((f) => f.required)) ?? after(reachable);
  if (target?.el) {
    const el = target.el;
    // The outline goes on what the person sees: a styled checkbox's label rather than its invisible box.
    const shownBox = seen(el) && el.getBoundingClientRect().width >= 4 ? el : el.closest("label") ?? el;
    markOnPage(doc, shownBox);
    el.focus({ preventScroll: true });
  }
  return count(doc, s);
}
