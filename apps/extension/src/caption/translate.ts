// #10 Translate in place: the page side. Hands the frame the main text's blocks, puts the translations in text node by
// text node, keeps the originals, and shows them again for "Keep <language>" and Original.
//
// Only the main text: the running text Clean found (ctx.body), the headline, the lead paragraphs under it and the
// headings of the main column. Never
// a form, a field's content, an editable area, code, or what the page marks translate="no". A block is the smallest
// element holding its own words (a paragraph, a list item, a table cell), so a list stays a list and a table a table.
// Only text nodes' values change: every element, link and attribute stays, and every original value is kept to be put
// back exactly. Nothing read here leaves the browser: the blocks go to the caption frame only.
import { detectLang } from "@distill/engine";
import type { TextBlock } from "../messages";
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

interface Unit { id: string; el: Element; nodes: Text[]; source: string }

interface State {
  ctx: CleanContext;
  list: TextBlock[];
  units: Map<string, Unit>;
  /** Every text node changed: its value as the page had it, and its translation. */
  original: Map<Text, string>;
  translated: Map<Text, string>;
  /** Blocks with a translation, and the lang attribute each had (null: none). */
  done: Map<Element, string | null>;
  target: string;
  /** The person chose "Keep <language>". */
  keepSource: boolean;
  /** Original is on. */
  originalOn: boolean;
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
function lead(ctx: CleanContext, headings: readonly Element[]): Element[] {
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

/** The blocks of the main text to translate, by id. */
export function textBlocks(ctx: CleanContext): TextBlock[] {
  if (state?.ctx === ctx) return state.list;
  clearTranslation();
  const target = readerLang(ctx.win.navigator);

  // Roots: the running text, the headline and the headings of the main column; never one inside another.
  const headings = ctx.keep.filter((el) => el.matches(HEADING) && (el.matches("h1") || !!ctx.main?.contains(el)));
  const roots = [...new Set([...ctx.body, ...headings, ...lead(ctx, headings)])]
    .filter((el) => el.isConnected && !el.closest(SKIP))
    .sort((a, b) => (a.compareDocumentPosition(b) & 4 /* FOLLOWING */ ? -1 : 1));
  const top = roots.filter((el) => !roots.some((o) => o !== el && o.contains(el)));

  // Each text node belongs to the nearest block around it.
  const owners = new Set<Element>();
  for (const r of top) { owners.add(r); r.querySelectorAll(UNIT).forEach((el) => owners.add(el)); }
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

  const units = new Map<string, Unit>();
  const list: TextBlock[] = [];
  for (const [el, nodes] of byOwner) {
    const source = wordsOf(nodes);
    if (!/\p{L}/u.test(source) || inLang(source, target)) continue; // numbers only, or already in the reader's language
    const id = `t${units.size}`;
    units.set(id, { id, el, nodes, source });
    list.push({ id, text: source });
  }
  state = { ctx, list, units, original: new Map(), translated: new Map(), done: new Map(), target, keepSource: false, originalOn: false };
  return list;
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

/** Writes the translation of one block (true) or its original words (false). A node the page changed since is left alone. */
function show(el: Element, nodes: readonly Text[], translated: boolean): void {
  if (!state) return;
  for (const node of nodes) {
    const from = translated ? state.original.get(node) : state.translated.get(node);
    const to = translated ? state.translated.get(node) : state.original.get(node);
    if (from === undefined || to === undefined || !node.isConnected) continue;
    if (node.nodeValue === from) node.nodeValue = to;
  }
  if (translated) {
    el.setAttribute(TRANSLATED, "");
    el.setAttribute("lang", state.target);
  } else {
    el.removeAttribute(TRANSLATED);
    const lang = state.done.get(el);
    if (lang === null || lang === undefined) el.removeAttribute("lang");
    else el.setAttribute("lang", lang);
  }
}

const showsTranslation = (): boolean => !!state && !state.keepSource && !state.originalOn;

/** Puts translations into the page; returns how many blocks changed. */
export function applyTranslation(blocks: readonly TextBlock[]): number {
  if (!state) return 0;
  let changed = 0;
  for (const b of blocks) {
    const unit = state.units.get(b.id);
    const text = typeof b.text === "string" ? collapse(b.text) : "";
    if (!unit || !text || state.done.has(unit.el)) continue;
    const slots = unit.nodes.filter((n) => /\S/.test(n.nodeValue ?? "") && n.isConnected);
    if (!slots.length) continue;
    const parts = spread(text, slots.map((n) => n.nodeValue ?? ""));
    slots.forEach((n, i) => {
      state?.original.set(n, n.nodeValue ?? "");
      state?.translated.set(n, parts[i] ?? "");
    });
    state.done.set(unit.el, unit.el.getAttribute("lang"));
    if (showsTranslation()) show(unit.el, slots, true);
    changed++;
  }
  return changed;
}

function render(): void {
  if (!state) return;
  const on = showsTranslation();
  for (const unit of state.units.values()) if (state.done.has(unit.el)) show(unit.el, unit.nodes, on);
}

/** The page's own words (true) or the translation (false). */
export function showSource(on: boolean): void {
  if (!state) return;
  state.keepSource = on;
  render();
}

/** Takes every change back (close). */
export function clearTranslation(): void {
  if (!state) return;
  state.keepSource = true;
  render();
  state = null;
}

/** Original was turned on or off: while on, the page shows its own words whatever the translation state. */
export function originalShown(on: boolean): void {
  if (!state) return;
  state.originalOn = on;
  render();
}
