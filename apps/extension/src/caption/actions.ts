// Round 3, card 9 (r3-09): what this page asks of you, the page side. Reads the main text (mainTextBlocks, the blocks
// readMainText names), finds the actions there (engine findActions: deadlines, sums to pay, what to bring, contacts and
// hours, by patterns, no AI), adds the ways to reach someone that round 1's contact finder (findContacts) sees in the
// visible page around the main text, keeps where each was found, paints a light highlight on their exact words and
// scrolls to one.
//
// The highlights are CSS Custom Highlights (as caption/claims.ts): ranges over the page's own text nodes, no element
// added or split. Original takes them off and Back to Distill puts them back; close takes everything away
// (page.ts calls clearActions). Page words only: findContacts and mainTextBlocks never read a form field.
import { findActions, findContacts, type FoundAction } from "@distill/engine";
import type { ActionItem } from "../messages";
import type { CleanContext } from "./context";
import { markOnPage } from "./contact";
import { TEXT_SPLIT_EVENT } from "./textSplit";
import { mainTextBlocks } from "./translate";

export const ACTION_HIGHLIGHT = "distill-action";
const SHOW_HIGHLIGHT = "distill-action-show";
const STYLE_ID = "distill-actions-style";
const ORIGINAL = "data-distill-original";
const HIDE = "data-distill-hide";
/** On each block with an action: the ids of its actions, space-separated. */
export const ACTION_ATTR = "data-distill-action";
const SHOW_MS = 2400;
const REMARK_MS = 120;
/** At most this many ways to reach someone are added from the contact finder (the main text's own come first). */
const MAX_CONTACTS = 4;

// A light wash in the system's find-in-page colour (no colour of Distill's on the page); Show me in the full colour.
const CSS = [
  `::highlight(${ACTION_HIGHLIGHT}) { background-color: color-mix(in srgb, Mark 32%, transparent); }`,
  `::highlight(${SHOW_HIGHLIGHT}) { background-color: Mark; color: MarkText; }`,
].join("\n");

interface Where { el: Element; nodes: Text[] }
interface Known { item: ActionItem; where: Where }

/** The last readActions: id -> the item and where it was found. Never leaves the page. */
let known = new Map<string, Known>();
let marks: { on: boolean; observer: MutationObserver | null; timer: ReturnType<typeof setTimeout> | null } | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;

type Registry = Map<string, Highlight>;
const registry = (doc: Document): Registry | null =>
  ((doc.defaultView as (Window & { CSS?: { highlights?: Registry } }) | null)?.CSS?.highlights) ?? null;
const HighlightOf = (doc: Document): typeof Highlight | null =>
  ((doc.defaultView as (Window & { Highlight?: typeof Highlight }) | null)?.Highlight) ?? null;

const CONTACT_LEAD: Record<string, string> = { phone: "Call", email: "Write to", address: "Address:", hours: "Hours:" };

/** Whether `el` is a part of the page the person sees now: not hidden by Clean, not inside a form control. */
const visible = (el: Element): boolean => !el.closest(`[${HIDE}]`);

/**
 * What this page asks of you, in reading order (ids `a0`, `a1`, ...): the main text's deadlines, sums, things to bring,
 * contacts and hours, then the contact finder's phones, e-mails, addresses and hours that sit in or next to the main
 * text and are on screen after Clean.
 */
export function readActions(ctx: CleanContext): ActionItem[] {
  const doc = ctx.doc;
  const lang = doc.documentElement.getAttribute("lang")?.trim() || "und";
  const blocks = mainTextBlocks(ctx).map((b, i) => ({ id: `b${i}`, ...b }));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const found: { item: FoundAction; where: Where; at: number }[] = [];
  for (const a of findActions(blocks.map(({ id, text }) => ({ id, text })), lang)) {
    const b = byId.get(a.blockId);
    if (b) found.push({ item: a, where: { el: b.el, nodes: b.nodes }, at: Math.max(0, b.text.indexOf(a.quote)) });
  }

  // Round 1's contact finder: the ways to reach whoever runs the page, from the part of the page that is shown.
  const els = new Map<string, Element>();
  const contacts = findContacts(doc, { url: doc.location?.href ?? "", onElement: (id, el) => els.set(id, el) });
  const have = new Set(found.map((f) => keyOf(f.item)));
  let added = 0;
  for (const c of contacts) {
    if (c.kind === "contactPage" || added >= MAX_CONTACTS) continue;
    const el = els.get(c.id);
    if (!el || !visible(el) || !nearMain(ctx, el)) continue;
    const item: FoundAction = {
      id: "", kind: c.kind === "hours" ? "hours" : "contact", text: `${CONTACT_LEAD[c.kind] ?? ""} ${c.text}`.trim(),
      blockId: "", quote: c.text, value: c.text,
    };
    if (c.href) item.href = c.href;
    const k = keyOf(item);
    if (have.has(k)) continue;
    // The finder joins lines of hours into one ("Po - Pá: 7.00 - 16.30; So: 8.00 - 11.00"): hours already listed in part
    // are the same hours. The first of them says the whole week (its highlight stays on its own words), the rest go.
    if (item.kind === "hours") {
      const flat = (s: string) => s.toLowerCase().replace(/[\s.,;:–-]+/g, "");
      const all = flat(c.text);
      const parts = found.filter((f) => f.item.kind === "hours" && all.includes(flat(f.item.value ?? f.item.quote)));
      const [first, ...rest] = parts;
      if (first) {
        first.item = { ...first.item, text: item.text, value: c.text };
        for (const r of rest) found.splice(found.indexOf(r), 1);
        continue;
      }
    }
    have.add(k);
    added++;
    found.push({ item, where: { el, nodes: [] }, at: 0 });
  }

  found.sort((a, b) => (a.where.el === b.where.el ? a.at - b.at : a.where.el.compareDocumentPosition(b.where.el) & 4 /* FOLLOWING */ ? -1 : 1));
  known = new Map();
  // Block ids name the element each was found in ("w0", "w1", ...), so two items of one block share one.
  const blockIds = new Map<Element, string>();
  return found.map((f, n) => {
    const id = `a${n}`;
    let blockId = blockIds.get(f.where.el);
    if (!blockId) { blockId = `w${blockIds.size}`; blockIds.set(f.where.el, blockId); }
    const item: ActionItem = { ...f.item, id, blockId };
    known.set(id, { item, where: f.where });
    return item;
  });
}

/** Two items are one when they name the same number, address or hours (written with or without spaces). */
function keyOf(a: Pick<FoundAction, "kind" | "href" | "value" | "quote">): string {
  if (a.href) return a.href.replace(/^tel:\+420/, "tel:").toLowerCase();
  const v = (a.value ?? a.quote).toLowerCase().replace(/[\s.,;:–-]+/g, "");
  return `${a.kind}:${v}`;
}

/** In the main column, or in an element the page reader took text from; on a page without a main column, anywhere. */
function nearMain(ctx: CleanContext, el: Element): boolean {
  if (!ctx.main) return true;
  if (ctx.main.contains(el)) return true;
  return ctx.keep.some((k) => k.contains(el) && k !== ctx.doc.body && k !== ctx.doc.documentElement);
}

/** A block's text nodes now: the ones read, while they are in it; else every text node in it. */
function nodesOf(w: Where): Text[] {
  const live = w.nodes.filter((n) => n.isConnected && w.el.contains(n));
  // r3-07: prices and dates in your terms split a node into pieces (data-distill-term): read the block's nodes as they are.
  if (live.length && !w.el.querySelector("[data-distill-term]")) return live;
  const walker = w.el.ownerDocument.createTreeWalker(w.el, 4 /* SHOW_TEXT */);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest("script, style, noscript")) out.push(n as Text);
  return out;
}

/** A range over the exact words `quote` (any run of spaces matching any other) in `w` as its text stands now, or null.
 *  Short words too ("377 912 345"): claims' rangeOf looks for sentences only. */
function rangeOfQuote(doc: Document, w: Where, quote: string): Range | null {
  let flat = "";
  const at: { node: Text; offset: number }[] = [];
  let prev: Text | null = null;
  for (const node of nodesOf(w)) {
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
  const want = quote.replace(/\s+/g, " ").trim();
  const start = want ? flat.indexOf(want) : -1;
  const first = at[start];
  const last = at[start + want.length - 1];
  if (start < 0 || !first || !last) return null;
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

/** Paints every action's exact words as the page's text stands now. Returns how many were found. */
function paint(doc: Document): number {
  const reg = registry(doc);
  const H = HighlightOf(doc);
  doc.querySelectorAll(`[${ACTION_ATTR}]`).forEach((el) => el.removeAttribute(ACTION_ATTR));
  reg?.delete(ACTION_HIGHLIGHT);
  if (!marks?.on) return 0;
  const ranges: Range[] = [];
  const onBlock = new Map<Element, string[]>();
  for (const { item, where } of known.values()) {
    if (!where.el.isConnected) continue;
    const range = rangeOfQuote(doc, where, item.quote);
    if (!range) continue;
    ranges.push(range);
    onBlock.set(where.el, [...(onBlock.get(where.el) ?? []), item.id]);
  }
  for (const [el, ids] of onBlock) el.setAttribute(ACTION_ATTR, ids.join(" "));
  if (reg && H && ranges.length && !doc.documentElement.hasAttribute(ORIGINAL)) reg.set(ACTION_HIGHLIGHT, new H(...ranges));
  return ranges.length;
}

/** The highlights are found again once the page's text is quiet (a translation went in, Original was switched). */
function watch(doc: Document): void {
  if (!marks || marks.observer) return;
  const m = marks;
  const els = () => Array.from(known.values(), (k) => k.where.el);
  const observer = new MutationObserver((records) => {
    if (marks !== m) return;
    const list = els();
    const touched = records.some((r) =>
      (r.type === "attributes" && r.target === doc.documentElement && r.attributeName === ORIGINAL)
      || (r.type !== "attributes" && list.some((el) => el.contains(r.target))));
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

/** The light highlight on every action's exact words on (true) or off. Returns how many are highlighted. */
export function markActions(doc: Document, on: boolean): number {
  if (!on) {
    if (marks?.observer) marks.observer.disconnect();
    if (marks?.timer) clearTimeout(marks.timer);
    marks = null;
    paint(doc);
    doc.getElementById(STYLE_ID)?.remove();
    return 0;
  }
  if (!registry(doc) || !HighlightOf(doc)) return 0;
  ensureStyle(doc);
  marks ??= { on: true, observer: null, timer: null };
  const n = paint(doc);
  watch(doc);
  return n;
}

/** Scrolls to action `id`'s words and flashes them; when its words are not there as written (a translation shows),
 *  the place is outlined instead. False when that part of the page is gone or hidden. */
export function showAction(doc: Document, id: string): boolean {
  const k = known.get(id);
  if (!k?.where.el.isConnected) return false;
  if (!doc.documentElement.hasAttribute(ORIGINAL) && !visible(k.where.el)) return false;
  const range = rangeOfQuote(doc, k.where, k.item.quote);
  const reg = registry(doc);
  const H = HighlightOf(doc);
  if (!range || !reg || !H) { markOnPage(doc, k.where.el); return true; }
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
  showTimer = setTimeout(() => {
    showTimer = null;
    registry(doc)?.delete(SHOW_HIGHLIGHT);
    if (!marks) doc.getElementById(STYLE_ID)?.remove();
  }, SHOW_MS);
  return true;
}

/** Where a tour (r4-08) steps for action `id`: a range over its exact words, or its place when they are not there as
 *  written; null when that part of the page is gone or hidden (as showAction). */
export function actionTarget(doc: Document, id: string): { range: Range } | { el: Element } | null {
  const k = known.get(id);
  if (!k?.where.el.isConnected) return null;
  if (!doc.documentElement.hasAttribute(ORIGINAL) && !visible(k.where.el)) return null;
  const range = rangeOfQuote(doc, k.where, k.item.quote);
  return range ? { range } : { el: k.where.el };
}

/** Takes every highlight off and forgets what was found: the page as it was. */
export function clearActions(doc: Document): void {
  markActions(doc, false);
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  registry(doc)?.delete(SHOW_HIGHLIGHT);
  doc.getElementById(STYLE_ID)?.remove();
  known = new Map();
}
