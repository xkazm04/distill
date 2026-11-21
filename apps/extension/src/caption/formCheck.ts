// #9 Ready to send?: how far the page's form is filled, and the next empty field. Uses the engine's form reader; it
// looks only at whether a field is filled, never at what is in it, and types nothing. The values readValues returns
// stay inside `scan` (a yes/no per field comes out); only counts leave this file (FormProgress).
//
// Async, unlike the round-1 stub: extractForm (the engine's form reader) is async because the form's fingerprint is a
// SHA-256. content.ts awaits every handler, so the wire (ContentReplies) is unchanged.
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

interface Field { field: FieldStructure; el: HTMLElement | null; filled: boolean; required: boolean }
interface Scan { structure: FormStructure; fields: Field[] }

// ---- SHA-256 where the page is plain http ----
// Old village and small-business sites are often http only. There `crypto.subtle` does not exist (it needs a secure
// context), and extractForm, whose fingerprint is a SHA-256, throws. For the length of one reading, a SHA-256 in plain
// JS stands in, in the content script's own world (the page cannot see it): the same digest, so nothing that compares
// fingerprints can tell the difference. Taken away again afterwards.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of `data` (FIPS 180-4), for the pages where crypto.subtle is missing. */
export function sha256(data: Uint8Array): Uint8Array {
  const bits = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rot = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      w[i] = ((w[i - 16] as number) + (rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)) + (w[i - 7] as number) + (rot(b, 17) ^ rot(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = Array.from(h) as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] as number) + (w[i] as number)) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const add = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = ((h[i] as number) + (add[i] as number)) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i] as number);
  return out;
}

/** Runs `fn` with a SHA-256 digest available, standing in for crypto.subtle only where the page has none. */
async function withDigest<T>(fn: () => Promise<T>): Promise<T> {
  const c = globalThis.crypto as (Crypto & { subtle?: SubtleCrypto }) | undefined;
  if (!c || c.subtle) return fn();
  const digest = async (alg: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
    const name = typeof alg === "string" ? alg : alg.name;
    if (name.toUpperCase() !== "SHA-256") throw new Error(`${name} is not available on this page`);
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return sha256(bytes).buffer as ArrayBuffer;
  };
  Object.defineProperty(c, "subtle", { value: { digest }, configurable: true });
  try { return await fn(); } finally { delete (c as { subtle?: unknown }).subtle; }
}

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

/** Words that mark a field as required in its label: "Jméno - povinné", "E-mail (required)", "Pflichtfeld". */
const REQUIRED_WORD = /povinn[éýáa]|\brequired\b|pflicht|obligatoire|obligatorio|obbligatorio|wymagane|kötelező/i;

/**
 * Required, as the page says it: the engine's reading (the required attribute, aria-required), or what old forms use
 * instead: a "required" class (Štáhlavy), the word in the label ("- povinné", Přáslavice) or a star in it.
 */
function markedRequired(f: FieldStructure, el: HTMLElement | null): boolean {
  if (f.required || REQUIRED_WORD.test(f.label)) return true;
  if (!el) return false;
  if (/(^|\s)(required|is-required|povinne|povinny|mandatory)(\s|$)/i.test(el.getAttribute("class") ?? "")) return true;
  const labels = (el as HTMLInputElement).labels;
  return !!labels && Array.from(labels).some((l) => /\*/.test(l.textContent ?? "") || REQUIRED_WORD.test(l.textContent ?? ""));
}

/** The page's main form: the one with the most fields a person can see (at least MIN_FIELDS). */
async function scan(doc: Document): Promise<Scan | null> {
  const url = doc.location?.href ?? "";
  let best: Scan | null = null;
  for (let i = 0; i < MAX_FORMS; i++) {
    const structure = await withDigest(() => extractForm(doc, url, i));
    if (!structure.fields.length) break;
    const els = new Map(structure.fields.map((f) => [f.fieldId, fieldElements(doc, [f.fieldId])[0] ?? null]));
    // A field the reader found but Distill cannot point at (no id or name) still counts: the person sees it.
    const shown = structure.fields.filter((f) => { const el = els.get(f.fieldId); return !el || (seen(el) && !trap(el)); });
    if (shown.length < MIN_FIELDS || (best && shown.length <= best.fields.length)) continue;
    const kept = { ...structure, fields: shown };
    // The person's values: read here, turned into yes/no, and dropped. They never leave this function.
    const values = readValues(doc, kept);
    best = { structure: kept, fields: shown.map((f) => { const el = els.get(f.fieldId) ?? null; return { field: f, el, filled: isFilled(f, el, values[f.fieldId]), required: markedRequired(f, el) }; }) };
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
