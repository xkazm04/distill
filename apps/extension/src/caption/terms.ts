// Round 3, card 7 (r3-07): prices and dates in your terms, added beside the page's words in the main text: "1 200 Kč
// (€48)", "do 15. 3. (by 15 March)". The page's words stay; off, Original and close remove every addition.
//
// How an addition goes in: the text node holding the price is split at the price's ends and the price's own words are
// wrapped in one Distill span (data-distill-term) that carries the addition as an attribute; one Distill style shows it
// after the words (::after, never a text node of the page, so it is never read as page text, translated or sent). The
// span's title says the rate and its date. Every split is undone exactly: the first text node gets the words of all its
// pieces back and the pieces go.
//
// Translate and Plain swap the values of the main text's own text nodes. So they never see a split node: the content
// script runs each of their reads and writes inside termsAside(), which takes the additions out, runs it, and puts them
// back on the text as it then reads (a translated page gets its dates written too). Their text watcher never sees our
// own writes (translate.ts quietly()).
//
// Nothing read here leaves the page: the rates come in from the service worker with the request; nothing goes out.
import { convert, currencyOfLocale, parseAmount, detectLang, findDates, findPrices, formatDate, formatMoney, type FoundDate, type FoundPrice, type Rates } from "@distill/engine";
import type { ContentRequest } from "../messages";
import type { CleanContext } from "./context";
import { dataTable } from "./tables";
import { quietly, setTextAside, TRANSLATED } from "./translate";

type TermsRequest = Extract<ContentRequest, { type: "distill:caption:terms" }>;

/** On each wrapped price or date: "price" or "date". */
export const TERM = "data-distill-term";
/** The addition shown after the words: "(€48)". */
export const TERM_ADD = "data-distill-term-add";
const ORIGINAL = "data-distill-original";
const HIDE = "data-distill-hide";
/** Text here is never changed: code, form parts, a person's own text, what the page keeps as it is, Distill's own. */
const SKIP = "script, style, noscript, template, pre, code, textarea, select, option, input, button, svg, math, form, [contenteditable]:not([contenteditable=false]), [translate=no], .notranslate, [aria-hidden=true], distill-caption, [data-distill-hide], [data-distill-term]";
/** A text node longer than this is not a price or a line with dates (a script's text, a whole page in one node). */
const NODE_MAX = 5000;

const CSS = `html:not([${ORIGINAL}]) [${TERM_ADD}]::after { content: " " attr(${TERM_ADD}); opacity: .72; font-size: .92em; font-weight: normal; font-style: normal; }`;

interface Split {
  /** The page's own text node: it keeps the first piece. */
  node: Text;
  /** Every node Distill made for it: the spans and the text pieces after them. */
  made: Node[];
}

let state: { doc: Document; ctx: CleanContext; req: TermsRequest; splits: Split[]; style: HTMLStyleElement | null } | null = null;

const primary = (locale: string): string => (locale || "en").split(/[-_]/)[0]?.toLowerCase() || "en";
const squash = (s: string): string => s.replace(/[\s   ]+/g, " ").trim();

/** The page's language: its lang attribute when it has one, else what its text reads as. */
function pageLang(doc: Document, sample: string): string {
  const attr = primary(doc.documentElement.getAttribute("lang") ?? "");
  if (doc.documentElement.getAttribute("lang")) return attr;
  const d = detectLang(sample);
  return d.confidence >= 0.6 ? d.lang : "cs";
}

/** The main text's text nodes with a digit in them, in document order. */
const rootsOf = (ctx: CleanContext): Element[] => (ctx.main ? [ctx.main] : [...ctx.body]);

function textNodes(ctx: CleanContext): Text[] {
  const roots = rootsOf(ctx);
  const out: Text[] = [];
  const seen = new Set<Text>();
  for (const root of roots) {
    if (!root.isConnected) continue;
    const walker = ctx.doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      if (seen.has(n) || !/\d/.test(n.data) || n.data.length > NODE_MAX) continue;
      const parent = n.parentElement;
      if (!parent || parent.closest(SKIP)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

const rateLine = (from: string, to: string, rates: Rates, locale: string): string => {
  const per = convert(1, to, from, rates);
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${rates.date}T00:00:00Z`));
  const n = per === null ? "" : new Intl.NumberFormat(locale, { maximumFractionDigits: per >= 100 ? 0 : per >= 1 ? 2 : 4 }).format(per);
  return `1 ${to} = ${n} ${from}: the European Central Bank's reference rate of ${day}. Converted on your device by Distill.`;
};

interface Addition { start: number; end: number; kind: "price" | "date"; add: string; title: string }

/** What to add in one text node's words. Prices first; a date that overlaps a price is left out. */
export function additions(text: string, opts: { lang: string; locale: string; currency: string; rates?: Rates; dates: boolean; extra?: FoundPrice }): Addition[] {
  const out: Addition[] = [];
  const { locale, currency, rates } = opts;
  if (rates) {
    const found: FoundPrice[] = findPrices(text, opts.lang);
    if (opts.extra && !found.some((p) => p.start < opts.extra!.end && p.end > opts.extra!.start)) found.push(opts.extra);
    for (const p of found) {
      if (p.currency === currency) continue;
      const low = convert(p.amount, p.currency, currency, rates);
      if (low === null) continue;
      const high = p.to !== undefined ? convert(p.to, p.currency, currency, rates) : null;
      const money = formatMoney(low, currency, locale) + (high !== null ? `–${formatMoney(high, currency, locale)}` : "");
      out.push({ start: p.start, end: p.end, kind: "price", add: `(${money})`, title: rateLine(p.currency, currency, rates, locale) });
    }
  }
  if (opts.dates) {
    for (const d of findDates(text, opts.lang) as FoundDate[]) {
      if (out.some((a) => d.start < a.end && d.end > a.start)) continue;
      const written = formatDate(d, locale);
      if (squash(written) === squash(d.text)) continue;
      out.push({ start: d.start, end: d.end, kind: "date", add: `(${written})`, title: "This date written your way by Distill. The page's own words are before it." });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A column header that names a currency: "Cena s daní za 1 den Kč", "Price (EUR)". */
const CURRENCY_LABEL: [RegExp, string][] = [
  [/(?:^|[\s(\[/])(?:Kč|Kc|CZK)(?=$|[\s)\],./:])/u, "CZK"], [/(?:^|[\s(\[/])(?:EUR|€)(?=$|[\s)\],./:])/u, "EUR"],
  [/(?:^|[\s(\[/])(?:USD|\$)(?=$|[\s)\],./:])/u, "USD"], [/(?:^|[\s(\[/])(?:GBP|£)(?=$|[\s)\],./:])/u, "GBP"],
];
/** A cell that holds only a number: "400", "1 200", "1 200,-". */
const BARE = /^\s*(\d{1,3}(?:[   .]\d{3})+|\d+)(?:,[-–]|,\d{1,2})?\s*$/u;

/**
 * Prices a table gives as bare numbers under a header that names the currency (the trailer rental's "Cena s daní za 1
 * den Kč" over "400"): each such cell's number, by its text node. Only data tables (tables.ts dataTable).
 */
export function tablePrices(roots: readonly Element[]): Map<Text, FoundPrice> {
  const out = new Map<Text, FoundPrice>();
  const tables = new Set<Element>();
  for (const r of roots) {
    if (r.localName === "table") tables.add(r);
    r.querySelectorAll("table").forEach((t) => tables.add(t));
  }
  for (const t of tables) {
    if (t.closest(`[${HIDE}]`)) continue;
    const shape = dataTable(t);
    if (!shape) continue;
    const currencies = shape.labels.map((l) => CURRENCY_LABEL.find(([re]) => re.test(l))?.[1] ?? null);
    if (!currencies.some(Boolean)) continue;
    for (const row of shape.rows) {
      const cells = Array.from(row.children).filter((c) => c.localName === "td" || c.localName === "th");
      if (cells.length !== shape.cols) continue; // a row with spans: its cells do not line up with the header
      cells.forEach((cell, i) => {
        const currency = currencies[i];
        if (!currency) return;
        const texts = Array.from(cell.childNodes).filter((n): n is Text => n.nodeType === 3 && /\S/.test((n as Text).data));
        const node = texts.length === 1 ? texts[0] as Text : null;
        // Only the cell's own single text node holding the number; never a cell with other elements' words.
        if (!node || (cell.textContent ?? "").trim() !== node.data.trim()) return;
        const m = BARE.exec(node.data);
        if (!m) return;
        const amount = parseAmount(node.data.trim());
        if (amount === null || amount <= 0) return;
        const start = node.data.search(/\S/);
        const words = node.data.trim();
        out.set(node, { start, end: start + words.length, amount, currency, text: words });
      });
    }
  }
  return out;
}

/** A text node whose parent lays out its children (flex, grid): splitting it would make new boxes there. */
function laysOut(node: Text): boolean {
  const parent = node.parentElement;
  const win = node.ownerDocument.defaultView;
  if (!parent || !win) return false;
  return /flex|grid/.test(win.getComputedStyle(parent).display);
}

/** Wraps each addition's words in a span; returns the split to undo it. */
function wrap(doc: Document, node: Text, adds: Addition[]): Split | null {
  if (laysOut(node)) adds = adds.filter((a) => a.start === 0 && a.end === node.data.length);
  if (!adds.length) return null;
  const made: Node[] = [];
  // Right to left, so the offsets still hold in what is left of the node.
  for (const a of [...adds].reverse()) {
    if (a.end < node.data.length) made.push(node.splitText(a.end));
    const words = a.start > 0 ? node.splitText(a.start) : node;
    if (words !== node) made.push(words);
    const span = doc.createElement("span");
    span.setAttribute(TERM, a.kind);
    span.setAttribute(TERM_ADD, a.add);
    span.title = a.title;
    words.parentNode?.insertBefore(span, words);
    span.append(words);
    made.push(span);
  }
  return { node, made };
}

/** Puts one node back as the page had it: its pieces' words, in their order, back in it, and every piece gone. */
function unwrap(s: Split): void {
  const pieces: Node[] = [s.node, ...s.made.filter((n) => n.nodeType === 3)];
  const connected = pieces.filter((n) => n.isConnected).sort((a, b) => (a.compareDocumentPosition(b) & 4 /* FOLLOWING */ ? -1 : 1));
  const words = connected.map((n) => (n as Text).data).join("");
  const span = s.node.parentElement;
  if (span?.hasAttribute(TERM) && s.made.includes(span)) span.parentNode?.insertBefore(s.node, span);
  if (s.node.isConnected) s.node.data = words;
  for (const n of s.made) if (n !== s.node) n.parentNode?.removeChild(n);
}

function takeOut(): void {
  if (!state) return;
  const splits = state.splits;
  state.splits = [];
  quietly(() => { for (const s of splits.reverse()) unwrap(s); });
}

function putIn(ctx: CleanContext): { prices: number; dates: number } {
  const s = state;
  if (!s || !s.req.on || ctx.doc.documentElement.hasAttribute(ORIGINAL)) return { prices: 0, dates: 0 };
  const locale = s.req.locale || navigator.language || "en";
  const currency = s.req.currency || currencyOfLocale(locale);
  const nodes = textNodes(ctx);
  const lang = pageLang(ctx.doc, nodes.slice(0, 200).map((n) => n.data).join(" ") + " " + (ctx.main?.textContent ?? "").slice(0, 4000));
  // Dates are written when the reader reads another language than the page, or the page shows a translation.
  const dates = primary(locale) !== lang || !!ctx.doc.querySelector(`[${TRANSLATED}]`);
  const inTables = s.req.rates ? tablePrices(rootsOf(ctx)) : new Map<Text, FoundPrice>();
  let prices = 0;
  let datesN = 0;
  quietly(() => {
    for (const node of nodes) {
      if (!node.isConnected) continue;
      const adds = additions(node.data, { lang, locale, currency, rates: s.req.rates, dates, extra: inTables.get(node) });
      const split = adds.length ? wrap(ctx.doc, node, adds) : null;
      if (!split) continue;
      s.splits.push(split);
      for (const n of split.made) {
        const kind = n.nodeType === 1 ? (n as Element).getAttribute(TERM) : null;
        if (kind === "price") prices++;
        else if (kind === "date") datesN++;
      }
    }
  });
  if (s.splits.length && !s.style) {
    s.style = ctx.doc.createElement("style");
    s.style.setAttribute("data-distill", "terms");
    s.style.textContent = CSS;
    (ctx.doc.head ?? ctx.doc.documentElement).append(s.style);
  }
  return { prices, dates: datesN };
}

/** On (with the reader's currency, locale and the rates, when there are rates) or off. Returns what is written now. */
export function setTerms(ctx: CleanContext, req: TermsRequest): { prices: number; dates: number } {
  takeOut();
  if (!state || state.doc !== ctx.doc) state = { doc: ctx.doc, ctx, req, splits: [], style: state?.style ?? null };
  state.req = req;
  state.ctx = ctx;
  return putIn(ctx);
}

/**
 * Runs a change to the main text's own text nodes (Translate, Plain, Original) with the additions taken out first and
 * put back after, on the text as it reads then. While Original is on nothing is put back; Back to Distill does it.
 */
export function termsAside<T>(current: () => CleanContext | null, run: () => T): T {
  if (!state) return run();
  takeOut();
  try {
    return run();
  } finally {
    const ctx = current() ?? state?.ctx ?? null;
    if (ctx && state) { state.ctx = ctx; putIn(ctx); }
  }
}

// Translate's text watcher reads the page again by itself: it reads whole nodes too.
setTextAside((read) => termsAside(() => state?.ctx ?? null, read));

/** What the live probe and the e2e read: each addition now on the page. */
export function termsReport(doc: Document): { kind: string; words: string; add: string; title: string }[] {
  return Array.from(doc.querySelectorAll(`[${TERM}]`)).map((el) => ({
    kind: el.getAttribute(TERM) ?? "", words: el.textContent ?? "", add: el.getAttribute(TERM_ADD) ?? "", title: el.getAttribute("title") ?? "",
  }));
}

/** Takes every addition away (close). */
export function clearTerms(doc: Document): void {
  takeOut();
  state?.style?.remove();
  doc.querySelectorAll('style[data-distill="terms"]').forEach((s) => s.remove());
  state = null;
}
