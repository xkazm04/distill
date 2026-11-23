// Spark universal-core round 2, cards 1, 2 and 10, the page side: claim marks in the main text and "Show me".
//
// The marks are CSS Custom Highlights (CSS.highlights): ranges over the page's own text nodes, painted by one Distill
// style. Not one element is added or split, so links stay links and Translate, which swaps the values of those very
// text nodes, keeps working; each block with a mark carries a data-distill-claim attribute naming its claims. When the
// text of a marked block changes (a translation goes in or comes out, the page rewrites it) the marks are found again
// a moment later; a sentence no longer on the page is simply not marked. Original takes the marks off and Back to
// Distill puts them back; close takes everything away (page.ts calls clearClaims).
import { findSentence } from "@distill/engine";
import type { ClaimMark, TextBlock } from "../messages";
import type { CleanContext } from "./context";
import { markOnPage } from "./contact";
import { TEXT_SPLIT_EVENT } from "./textSplit";
import { mainTextBlocks } from "./translate";

/** On each block with a mark: the ids of its claims, space-separated. */
export const CLAIM_ATTR = "data-distill-claim";
/** The highlight names: unchecked claims, a checked claim by its verdict (r2-02), and Show me's moment. */
export const CLAIM_HIGHLIGHT = "distill-claim";
const SHOW_HIGHLIGHT = "distill-show";
const VERDICTS = ["supported", "disputed", "mixed", "notFound"] as const;
const STYLE_ID = "distill-claims-style";
const ORIGINAL = "data-distill-original";
/** How long Show me's highlight stays. */
const SHOW_MS = 2400;
/** How long the page's text must be quiet before the marks are found again. */
const REMARK_MS = 120;

// Underlines in the text's own colour (no colour of Distill's on the page); a checked claim's line says its verdict by
// its style. Show me uses the system's own find-in-page colours.
const CSS = [
  `::highlight(${CLAIM_HIGHLIGHT}) { text-decoration: underline dotted; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }`,
  `::highlight(${CLAIM_HIGHLIGHT}-supported) { text-decoration: underline solid; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }`,
  `::highlight(${CLAIM_HIGHLIGHT}-disputed) { text-decoration: underline wavy; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }`,
  `::highlight(${CLAIM_HIGHLIGHT}-mixed), ::highlight(${CLAIM_HIGHLIGHT}-notFound) { text-decoration: underline dashed; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }`,
  `::highlight(${SHOW_HIGHLIGHT}) { background-color: Mark; color: MarkText; }`,
].join("\n");

interface Known { el: Element; nodes: Text[] }

/** The main text's blocks by id, from the last readMainText. Never leaves the page. */
let blocks = new Map<string, Known>();
let ids = new WeakMap<Element, string>();
let nextId = 0;
let marks: { claims: ClaimMark[]; observer: MutationObserver | null; timer: ReturnType<typeof setTimeout> | null } | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;

type Registry = Map<string, Highlight>;
const registry = (doc: Document): Registry | null => {
  const css = (doc.defaultView as (Window & { CSS?: { highlights?: Registry } }) | null)?.CSS;
  return css?.highlights ?? null;
};
const HighlightOf = (doc: Document): typeof Highlight | null =>
  ((doc.defaultView as (Window & { Highlight?: typeof Highlight }) | null)?.Highlight) ?? null;

/**
 * Every block of the main text as the page shows it now (whatever its language), with ids that stay the same for the
 * same element while the strip is open ("m0", "m1", ...). Claims and the gist name these ids.
 */
export function readMainText(ctx: CleanContext): TextBlock[] {
  const next = new Map<string, Known>();
  const out: TextBlock[] = [];
  for (const b of mainTextBlocks(ctx)) {
    let id = ids.get(b.el);
    if (!id) { id = `m${nextId++}`; ids.set(b.el, id); }
    next.set(id, { el: b.el, nodes: b.nodes });
    out.push({ id, text: b.text });
  }
  blocks = next;
  return out;
}

/** A block's text nodes now: the ones read, while they are in it; else every text node in it. */
function nodesOf(k: Known): Text[] {
  const live = k.nodes.filter((n) => n.isConnected && k.el.contains(n));
  // r3-07: prices and dates in your terms split a node into pieces (data-distill-term): read the block's nodes as they are.
  if (live.length && !k.el.querySelector("[data-distill-term]")) return live;
  const walker = k.el.ownerDocument.createTreeWalker(k.el, 4 /* SHOW_TEXT */);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest("script, style, noscript")) out.push(n as Text);
  return out;
}

/** A range over `sentence` in block `k` as its text stands now, or null when the sentence is not there. */
export function rangeOf(doc: Document, k: Known, sentence: string): Range | null {
  // The block's words, one space for each run, with the text node and offset of each character (a <br> between two
  // nodes reads as a space, as Translate reads it).
  let flat = "";
  const at: { node: Text; offset: number }[] = [];
  let prev: Text | null = null;
  for (const node of nodesOf(k)) {
    const value = node.nodeValue ?? "";
    if (prev && prev.nextSibling !== node && node.previousSibling?.nodeName === "BR" && !/\s$/.test(flat)) {
      flat += " ";
      at.push({ node, offset: 0 });
    }
    for (let i = 0; i < value.length; i++) {
      const ch = /\s/.test(value[i] as string) ? " " : (value[i] as string);
      if (ch === " " && (flat === "" || flat.endsWith(" "))) continue;
      flat += ch;
      at.push({ node, offset: i });
    }
    prev = node;
  }
  const found = findSentence(flat, sentence);
  if (!found) return null;
  const start = flat.indexOf(found);
  const first = at[start];
  const last = at[start + found.length - 1];
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).append(style);
}

const highlightNames = (): string[] => [CLAIM_HIGHLIGHT, ...VERDICTS.map((v) => `${CLAIM_HIGHLIGHT}-${v}`)];

/** Paints the marks of `marks.claims` as the page's text stands now. Returns how many were found. */
function paint(doc: Document): number {
  const reg = registry(doc);
  const H = HighlightOf(doc);
  doc.querySelectorAll(`[${CLAIM_ATTR}]`).forEach((el) => el.removeAttribute(CLAIM_ATTR));
  for (const name of highlightNames()) reg?.delete(name);
  if (!marks) return 0;
  const byName = new Map<string, Range[]>();
  const onBlock = new Map<Element, string[]>();
  let found = 0;
  for (const c of marks.claims) {
    const k = blocks.get(c.blockId);
    if (!k?.el.isConnected) continue;
    const range = rangeOf(doc, k, c.text);
    if (!range) continue;
    found++;
    const name = c.verdict ? `${CLAIM_HIGHLIGHT}-${c.verdict}` : CLAIM_HIGHLIGHT;
    byName.set(name, [...(byName.get(name) ?? []), range]);
    onBlock.set(k.el, [...(onBlock.get(k.el) ?? []), c.id]);
  }
  for (const [el, list] of onBlock) el.setAttribute(CLAIM_ATTR, list.join(" "));
  // Original shows the page as it was: no marks (the attributes stay, they change nothing on screen).
  if (reg && H && !doc.documentElement.hasAttribute(ORIGINAL)) for (const [name, ranges] of byName) reg.set(name, new H(...ranges));
  return found;
}

/** The marks are found again once the page's text is quiet: Translate swapped words, the page rewrote a block, or
 *  Original was switched. */
function watch(doc: Document): void {
  if (!marks || marks.observer) return;
  const m = marks;
  const observer = new MutationObserver((records) => {
    if (marks !== m) return;
    const els = Array.from(blocks.values(), (k) => k.el).filter((el) => el.hasAttribute(CLAIM_ATTR) || m.claims.some((c) => blocks.get(c.blockId)?.el === el));
    const touched = records.some((r) =>
      (r.type === "attributes" && r.target === doc.documentElement && r.attributeName === ORIGINAL)
      || (r.type !== "attributes" && els.some((el) => el.contains(r.target))));
    if (!touched) return;
    again();
  });
  // r3-07: a price or date written your way split or rejoined a text node under a mark (caption/textSplit.ts).
  const again = () => {
    if (marks !== m) { doc.removeEventListener(TEXT_SPLIT_EVENT, again); return; }
    if (m.timer) clearTimeout(m.timer);
    m.timer = setTimeout(() => { m.timer = null; if (marks === m) paint(doc); }, REMARK_MS);
  };
  doc.addEventListener(TEXT_SPLIT_EVENT, again);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: [ORIGINAL] });
  if (doc.body) observer.observe(doc.body, { characterData: true, childList: true, subtree: true });
  m.observer = observer;
}

/** Underlines the claims' sentences in their blocks; replaces earlier marks. Returns how many were found and marked. */
export function markClaims(doc: Document, claims: readonly ClaimMark[]): number {
  if (!registry(doc) || !HighlightOf(doc)) return 0;
  ensureStyle(doc);
  if (!marks) marks = { claims: [], observer: null, timer: null };
  marks.claims = claims.slice(0, 40);
  const found = paint(doc);
  watch(doc);
  return found;
}

/** Scrolls to `sentence` in block `blockId` and highlights it for a moment. False when it is not on the page. When the
 *  block is there but its words changed (a translation shows), the block itself is outlined instead. */
export function showText(doc: Document, blockId: string, sentence: string): boolean {
  const k = blocks.get(blockId);
  if (!k?.el.isConnected) return false;
  const range = rangeOf(doc, k, sentence);
  const reg = registry(doc);
  const H = HighlightOf(doc);
  if (!range || !reg || !H) { markOnPage(doc, k.el); return true; }
  ensureStyle(doc);
  reg.set(SHOW_HIGHLIGHT, new H(range));
  const win = doc.defaultView;
  const r = range.getBoundingClientRect();
  // Into the upper third of the window: the strip covers the bottom (up to 45% with More open).
  if (win && (r.top < 8 || r.bottom > win.innerHeight * 0.5)) {
    const instant = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    win.scrollTo({ top: Math.max(0, r.top + win.scrollY - win.innerHeight / 3), behavior: instant ? "auto" : "smooth" });
  }
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(() => { showTimer = null; registry(doc)?.delete(SHOW_HIGHLIGHT); }, SHOW_MS);
  return true;
}

/** Where a tour (r4-08) steps for `sentence` of block `blockId`: a range over its words as they stand now, or the block
 *  itself when its words changed (a translation shows); null when the block is gone. */
export function textTarget(doc: Document, blockId: string, sentence: string): { range: Range } | { el: Element } | null {
  const k = blocks.get(blockId);
  if (!k?.el.isConnected) return null;
  const range = rangeOf(doc, k, sentence);
  return range ? { range } : { el: k.el };
}

/** Takes every claim mark off (and Show me's highlight, and the style): the page as it was. */
export function clearClaims(doc: Document): void {
  if (marks?.observer) marks.observer.disconnect();
  if (marks?.timer) clearTimeout(marks.timer);
  marks = null;
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  const reg = registry(doc);
  for (const name of [...highlightNames(), SHOW_HIGHLIGHT]) reg?.delete(name);
  doc.querySelectorAll(`[${CLAIM_ATTR}]`).forEach((el) => el.removeAttribute(CLAIM_ATTR));
  doc.getElementById(STYLE_ID)?.remove();
  blocks = new Map();
  ids = new WeakMap();
  nextId = 0;
}
