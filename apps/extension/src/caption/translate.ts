// #10 Translate in place: the page side. Hands the frame the main text's blocks, puts the translations in text node by
// text node, keeps the originals, and shows them again for "Keep <language>" and Original. While a translation is on
// the page, text the page adds or rewrites later is noticed and handed over too (watchText, at the end).
//
// Only the main text: the running text Clean found (ctx.body), the headline, the lead paragraphs under it and the
// headings of the main column. Never
// a form, a field's content, an editable area, code, or what the page marks translate="no". A block is the smallest
// element holding its own words (a paragraph, a list item, a table cell), so a list stays a list and a table a table.
// Only text nodes' values change: every element, link and attribute stays, and every original value is kept to be put
// back exactly. Nothing read here leaves the browser: the blocks go to the caption frame only.
//
// Round 2 (r2-04, plain words): the same swap shows plain words too. Each block keeps, for the text nodes Distill
// writes, the page's own values, the translation's and the plain words of either; which one shows follows from four
// switches the frame sets: Original, Keep <language>, Plain, and whether the block was translated (viewOf). Plain
// rewrites the page as it is shown: a translated block's translation, else the page's own words. Keep <language> turns
// Plain off (the page's own words, as written); Original and close bring back every word.
import { detectLang, extractPage } from "@distill/engine";
import type { CaptionMoreText, TextBlock } from "../messages";
import { commonAncestor, type CleanContext } from "./context";

/** On each block that shows its translation now. */
export const TRANSLATED = "data-distill-translated";

/** Elements that are a block of their own inside a root block (a list's items, a table's cells). */
const UNIT = "p, li, dt, dd, td, th, caption, figcaption, blockquote, h1, h2, h3, h4, h5, h6, summary, legend";
const HEADING = "h1, h2, h3, h4, h5, h6, [role=heading]";
/** A box with one of these inside is not a lead paragraph of its own. */
const BLOCKISH = "p, div, section, article, ul, ol, dl, table, figure, blockquote, header, footer, nav, aside, form, h1, h2, h3, h4, h5, h6";
/** Text here is never sent or changed: code, scripts, form parts, a person's own text, what the page keeps as it is. */
const SKIP = "script, style, noscript, template, pre, textarea, select, option, input, button, svg, math, form, [contenteditable]:not([contenteditable=false]), [translate=no], .notranslate, [data-distill-hide], [aria-hidden=true]";

/** On each block that shows plain words now (r2-04). */
export const PLAIN = "data-distill-plain";
/** A block gets plain words only from this many words up: a heading or a short line is plain enough. */
export const PLAIN_MIN_WORDS = 8;

/** What a block shows: the page's words, the translation, or plain words of either (r2-04). */
type View = "source" | "translation" | "plainSource" | "plainTranslation";
type Base = "source" | "translation";
const TRANSLATED_VIEWS: ReadonlySet<View> = new Set<View>(["translation", "plainTranslation"]);
const PLAIN_VIEWS: ReadonlySet<View> = new Set<View>(["plainSource", "plainTranslation"]);
const plainOf = (base: Base): View => (base === "source" ? "plainSource" : "plainTranslation");

interface Unit {
  id: string;
  el: Element;
  /** Its text nodes, in order (blank ones too). */
  nodes: Text[];
  source: string;
  /** Not in the reader's language: Translate sends it. A block already in the reader's language is a unit too (plain
   *  words may rewrite it) but is never sent for a translation. */
  foreign: boolean;
  /** Once Distill wrote into the block: the text nodes it writes, and each view's values for them in the same order
   *  (`values.source`: the page's own). */
  slots?: Text[];
  values?: Partial<Record<View, string[]>>;
  /** The translation as one text, once translated. */
  translation?: string;
  /** What the block shows now. */
  view: View;
  /** Its lang attribute as the page had it (null: none), once Distill wrote into it. */
  lang?: string | null;
}

interface State {
  ctx: CleanContext;
  /** The outermost blocks of the last read: the next read keeps them while they are on the page. */
  roots: Element[];
  units: Map<string, Unit>;
  byEl: Map<Element, Unit>;
  /** Every text node Distill writes into: its block and its place among the block's slots. */
  slotOf: Map<Text, { u: Unit; i: number }>;
  target: string;
  /** Some block holds a translation (Translate ran here). */
  translatedAny: boolean;
  /** The person chose "Keep <language>". */
  keepSource: boolean;
  /** Original is on. */
  originalOn: boolean;
  /** Plain words are on (r2-04; only ever the person's choice). */
  plainOn: boolean;
  /** The next block id ("t<n>"): an id once given never names another block. */
  next: number;
  /** The same for a block already in the reader's language ("p<n>"). */
  nextPlain: number;
  /** Translations by the page's words: a block that comes back as it was (a view shown again) needs no model. */
  memo: Map<string, string>;
  /** Plain words by the words they rewrite (the page's or a translation's). */
  plainMemo: Map<string, string>;
  /** The words each block was handed over with for plain words: a rewrite of other words is not put in. */
  asked: Map<string, string>;
  /** Watching for text the page adds later, once the frame asked (watchText). */
  watch: Watch | null;
  /** The main column the translation started with (a single-page app's next view replaces it). */
  main: Element | null;
  /** How often the page rewrote each translated block. */
  rewrites: WeakMap<Element, number>;
}

let state: State | null = null;

/** The reader's language: the browser's, primary subtag ("en" from "en-GB"). */
export function readerLang(nav: Pick<Navigator, "language"> = navigator): string {
  return (nav.language || "en").split("-")[0]?.toLowerCase() || "en";
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

const EN_COMMON = new Set("the and of to in is are for that with on as this be by it from at or was have will you your not can".split(" "));

/** A short check that a block is already in the reader's language, so it is not sent. Anything unsure goes to the model. */
function inLang(text: string, target: string): boolean {
  if (text.length >= 40) {
    const d = detectLang(text);
    if (d.lang === target && d.confidence >= 0.8) return true;
  }
  if (target !== "en") return false;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 3 || /[^\x00-\x7F]/.test(words.join(""))) return false;
  return words.filter((w) => EN_COMMON.has(w)).length / words.length >= 0.25;
}

/** Words that only name a way to reach someone (Czech, German, English, and the common short forms), and the words that
 *  join two numbers. A block of these around numbers, e-mails and web addresses reads the same in any language. */
const CONTACT_WORDS = new Set([
  "tel", "telefon", "telefonní", "číslo", "mobil", "mob", "gsm", "fax", "e-mail", "email", "mail", "web", "www", "ičo",
  "ič", "dič", "adresa", "kontakt", "č", "ú", "účet", "účtu", "a", "nebo",
  "handy", "mobiltelefon", "adresse", "anschrift", "ust-idnr", "ust-id", "steuernr", "steuernummer", "internet", "und", "oder",
  "phone", "telephone", "mobile", "cell", "address", "website", "vat", "and", "or",
].map((w) => w.normalize("NFC")));
const JOINERS = new Set(["a", "nebo", "und", "oder", "and", "or"]);

/**
 * True when a block holds nothing to translate but contact details: its only words are contact labels ("tel.", "IČO",
 * "E-Mail") around phone numbers, e-mails or web addresses ("tel.: 549 211 296, 541 246 631"). A sentence that holds a
 * number ("Volejte 549 211 296 ve všední dny") has words of its own and is translated.
 */
export function contactOnly(text: string): boolean {
  const rest = text
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, " ") // e-mails
    .replace(/\b(?:https?:\/\/|www\.)\S+/giu, " ") // web addresses
    .replace(/[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:cz|sk|de|at|ch|com|org|net|eu|info|biz)\b\S*/giu, " "); // bare domains
  const reached = rest !== text;
  const tokens = rest.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  let numbers = 0;
  let labels = 0;
  for (const t of tokens) {
    if (/\d/.test(t)) { numbers++; continue; } // a number, a VAT id like CZ12345678
    const w = t.replace(/^-+|-+$/g, "");
    if (!CONTACT_WORDS.has(w)) return false;
    if (!JOINERS.has(w)) labels++;
  }
  // An e-mail or a web address, or a label with its number. A lone "Kontakt" is a heading and is translated.
  return reached || (numbers > 0 && labels > 0);
}

/** Text nodes inside `root` that may be translated, in document order. */
function textNodes(root: Element): Text[] {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (parent && !parent.closest(SKIP)) out.push(n as Text);
  }
  return out;
}

/** The words of a block: its text nodes joined, a line break read as a space. */
function wordsOf(nodes: readonly Text[]): string {
  let s = "";
  nodes.forEach((n, i) => {
    const prev = nodes[i - 1];
    if (prev && prev.nextSibling !== n && n.previousSibling?.nodeName === "BR") s += " ";
    s += n.nodeValue ?? "";
  });
  return collapse(s);
}

/** The paragraphs between the headline and the running text (a news site's lead): the article's own, as Clean keeps
 *  them, though the page reader may not have taken them in. */
function lead(ctx: Pick<CleanContext, "body" | "main">, headings: readonly Element[]): Element[] {
  const h1 = headings.find((h) => h.matches("h1"));
  const first = ctx.body[0];
  if (!h1 || !first || !ctx.main) return [];
  const box = commonAncestor(h1, ctx.main);
  const between = (el: Element) => !!(h1.compareDocumentPosition(el) & 4) && !!(el.compareDocumentPosition(first) & 4);
  // A paragraph, or a box of text with no block inside it (a site's div.perex). Not the site's header, menus or asides.
  const siteHeader = (el: Element) => { const h = el.closest("header"); return !!h && !h.contains(h1); };
  return Array.from(box.querySelectorAll("p, div, section")).filter((el) =>
    between(el) && !el.querySelector(BLOCKISH) && !el.closest("nav, aside, footer, figure") && !siteHeader(el)
    && collapse(el.textContent ?? "").length >= 40);
}

/** Roots of the main text: the running text, the headline and the headings of the main column, the lead. */
function rootsOf(ctx: Pick<CleanContext, "keep" | "body" | "main">): Element[] {
  const headings = ctx.keep.filter((el) => el.matches(HEADING) && (el.matches("h1") || !!ctx.main?.contains(el)));
  return [...ctx.body, ...headings, ...lead(ctx, headings)];
}

const docOrder = (a: Element, b: Element): number => (a.compareDocumentPosition(b) & 4 /* FOLLOWING */ ? -1 : 1);

/** Each text node of `top` with the block it belongs to: the nearest unit around it, else its root. In a `leafy` root
 *  (a box the person brought back, like comments built of divs) the nearest box around it is its block. */
function owned(top: readonly Element[], leafy: ReadonlySet<Element>): Map<Element, Text[]> {
  const owners = new Set<Element>();
  for (const r of top) {
    owners.add(r);
    r.querySelectorAll(UNIT).forEach((el) => owners.add(el));
    if (leafy.has(r)) r.querySelectorAll("div, section, article").forEach((el) => owners.add(el));
  }
  const byOwner = new Map<Element, Text[]>();
  for (const r of top) {
    for (const n of textNodes(r)) {
      let el: Element | null = n.parentElement;
      while (el && !owners.has(el)) el = el.parentElement;
      if (!el) continue;
      const list = byOwner.get(el) ?? [];
      list.push(n);
      byOwner.set(el, list);
    }
  }
  return byOwner;
}

/** Whether a block is a block at all: words of its own, not contact details only ("tel.: 549 211 296"). */
const hasWords = (source: string): boolean => /\p{L}/u.test(source) && !contactOnly(source);

/** The state for `ctx`'s page: the one there is, or a new one read from the page. */
function ensure(ctx: CleanContext): State {
  if (state && state.ctx.doc === ctx.doc) {
    state.ctx = ctx; // Stay clean may have read the page again: the same caption, the latest knowledge
    return state;
  }
  clearTranslation();
  const s: State = {
    ctx, roots: [], units: new Map(), byEl: new Map(), slotOf: new Map(), target: readerLang(ctx.win.navigator),
    translatedAny: false, keepSource: false, originalOn: false, plainOn: false, next: 0, nextPlain: 0, memo: new Map(),
    plainMemo: new Map(), asked: new Map(), watch: null, rewrites: new WeakMap(), main: ctx.main,
  };
  state = s;
  reconcile(s, rootsOf(ctx), new Set());
  return s;
}

/** The blocks of the main text still to translate, by id: on the first ask all of them; later, what the page added or
 *  rewrote since (and anything a run did not manage). Nothing read here leaves the browser. */
export function textBlocks(ctx: CleanContext): TextBlock[] {
  return pending(ensure(ctx));
}

const translated = (u: Unit): boolean => u.values?.translation !== undefined;

/** A block of the main text with its element and text nodes (round 2: claims, gist, Show me). */
export interface MainBlock { el: Element; nodes: Text[]; text: string }

/**
 * Round 2 (claims r2-01, gist r2-10): every block of the main text as the page shows it now, in document order, the
 * same blocks Translate reads but whatever their language (textBlocks leaves out what is already in the reader's
 * language) and without changing Translate's state. Left out: contact-only blocks, captions (a photo's credit is not
 * the article) and blocks of fewer than three words (a byline, a section name with the date).
 */
export function mainTextBlocks(ctx: Pick<CleanContext, "keep" | "body" | "main">): MainBlock[] {
  const roots = rootsOf(ctx).filter((el) => el.isConnected && !el.closest(SKIP)).sort(docOrder);
  const top = roots.filter((el) => !roots.some((o) => o !== el && o.contains(el)));
  const out: MainBlock[] = [];
  for (const [el, nodes] of owned(top, new Set())) {
    const text = wordsOf(nodes);
    if ((text.match(/\p{L}+/gu) ?? []).length < 3 || contactOnly(text) || el.closest("figcaption, caption")) continue;
    out.push({ el, nodes, text });
  }
  return out.sort((a, b) => docOrder(a.el, b.el));
}

function pending(s: State): TextBlock[] {
  return Array.from(s.units.values()).filter((u) => u.foreign && !translated(u) && u.el.isConnected).map((u) => ({ id: u.id, text: u.source }));
}

/** A translation shows on the page (or will, once the blocks waiting for it have it). */
const translationLive = (s: State): boolean => s.translatedAny && !s.keepSource;
/** What plain words of a block rewrite now: its translation while that shows, else the page's words. */
const baseOf = (s: State, u: Unit): Base => (translated(u) && !s.keepSource ? "translation" : "source");
const baseText = (u: Unit, base: Base): string => (base === "translation" ? u.translation ?? u.source : u.source);
const wordCount = (text: string): number => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/** Whether a block waits for plain words: long enough, not rewritten yet for what it shows, and not a foreign block
 *  still waiting for its translation (its plain words are the translation's, once it has one). */
function wantsPlain(s: State, u: Unit): boolean {
  if (!u.el.isConnected) return false;
  const base = baseOf(s, u);
  if (base === "source" && u.foreign && translationLive(s)) return false;
  if (u.values?.[plainOf(base)] !== undefined) return false;
  return wordCount(baseText(u, base)) >= PLAIN_MIN_WORDS;
}

/** Puts plain words a block had before for the same words (no model needed). True: it has them now. */
function plainFromMemo(s: State, u: Unit): boolean {
  const base = baseOf(s, u);
  const before = s.plainMemo.get(baseText(u, base));
  return before !== undefined && putPlain(s, u, base, before);
}

/**
 * Plain words (r2-04): the blocks of the main text to rewrite, as the page shows them now (a translated block's
 * translation, else the page's words), by id. Only blocks with no plain words yet for those words; a block rewritten
 * before for the same words gets them again without the model. Nothing read here leaves the browser.
 */
export function plainBlocks(ctx: CleanContext): TextBlock[] {
  const s = ensure(ctx);
  const out: TextBlock[] = [];
  quiet(() => {
    for (const u of s.units.values()) {
      if (!wantsPlain(s, u) || plainFromMemo(s, u)) continue;
      const text = baseText(u, baseOf(s, u));
      s.asked.set(u.id, text);
      out.push({ id: u.id, text });
    }
  });
  return out;
}

/** Plain words on (true) or off ("As written"). Returns how many blocks show plain words now. */
export function plainShown(on: boolean): number {
  const s = state;
  if (!s) return 0;
  s.plainOn = on;
  render();
  return Array.from(s.units.values()).filter((u) => PLAIN_VIEWS.has(u.view)).length;
}

/** Puts plain words into the page; returns how many blocks changed. A rewrite of words the block no longer shows (the
 *  person chose Keep <language> meanwhile, or the page rewrote it) is left out. */
export function applyPlain(blocks: readonly TextBlock[]): number {
  const s = state;
  if (!s) return 0;
  return quiet(() => {
    let changed = 0;
    for (const b of blocks) {
      const u = s.units.get(b.id);
      const text = typeof b.text === "string" ? collapse(b.text) : "";
      const asked = s.asked.get(b.id);
      if (!u || !text || asked === undefined || !u.el.isConnected) continue;
      const base = baseOf(s, u);
      if (baseText(u, base) !== asked || u.values?.[plainOf(base)] !== undefined) continue;
      if (u.slots ? rewritten(s, u, u.nodes) : wordsOf(u.nodes) !== u.source) { if (s.watch) schedule(s.watch); continue; }
      if (putPlain(s, u, base, text)) changed++;
    }
    return changed;
  });
}

/**
 * Brings the blocks up to date with the page: new blocks get new ids, a block the page rewrote after its translation
 * shows the page's new words again and waits under a new id (its new words are the original from now on), a block
 * gone from the page is forgotten. A block whose words were translated before gets that translation again without
 * the model. Returns how many blocks wait for the model.
 */
function reconcile(s: State, roots: readonly Element[], leafy: ReadonlySet<Element>): number {
  const all = [...new Set([...s.roots, ...roots])].filter((el) => el.isConnected && !el.closest(SKIP)).sort(docOrder);
  const top = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
  s.roots = top;
  for (const u of Array.from(s.units.values())) if (!u.el.isConnected) forget(s, u);
  let waiting = 0;
  for (const [el, nodes] of owned(top, leafy)) {
    const known = s.byEl.get(el);
    const source = wordsOf(nodes);
    let renewed = false;
    if (known) {
      if (known.slots) {
        if (!rewritten(s, known, nodes)) continue;
        undo(s, known);
        renewed = true;
      } else if (known.source === source) {
        known.nodes = nodes;
        continue; // still waiting, as it was
      } else {
        forget(s, known);
      }
    }
    if (!hasWords(source)) continue;
    const foreign = !inLang(source, s.target);
    const before = foreign ? s.memo.get(source) : undefined;
    if (before === undefined) {
      // A block the page keeps rewriting with new words (a clock, a live counter) stays in the page's words after a few
      // rounds: each one would be another call to the model.
      const rounds = (s.rewrites.get(el) ?? 0) + (renewed ? 1 : 0);
      if (renewed) s.rewrites.set(el, rounds);
      if (rounds > MAX_REWRITES) continue;
    }
    // Ids: "t<n>" for a block to translate (as before plain words came), "p<n>" for one already in the reader's language.
    const unit: Unit = { id: foreign ? `t${s.next++}` : `p${s.nextPlain++}`, el, nodes, source, foreign, view: "source" };
    s.units.set(unit.id, unit);
    s.byEl.set(el, unit);
    const hasTranslation = before !== undefined && putTranslation(s, unit, before);
    // What waits for the model: a translation while one shows, plain words while they are on.
    if (foreign && !hasTranslation && translationLive(s)) waiting++;
    else if (s.plainOn && wantsPlain(s, unit) && !plainFromMemo(s, unit)) waiting++;
  }
  return waiting;
}

/** The value Distill shows in slot `i` of a block now. */
const shownValue = (u: Unit, i: number): string | undefined => u.values?.[u.view]?.[i];

/** A block Distill wrote into that the page changed since: a new text node of words, one of its nodes gone, or a node
 *  that no longer holds what Distill shows there (the page wrote it again, even its old words). */
function rewritten(_s: State, u: Unit, nodes: readonly Text[]): boolean {
  const slots = u.slots ?? [];
  const ours = new Set(slots);
  if (nodes.some((n) => !ours.has(n) && /\S/.test(n.nodeValue ?? ""))) return true;
  return slots.some((n, i) => !n.isConnected || !u.el.contains(n) || n.nodeValue !== shownValue(u, i));
}

/** Shows the page's words again where Distill's still stand, and forgets the block. */
function undo(s: State, u: Unit): void {
  setView(s, u, "source");
  forget(s, u);
}

function forget(s: State, u: Unit): void {
  for (const n of u.slots ?? []) s.slotOf.delete(n);
  s.units.delete(u.id);
  s.asked.delete(u.id);
  if (s.byEl.get(u.el) === u) s.byEl.delete(u.el);
}

/**
 * Spreads a translation over a block's text nodes, so links, bold and the like keep words of their own. A node whose
 * own words come back unchanged in the translation (a name, a number, an address) keeps exactly those; the rest is
 * shared out by the source's lengths, at word boundaries.
 */
export function spread(translation: string, slots: readonly string[]): string[] {
  const n = slots.length;
  if (n <= 1) return n ? [translation] : [];
  const out = slots.map(() => "");
  const anchors: { i: number; a: number; b: number }[] = [];
  let pos = 0;
  slots.forEach((s, i) => {
    const w = s.trim();
    if (w.length < 3 && !/\d/.test(w)) return;
    for (let at = translation.indexOf(w, pos); at >= 0; at = translation.indexOf(w, at + 1)) {
      const before = translation[at - 1] ?? " ";
      const after = translation[at + w.length] ?? " ";
      if (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after)) continue;
      anchors.push({ i, a: at, b: at + w.length });
      pos = at + w.length;
      return;
    }
  });
  let prev = { i: -1, b: 0 };
  for (const anchor of [...anchors, { i: n, a: translation.length, b: translation.length }]) {
    const gap = translation.slice(prev.b, anchor.a);
    const free: number[] = [];
    for (let j = prev.i + 1; j < anchor.i; j++) free.push(j);
    if (free.length) share(gap, free, slots, out);
    else if (prev.i >= 0) out[prev.i] += gap;
    else if (anchor.i < n) out[anchor.i] = gap + (out[anchor.i] ?? "");
    if (anchor.i < n) out[anchor.i] = (out[anchor.i] ?? "") + translation.slice(anchor.a, anchor.b);
    prev = anchor;
  }
  return out;
}

/** Shares `text` out over the slots `idx`, in order, by the length of each slot's source, whole words only. */
function share(text: string, idx: readonly number[], slots: readonly string[], out: string[]): void {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const words = text.slice(lead.length).match(/\S+\s*/g) ?? [];
  const weights = idx.map((j) => Math.max(1, (slots[j] ?? "").trim().length));
  const total = weights.reduce((a, b) => a + b, 0);
  // Largest remainder, then every slot gets a word while there are words to give.
  const exact = weights.map((w) => (words.length * w) / total);
  const counts = exact.map(Math.floor);
  let left = words.length - counts.reduce((a, b) => a + b, 0);
  exact.map((x, k) => ({ k, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r).forEach(({ k }) => { if (left > 0) { counts[k] = (counts[k] ?? 0) + 1; left--; } });
  for (let k = 0; k < counts.length; k++) {
    if (counts[k] !== 0) continue;
    const donor = counts.indexOf(Math.max(...counts));
    if ((counts[donor] ?? 0) > 1) { counts[donor] = (counts[donor] ?? 0) - 1; counts[k] = 1; }
  }
  let w = 0;
  idx.forEach((j, k) => {
    const take = words.slice(w, w + (counts[k] ?? 0)).join("");
    w += counts[k] ?? 0;
    out[j] = (k === 0 ? lead : "") + take;
  });
}

/** What a block should show now: Original and close show the page's words; Keep <language> shows them too (plain
 *  words included only of the page's words); Plain shows plain words where the block has them for what it shows. */
function viewOf(s: State, u: Unit): View {
  if (!u.values || s.originalOn) return "source";
  const tr = translated(u) && !s.keepSource;
  if (s.plainOn) {
    if (tr && u.values.plainTranslation) return "plainTranslation";
    if (!tr && u.values.plainSource) return "plainSource";
  }
  return tr ? "translation" : "source";
}

/** Writes view `to` into a block. A node the page changed since (it no longer holds what Distill showed) is left alone. */
function setView(s: State, u: Unit, to: View): void {
  const from = u.view;
  const was = u.values?.[from];
  const next = u.values?.[to];
  if (from !== to && u.slots && was && next) {
    u.slots.forEach((node, i) => {
      if (node.isConnected && node.nodeValue === was[i]) node.nodeValue = next[i] ?? "";
    });
  }
  u.view = to;
  const el = u.el;
  if (TRANSLATED_VIEWS.has(to)) {
    el.setAttribute(TRANSLATED, "");
    el.setAttribute("lang", s.target);
  } else if (TRANSLATED_VIEWS.has(from)) {
    el.removeAttribute(TRANSLATED);
    if (u.lang === null || u.lang === undefined) el.removeAttribute("lang");
    else el.setAttribute("lang", u.lang);
  }
  if (PLAIN_VIEWS.has(to)) el.setAttribute(PLAIN, "");
  else if (PLAIN_VIEWS.has(from)) el.removeAttribute(PLAIN);
}

const show = (s: State, u: Unit): void => setView(s, u, viewOf(s, u));

/** Takes a block's text nodes to write into (once): the ones with words, their values as the page has them now. False:
 *  nothing to write into. */
function claim(s: State, u: Unit): boolean {
  if (u.slots) return true;
  const slots = u.nodes.filter((n) => /\S/.test(n.nodeValue ?? "") && n.isConnected);
  if (!slots.length) return false;
  u.slots = slots;
  u.values = { source: slots.map((n) => n.nodeValue ?? "") };
  u.lang = u.el.getAttribute("lang");
  u.view = "source";
  slots.forEach((n, i) => s.slotOf.set(n, { u, i }));
  return true;
}

/** Puts one block's translation in (its text nodes keep the page's words to go back to). False: nothing to put it in. */
function putTranslation(s: State, unit: Unit, text: string): boolean {
  if (!claim(s, unit) || !unit.values) return false;
  unit.values.translation = spread(text, unit.values.source ?? []);
  unit.translation = text;
  s.translatedAny = true;
  if (s.memo.size >= MEMO_MAX) s.memo.delete(s.memo.keys().next().value as string);
  s.memo.set(unit.source, text);
  show(s, unit);
  return true;
}

/** Puts one block's plain words of `base` in, spread over the same text nodes. False: nothing to put them in. */
function putPlain(s: State, unit: Unit, base: Base, text: string): boolean {
  if (!claim(s, unit) || !unit.values) return false;
  const over = unit.values[base];
  if (!over) return false;
  unit.values[plainOf(base)] = spread(text, over);
  if (s.plainMemo.size >= MEMO_MAX) s.plainMemo.delete(s.plainMemo.keys().next().value as string);
  s.plainMemo.set(baseText(unit, base), text);
  show(s, unit);
  return true;
}

/** Puts translations into the page; returns how many blocks changed. A block the page changed while it was being
 *  translated is left as it is now: the next look at the page hands it over again with its new words. */
export function applyTranslation(blocks: readonly TextBlock[]): number {
  const s = state;
  if (!s) return 0;
  const changed = quiet(() => {
    let n = 0;
    for (const b of blocks) {
      const unit = s.units.get(b.id);
      const text = typeof b.text === "string" ? collapse(b.text) : "";
      if (!unit || !text || translated(unit)) continue;
      if (unit.slots ? rewritten(s, unit, unit.nodes) : wordsOf(unit.nodes) !== unit.source) { if (s.watch) schedule(s.watch); continue; }
      if (putTranslation(s, unit, text)) n++;
    }
    return n;
  });
  // Plain words are on: the blocks just translated wait for plain words of their translation (the frame asks).
  if (changed && s.plainOn && s.watch) tell(s.watch, changed);
  return changed;
}

/** Distill's switches are on (true) or the page shows its own words everywhere (false): only then is text the page
 *  adds later handed over. */
const active = (s: State): boolean => !s.originalOn && (translationLive(s) || s.plainOn);

function render(): void {
  const s = state;
  if (!s) return;
  quiet(() => { for (const unit of s.units.values()) if (unit.values) show(s, unit); });
  // A translation or plain words are back on the page: what the page added meanwhile is handed over now.
  if (active(s) && s.watch?.waiting) schedule(s.watch);
}

/** The page's own words (true) or the translation (false). The page's own words are as written: plain words go off. */
export function showSource(on: boolean): void {
  if (!state) return;
  state.keepSource = on;
  if (on) state.plainOn = false;
  render();
}

/** Takes every change back (close). */
export function clearTranslation(): void {
  if (!state) return;
  stopWatching(state);
  state.originalOn = true;
  render();
  state = null;
}

/** Original was turned on or off: while on, the page shows its own words whatever the translation state. */
export function originalShown(on: boolean): void {
  if (!state) return;
  state.originalOn = on;
  render();
}

// ---- Text the page adds later --------------------------------------------------------------------------------------
// While a translation is on the page, new or rewritten text of the main column (a single-page app's next view, "load
// more", a lazy section, comments the person brought back from More) is translated too. The page side only notices and
// counts: it tells the caption frame how many blocks wait (never their words), and the frame asks for them. Distill's
// own writes never wake it: they run inside quiet(), which hands over what the page did before and drops what Distill
// did, and a text node holding exactly its first words or its translation is Distill's either way.

/** Quiet time after the page's last change before looking (ms), at most this long after the first one, at most once per
 *  MIN_GAP_MS (stretched when a look takes long, so a busy page stays smooth). */
const QUIET_MS = 500;
const MAX_WAIT_MS = 2500;
const MIN_GAP_MS = 1000;
const LOOK_SHARE = 1 / 8;
const MEMO_MAX = 2000;
/** A block the page rewrote this many times after its translation is translated no more. */
const MAX_REWRITES = 3;
const HIDE = "data-distill-hide";
const IGNORED = new Set(["script", "style", "link", "meta", "noscript", "template", "br", "wbr", "distill-caption"]);
const BODY_KINDS = new Set(["paragraph", "list", "table", "quote", "code"]);

interface Watch {
  tabId: number;
  observer: MutationObserver;
  current: () => CleanContext | null;
  timer?: ReturnType<typeof setTimeout>;
  firstChange: number;
  lastRun: number;
  gap: number;
  /** Something changed while the page showed its own words: look once the translation is back. */
  waiting: boolean;
}

/**
 * From the caption frame once a translation is on the page: watch for text the page adds or rewrites, and tell the
 * frame of tab `tabId` (distill:caption:moreText, a count). `current` gives what Clean knows now (Stay clean keeps it).
 */
export function watchText(tabId: number, current: () => CleanContext | null): void {
  const s = state;
  if (!s) return;
  if (s.watch) { s.watch.tabId = tabId; return; }
  const w: Watch = { tabId, current, firstChange: 0, lastRun: 0, gap: MIN_GAP_MS, waiting: false, observer: new MutationObserver((r) => noticed(w, r)) };
  s.watch = w;
  w.observer.observe(s.ctx.doc.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [HIDE], attributeOldValue: true,
  });
  // What changed while the first translation ran.
  schedule(w);
}

function stopWatching(s: State): void {
  const w = s.watch;
  if (!w) return;
  w.observer.disconnect();
  if (w.timer !== undefined) clearTimeout(w.timer);
  s.watch = null;
}

/** Runs Distill's own writes: what the page did before them is noticed, what they did is not. */
function quiet<T>(write: () => T): T {
  const w = state?.watch;
  if (w) noticed(w, w.observer.takeRecords());
  try { return write(); } finally { w?.observer.takeRecords(); }
}

/** Whether the page's changes can hold text to translate. No layout is read here. */
function noticed(w: Watch, records: readonly MutationRecord[]): void {
  const s = state;
  if (!s || s.watch !== w || !records.length) return;
  const main = s.main;
  const restored = () => Array.from(s.ctx.removed.values()).filter((el) => el.isConnected && !el.hasAttribute(HIDE));
  /** In the main column (or a block of it, or a box the person brought back), and not hidden or Distill's own. */
  const near = (n: Node): boolean => {
    const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
    if (!el || el.closest(`distill-caption, [${HIDE}]`)) return false;
    if (!main?.isConnected) return true; // the main text is gone: a single-page app's next view
    return main.contains(el) || s.roots.some((r) => r.contains(el)) || restored().some((r) => r.contains(el));
  };
  const words = (n: Node): boolean => {
    if (n.nodeType === 3) return /\p{L}/u.test(n.nodeValue ?? "");
    return n.nodeType === 1 && !IGNORED.has((n as Element).localName) && /\p{L}/u.test(n.textContent ?? "");
  };
  let wake = false;
  for (const r of records) {
    if (r.type === "attributes") {
      // A box Clean hid is back on the page (the person chose Show in More).
      if (r.oldValue !== null && !(r.target as Element).hasAttribute(HIDE)) wake = true;
    } else if (r.type === "characterData") {
      const node = r.target as Text;
      // A node of a block Distill wrote into that holds what Distill shows there: nothing changed.
      const at = s.slotOf.get(node);
      if (at && node.nodeValue === shownValue(at.u, at.i)) continue;
      if (near(node)) wake = true;
    } else if ((Array.from(r.addedNodes).some(words) || Array.from(r.removedNodes).some(words)) && near(r.target)) {
      wake = true;
    }
    if (wake) break;
  }
  if (wake) schedule(w);
}

function schedule(w: Watch): void {
  if (state?.watch !== w) return;
  const now = Date.now();
  w.firstChange ||= now;
  if (w.timer !== undefined) clearTimeout(w.timer);
  const at = Math.max(Math.min(now + QUIET_MS, w.firstChange + MAX_WAIT_MS), w.lastRun + w.gap);
  w.timer = setTimeout(() => look(w), Math.max(0, at - now));
}

/** Reads the page again and tells the frame how many blocks wait for a translation. */
function look(w: Watch): void {
  w.timer = undefined;
  w.firstChange = 0;
  const s = state;
  if (!s || s.watch !== w) return;
  if (!active(s)) { w.waiting = true; return; }
  w.waiting = false;
  const t0 = performance.now();
  w.lastRun = Date.now();
  let count = 0;
  try {
    count = quiet(() => reread(s, w));
  } finally {
    w.gap = Math.max(MIN_GAP_MS, (performance.now() - t0) / LOOK_SHARE);
  }
  if (count > 0) tell(w, count);
}

/** The main text as the page reads now (the page reader again, as Stay clean does), with what Clean knew and the boxes
 *  the person brought back. */
function reread(s: State, w: Watch): number {
  const ctx = w.current() ?? s.ctx;
  s.ctx = ctx;
  const read: Element[] = [];
  const page = extractPage(ctx.doc, ctx.win.location.href, { onSource: (_id, el) => read.push(el) });
  const kinds = page.blocks.map((b) => b.kind);
  const shown = (el: Element) => !el.closest(`[${HIDE}]`);
  const keep = read.filter(shown);
  const body = read.filter((el, i) => shown(el) && BODY_KINDS.has(kinds[i] ?? ""));
  // The main column the translation started with, while it is on the page: a late box beside it (a video widget, tags,
  // a teaser the page loads on scroll) is not the main text, though the page reader may take it in. When a single-page
  // app replaced it, the column the page reads now.
  if (!s.main?.isConnected) s.main = body.length ? body.reduce<Element>((a, b) => commonAncestor(a, b), body[0] as Element) : ctx.main;
  const main = s.main;
  const inMain = (el: Element) => !!main?.contains(el);
  const live = (els: readonly Element[]) => els.filter((el) => el.isConnected);
  const restored = Array.from(ctx.removed.values()).filter((el) => el.isConnected && shown(el));
  const roots = [
    ...rootsOf({
      keep: [...new Set([...live(ctx.keep), ...keep])].filter(inMain),
      body: [...new Set([...live(ctx.body), ...body])].filter(inMain),
      main,
    }),
    ...restored,
  ];
  return reconcile(s, roots, new Set(restored));
}

function tell(w: Watch, count: number): void {
  const msg: CaptionMoreText = { type: "distill:caption:moreText", tabId: w.tabId, count };
  try {
    void chrome.runtime.sendMessage(msg).catch(() => undefined);
  } catch {
    if (state) stopWatching(state); // the extension went away: this copy of the script is orphaned
  }
}

/** Round 3 (r3-07, prices and dates in your terms): runs another module's change to the main text's text nodes so the
 *  text watcher never takes it for the page's own. */
export function quietly<T>(write: () => T): T {
  return quiet(write);
}
