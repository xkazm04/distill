// Round 4, card 7 (r4-07): a product page's facts in one card. Reads the page's structured data (schema.org Product and
// Offer, as JSON-LD and as microdata) first, then its tables, lists and labels: common Czech shop labels (Cena,
// Skladem, Dostupnost, Doprava, Doručení, Záruka, Vrácení, "14 dní na vrácení", Parametry), then English ones. Pure
// reading, nothing fetched, no AI. Never reads a form field: a shop's own words only.
//
// Which words win: structured data says what the shop's system holds; the page says it in the shop's own words and has
// a place to show. A price the page shows with the same amount as the data is taken from the page (Show me works);
// stock, delivery, warranty and returns written on the page beat the data's schema.org codes ("InStock").
import { collapse, fold, pageLang, SKIP_TAGS } from "./dom.js";
import { findPrices } from "./money.js";

export const PRODUCT_FACTS = ["price", "oldPrice", "stock", "delivery", "warranty", "returns", "spec"] as const;
export type ProductFactKind = (typeof PRODUCT_FACTS)[number];

export interface ProductFact {
  /** `p0`, `p1`, ... in card order. */
  id: string;
  kind: ProductFactKind;
  /** The label as shown ("Záruka", or the spec's own name). */
  label: string;
  /** The page's own words for the value. */
  value: string;
  /** Where it was read: structured data (no place on the page to show) or a place on the page (Show me). */
  from: "data" | "page";
}

export interface ProductFacts { name?: string; facts: ProductFact[] }

export interface ReadProductOptions {
  /** Called for each fact read from a place on the page, with the element it was read from (for Show me). */
  onElement?: (id: string, el: Element) => void;
}

/** At most this many specifications. */
const MAX_SPECS = 12;
/** At most this many delivery facts (time and cost are often two lines). */
const MAX_DELIVERY = 2;
const VALUE_MAX = 160;
const LABEL_MAX = 60;

interface Cand { kind: ProductFactKind; label: string; value: string; el?: Element; amount?: number }

// ---------------------------------------------------------------- labels

/** Label words (folded: lower case, no diacritics) -> kind. Old price is tried before price ("Původní cena"). */
const LABELS: [ProductFactKind, RegExp][] = [
  ["oldPrice", /^(?:puvodni cena|puvodne|bezna cena|doporucena (?:maloobchodni )?cena|cena pred slevou|drive|old price|was|list price|regular price|original price|rrp|msrp)\b/],
  ["price", /^(?:cena(?! bez dph)(?: s dph| vc\.? dph| vcetne dph| za kus| za ks)?|nase cena|vase cena|prodejni cena|akcni cena|price|our price|sale price|now|your price)$/],
  ["stock", /^(?:skladem|na sklade|dostupnost|stav skladu|sklad|availability|stock|in stock)$/],
  ["delivery", /^(?:doprava|doruceni|dodani|dodaci lhuta|doba dodani|zpusob dopravy|postovne|expedice|odeslani|delivery|shipping|postage|dispatch|delivery time|shipping cost)$/],
  ["warranty", /^(?:zaruka|zarucni doba|zaruka \(mesice\)|delka zaruky|warranty|guarantee|warranty period)$/],
  ["returns", /^(?:vraceni|vraceni zbozi|vymena a vraceni|lhuta pro vraceni|moznost vraceni|returns?|return policy|returns policy)$/],
];

/** A heading that opens the specifications. */
const SPEC_HEADING = /^(?:technicke |hlavni |zakladni )?(?:parametry|specifikace|vlastnosti|technicke udaje|udaje)(?: produktu| zbozi)?$|^(?:tech(?:nical)? )?spec(?:ification)?s?$|^product (?:details|specifications)$|^(?:key )?features$/;
/** A table or list that names itself as the specifications. */
const SPEC_NAME = /param|spec|vlastnost|attribute|features|tech/i;

const cleanLabel = (s: string): string => collapse(s).replace(/[\s:：]+$/u, "").replace(/^[\s•·-]+/u, "");
function kindOfLabel(label: string): ProductFactKind | null {
  const f = fold(cleanLabel(label));
  if (!f || f.length > LABEL_MAX) return null;
  for (const [kind, re] of LABELS) if (re.test(f)) return kind;
  return null;
}

/** Phrases that say a fact by themselves, without a label ("Skladem 5 ks", "14 dní na vrácení", "Doprava zdarma"). */
const PHRASES: [ProductFactKind, RegExp][] = [
  ["stock", /^(?:skladem|na sklade|neni skladem|vyprodano|momentalne nedostupne|docasne nedostupne|u dodavatele|na objednavku|in stock|out of stock|sold out|only \d+ left|available now|pre-?order)\b/],
  ["returns", /\b\d+\s*(?:dni|dnu|days?)\s*(?:na|pro|k|to|for)\s*(?:vraceni|vymenu|return|returns)\b|\b(?:vraceni|return|returns)\b[^.]{0,30}?\b\d+\s*(?:dni|dnu|days?)\b|^free returns\b|^vraceni zdarma\b/],
  ["delivery", /^(?:doprava zdarma|doruceni zdarma|postovne zdarma|dorucime\b|doruceni\s+(?:do|zitra|dnes)\b|u vas\s+(?:zitra|do|dnes)\b|odesleme\b|free (?:delivery|shipping)\b|delivered by\b|ships (?:in|within|today|tomorrow)\b|arrives\b)/],
  ["warranty", /\bzaruk\w*\s+\d+\s*(?:let|roky|roku|rok|mesic\w*)\b|\b\d+\s*(?:lete|lete|roky|let|mesicni|mesicu)\s+zaruk\w*\b|\b\d+[- ]?(?:years?|months?|year|month)\s+(?:warranty|guarantee)\b|\bwarranty\s*:?\s*\d+\s*(?:years?|months?)\b/],
];
const PHRASE_LABEL: Record<ProductFactKind, string> = {
  price: "Price", oldPrice: "Before", stock: "Stock", delivery: "Delivery", warranty: "Warranty", returns: "Returns", spec: "Detail",
};

/** A button or link that puts the product in a cart: the page sells something. */
const CART = /^(?:do kosiku|pridat do kosiku|vlozit do kosiku|koupit|koupit nyni|objednat|add to (?:cart|basket|bag)|buy now|buy)$/;

// ---------------------------------------------------------------- the page

const HIDE = "data-distill-hide";

/** Out of the reader's sight, or not page text at all: hidden, a script, Distill's own strip, what Clean removed. */
function gone(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const t = e.localName;
    if (SKIP_TAGS.has(t) || t === "distill-caption" || t === "meta" || t === "link") return true;
    if (e.hasAttribute("hidden") || e.hasAttribute(HIDE) || e.getAttribute("aria-hidden") === "true") return true;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(e.getAttribute("style") ?? "")) return true;
    if (t === "input" || t === "textarea" || t === "select" || (e as HTMLElement).isContentEditable === true) return true;
  }
  return false;
}

const textIn = (el: Element): string => collapse(el.textContent ?? "");
const BLOCK_CHILD = "div, p, ul, ol, li, table, section, article, dl, h1, h2, h3, h4, h5, h6, form";
/** Never the value beside a label: lists, tables, headings, controls. */
const VALUE_NOT = "ul, ol, table, dl, section, article, form, h1, h2, h3, h4, h5, h6, button, input, select, textarea, a[href]";

/** Short elements that hold one line of the page (no blocks inside), in document order. */
function lines(root: Element, max = 120): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(root.querySelectorAll("p, li, span, div, strong, b, em, small, td, dd, dt, label, a, h2, h3, h4, h5, h6"))) {
    const t = textIn(el);
    if (!t || t.length > max) continue;
    if (el.querySelector(BLOCK_CHILD)) continue;
    out.push(el);
  }
  return out;
}

/** The innermost of elements whose text matches: a parent whose child already matched is left out. */
function innermost(els: Element[]): Element[] {
  return els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
}

function priceAt(text: string, lang: string): { amount: number; words: string } | null {
  const p = findPrices(text, lang)[0];
  return p ? { amount: p.amount, words: p.text } : null;
}

/** Elements that name themselves a price ("price", "cena", itemprop=price), with their price. */
const PRICE_NAME = /(?:^|[\s_-])(?:price|prices|cena|ceny|amount|cost)(?:$|[\s_-])|price/i;
const OLD_NAME = /old|original|before|puvodni|regular|crossed|strike|was|rrp|doporuc|bezna|list-?price|compare/i;
function priceElements(doc: Document, lang: string): { el: Element; amount: number; words: string; old: boolean }[] {
  const out: { el: Element; amount: number; words: string; old: boolean }[] = [];
  const seen = new Set<Element>();
  const add = (el: Element, old: boolean) => {
    if (seen.has(el) || gone(el)) return;
    const t = textIn(el);
    if (!t || t.length > 60) return;
    const p = priceAt(t, lang);
    if (!p) return;
    seen.add(el);
    out.push({ el, amount: p.amount, words: p.words, old });
  };
  for (const el of Array.from(doc.querySelectorAll("del, s, strike"))) add(el, true);
  for (const el of Array.from(doc.querySelectorAll("[class], [id], [itemprop=price]"))) {
    const name = `${el.getAttribute("class") ?? ""} ${el.getAttribute("id") ?? ""} ${el.getAttribute("itemprop") ?? ""}`;
    if (!PRICE_NAME.test(name)) continue;
    add(el, OLD_NAME.test(name) || !!el.closest("del, s, strike"));
  }
  // Innermost only, so one price is not read three times through its wrappers.
  const els = innermost(out.map((o) => o.el));
  return out.filter((o) => els.includes(o.el));
}

// ---------------------------------------------------------------- structured data

type Node = Record<string, unknown>;

function collect(v: unknown, out: Node[], depth: number): void {
  if (depth > 6 || !v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v.slice(0, 50)) collect(x, out, depth + 1); return; }
  const o = v as Node;
  out.push(o);
  if (o["@graph"]) collect(o["@graph"], out, depth + 1);
  if (o["mainEntity"]) collect(o["mainEntity"], out, depth + 1);
}
const typesOf = (n: Node): string[] => {
  const t = n["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^https?:\/\/schema\.org\//, ""));
};
const PRODUCT_TYPES = /^(?:Product|ProductGroup|IndividualProduct|ProductModel|SomeProducts|Vehicle|Car|Motorcycle)$/;
const list = (v: unknown): Node[] => (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is Node => !!x && typeof x === "object");
const str = (v: unknown): string | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return undefined;
  const t = collapse(v);
  return t && t.length <= VALUE_MAX ? t : undefined;
};
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v)) return Number(v.replace(",", "."));
  return undefined;
};

function money(amount: number, currency: string | undefined, lang: string): string {
  const locale = lang === "und" ? "en" : lang;
  const digits = Number.isInteger(amount) ? 0 : 2;
  const n = (() => {
    try { return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount); } catch { return String(amount); }
  })();
  const plain = n.replace(/[   ]/g, " ");
  return currency ? `${plain} ${currency}` : plain;
}

const AVAILABILITY: Record<string, string> = {
  InStock: "In stock", OutOfStock: "Out of stock", PreOrder: "Pre-order", PreSale: "Pre-sale", BackOrder: "On back order",
  LimitedAvailability: "Limited availability", SoldOut: "Sold out", Discontinued: "Discontinued", OnlineOnly: "Online only",
  InStoreOnly: "In store only", MadeToOrder: "Made to order", Reserved: "Reserved",
};
const availabilityWords = (v: unknown): string | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const code = s.replace(/^https?:\/\/schema\.org\//i, "");
  return AVAILABILITY[code] ?? (/^https?:/i.test(s) ? undefined : s);
};

const UNIT: Record<string, [string, string]> = { ANN: ["year", "years"], MON: ["month", "months"], DAY: ["day", "days"], WEE: ["week", "weeks"] };
function duration(v: unknown): string | undefined {
  const q = list(v)[0];
  if (!q) return str(v);
  const n = num(q["value"]);
  if (n === undefined) return undefined;
  const unit = UNIT[String(q["unitCode"] ?? "").toUpperCase()];
  const text = str(q["unitText"]);
  return unit ? `${n} ${n === 1 ? unit[0] : unit[1]}` : text ? `${n} ${text}` : String(n);
}

function days(v: unknown): string | undefined {
  const q = list(v)[0];
  if (!q) return undefined;
  const lo = num(q["minValue"]) ?? num(q["value"]);
  const hi = num(q["maxValue"]);
  if (lo === undefined && hi === undefined) return undefined;
  const a = lo ?? hi ?? 0;
  const b = hi ?? lo ?? 0;
  const unit = String(q["unitCode"] ?? "DAY").toUpperCase() === "HUR" ? "hours" : "days";
  return a === b ? `${a} ${a === 1 ? unit.replace(/s$/, "") : unit}` : `${a}–${b} ${unit}`;
}

interface DataFacts { name?: string; cands: Cand[] }

function fromJsonLd(doc: Document, lang: string): DataFacts | null {
  const nodes: Node[] = [];
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json" i]'))) {
    let json: unknown;
    try { json = JSON.parse((s.textContent ?? "").trim()); } catch { continue; }
    collect(json, nodes, 0);
  }
  const product = nodes.find((n) => typesOf(n).some((t) => PRODUCT_TYPES.test(t)));
  if (!product) return null;
  const out: DataFacts = { cands: [] };
  const name = str(product["name"]);
  if (name) out.name = name;

  // The offers: the product's own, else its first variant's (a ProductGroup).
  let offers = list(product["offers"]);
  if (!offers.length) for (const v of list(product["hasVariant"])) { offers = list(v["offers"]); if (offers.length) break; }
  // An AggregateOffer holds a range, and maybe the offers themselves.
  const flat: Node[] = [];
  for (const o of offers) { flat.push(o); flat.push(...list(o["offers"])); }
  const agg = flat.find((o) => typesOf(o).includes("AggregateOffer"));
  const offer = flat.find((o) => !typesOf(o).includes("AggregateOffer") && (num(o["price"]) !== undefined || list(o["priceSpecification"]).length)) ?? flat[0];

  const currency = str(offer?.["priceCurrency"]) ?? str(agg?.["priceCurrency"]);
  let price = num(offer?.["price"]);
  let old: number | undefined;
  for (const spec of list(offer?.["priceSpecification"])) {
    const t = String(spec["priceType"] ?? "").replace(/^https?:\/\/schema\.org\//, "");
    const p = num(spec["price"]);
    if (p === undefined) continue;
    if (/StrikethroughPrice|ListPrice|MSRP|SRP/i.test(t)) old ??= p; else price ??= p;
  }
  const specCur = str(list(offer?.["priceSpecification"])[0]?.["priceCurrency"]);
  const cur = currency ?? specCur;
  if (price !== undefined && (!agg || agg === offer)) out.cands.push({ kind: "price", label: "Price", value: money(price, cur, lang), amount: price });
  else if (agg) {
    const lo = num(agg["lowPrice"]) ?? num(agg["price"]);
    const hi = num(agg["highPrice"]);
    if (lo !== undefined) {
      const value = hi !== undefined && hi > lo ? `${money(lo, undefined, lang)}–${money(hi, cur, lang)}` : money(lo, cur, lang);
      out.cands.push({ kind: "price", label: "Price", value, amount: lo });
    } else if (price !== undefined) out.cands.push({ kind: "price", label: "Price", value: money(price, cur, lang), amount: price });
  }
  if (old !== undefined && (price === undefined || old > price)) out.cands.push({ kind: "oldPrice", label: "Before", value: money(old, cur, lang), amount: old });

  const avail = availabilityWords(offer?.["availability"] ?? agg?.["availability"]);
  if (avail) out.cands.push({ kind: "stock", label: "Stock", value: avail });

  for (const ship of list(offer?.["shippingDetails"]).slice(0, 1)) {
    const rate = list(ship["shippingRate"])[0];
    const cost = num(rate?.["value"]);
    const dt = list(ship["deliveryTime"])[0];
    const time = dt ? days(dt["transitTime"]) ?? days(dt["handlingTime"]) : undefined;
    const costWords = cost === undefined ? undefined : cost === 0 ? "free" : money(cost, str(rate?.["currency"]) ?? cur, lang);
    const value = [time, costWords].filter(Boolean).join(", ");
    if (value) out.cands.push({ kind: "delivery", label: "Delivery", value: value.charAt(0).toUpperCase() + value.slice(1) });
  }
  const warranty = duration(list(offer?.["warranty"] ?? product["warranty"])[0]?.["durationOfWarranty"]);
  if (warranty) out.cands.push({ kind: "warranty", label: "Warranty", value: warranty });
  const policy = list(offer?.["hasMerchantReturnPolicy"] ?? product["hasMerchantReturnPolicy"])[0];
  if (policy) {
    const n = num(policy["merchantReturnDays"]);
    const cat = String(policy["returnPolicyCategory"] ?? "");
    const value = /NotPermitted/i.test(cat) ? "No returns" : n !== undefined ? `${n} days` : /Unlimited/i.test(cat) ? "Unlimited" : undefined;
    if (value) out.cands.push({ kind: "returns", label: "Returns", value });
  }
  for (const p of list(product["additionalProperty"]).slice(0, MAX_SPECS)) {
    const label = str(p["name"]);
    const v = str(p["value"]);
    const unit = str(p["unitText"]);
    if (label && v) out.cands.push({ kind: "spec", label, value: unit ? `${v} ${unit}` : v });
  }
  return out;
}

/** schema.org microdata: an itemscope of a Product type. Values on the page carry their element (Show me); a <meta>
 *  or <link> value is data. */
function fromMicrodata(doc: Document, lang: string): DataFacts | null {
  const scope = Array.from(doc.querySelectorAll("[itemscope][itemtype]")).find((el) =>
    (el.getAttribute("itemtype") ?? "").split(/\s+/).some((t) => PRODUCT_TYPES.test(t.replace(/^https?:\/\/schema\.org\//, ""))));
  if (!scope) return null;
  const out: DataFacts = { cands: [] };
  const valueOf = (el: Element): string | undefined =>
    str(el.getAttribute("content") ?? (el.localName === "link" || el.localName === "a" ? el.getAttribute("href") : null) ?? el.getAttribute("datetime") ?? el.getAttribute("value") ?? el.textContent);
  const own = (el: Element) => !el.closest("[itemscope]") || el.closest("[itemscope]") === scope || el.parentElement?.closest("[itemscope]") === scope;
  const prop = (root: Element, name: string): Element | null =>
    Array.from(root.querySelectorAll(`[itemprop~="${name}"]`)).find((el) => root === scope ? own(el) || el.closest("[itemprop~=offers]") !== null : true) ?? null;
  const placed = (el: Element): Element | undefined => (gone(el) ? undefined : el);

  const nameEl = Array.from(scope.querySelectorAll('[itemprop~="name"]')).find((el) => el.parentElement?.closest("[itemscope]") === scope);
  const name = nameEl ? valueOf(nameEl) : undefined;
  if (name) out.name = name;
  const offer = scope.querySelector('[itemprop~="offers"]') ?? scope;
  const priceEl = prop(offer, "price") ?? prop(offer, "lowPrice");
  const curEl = prop(offer, "priceCurrency");
  const cur = curEl ? valueOf(curEl) : undefined;
  if (priceEl) {
    const raw = valueOf(priceEl) ?? "";
    const shown = textIn(priceEl);
    const amount = num(raw) ?? priceAt(`${raw} ${cur ?? ""}`, lang)?.amount ?? priceAt(shown, lang)?.amount;
    const el = placed(priceEl);
    if (amount !== undefined) {
      const words = el ? priceAt(shown, lang)?.words ?? (shown || money(amount, cur, lang)) : money(amount, cur, lang);
      out.cands.push({ kind: "price", label: "Price", value: words, amount, ...(el ? { el } : {}) });
    }
  }
  const availEl = prop(offer, "availability");
  if (availEl) {
    const el = placed(availEl);
    const shown = el ? textIn(availEl) : "";
    const value = shown && shown.length <= VALUE_MAX ? shown : availabilityWords(valueOf(availEl));
    if (value) out.cands.push({ kind: "stock", label: "Stock", value, ...(el && shown ? { el } : {}) });
  }
  for (const p of Array.from(scope.querySelectorAll('[itemprop~="additionalProperty"]')).slice(0, MAX_SPECS)) {
    const n = p.querySelector('[itemprop~="name"]');
    const v = p.querySelector('[itemprop~="value"]');
    const label = n ? valueOf(n) : undefined;
    const value = v ? valueOf(v) : undefined;
    if (label && value) out.cands.push({ kind: "spec", label, value, ...(placed(p) ? { el: p } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------- labels on the page

interface PageFacts { cands: Cand[]; cart: boolean; specs: Cand[] }

function fromPage(doc: Document, lang: string): PageFacts {
  const body = doc.body;
  const out: PageFacts = { cands: [], cart: false, specs: [] };
  if (!body) return out;
  const taken = new Set<Element>();
  const add = (c: Cand) => {
    if (c.el && taken.has(c.el)) return;
    if (c.el) taken.add(c.el);
    (c.kind === "spec" ? out.specs : out.cands).push(c);
  };
  const pair = (labelEl: Element, valueEl: Element, inSpecs: boolean) => {
    if (gone(valueEl)) return;
    const label = cleanLabel(textIn(labelEl));
    const value = textIn(valueEl);
    if (!label || !value || label.length > LABEL_MAX || value.length > VALUE_MAX) return;
    const kind = kindOfLabel(label);
    if (kind === "price" || kind === "oldPrice") {
      const p = priceAt(value, lang);
      if (p) add({ kind, label, value: p.words, el: valueEl, amount: p.amount });
      return;
    }
    if (kind) add({ kind, label, value, el: valueEl });
    else if (inSpecs) add({ kind: "spec", label, value, el: valueEl });
  };

  // Which tables and lists are the specifications: they say so, or a heading right before them does.
  const specRoots = new Set<Element>();
  for (const h of Array.from(body.querySelectorAll("h2, h3, h4, h5, strong, b, summary, button, [role=tab], legend, caption"))) {
    if (gone(h) || !SPEC_HEADING.test(fold(cleanLabel(textIn(h))))) continue;
    if (h.localName === "caption") { const t = h.closest("table"); if (t) specRoots.add(t); continue; }
    // The next table or list after the heading, within a few steps.
    let n: Element | null = h;
    for (let i = 0; i < 6 && n; i++) {
      n = n.nextElementSibling ?? n.parentElement?.nextElementSibling ?? null;
      const t = n?.matches("table, dl, ul") ? n : n?.querySelector("table, dl, ul");
      if (t) { specRoots.add(t); break; }
    }
  }
  for (const t of Array.from(body.querySelectorAll("table, dl"))) {
    if (SPEC_NAME.test(`${t.getAttribute("class") ?? ""} ${t.getAttribute("id") ?? ""}`)) specRoots.add(t);
  }
  const inSpecs = (el: Element) => Array.from(specRoots).some((r) => r.contains(el));

  // Table rows: a label cell and a value cell.
  for (const tr of Array.from(body.querySelectorAll("tr"))) {
    if (gone(tr)) continue;
    const cells = Array.from(tr.children).filter((c) => c.localName === "th" || c.localName === "td");
    if (cells.length !== 2) continue;
    pair(cells[0] as Element, cells[1] as Element, inSpecs(tr));
  }
  // Description lists.
  for (const dt of Array.from(body.querySelectorAll("dt"))) {
    if (gone(dt)) continue;
    let dd = dt.nextElementSibling;
    while (dd && dd.localName !== "dd" && dd.localName !== "dt") dd = dd.nextElementSibling;
    if (dd?.localName === "dd") pair(dt, dd, inSpecs(dt));
  }
  // Specification lists written as "Label: value" items.
  for (const r of specRoots) {
    if (r.localName !== "ul") continue;
    for (const li of Array.from(r.querySelectorAll("li"))) {
      const m = /^([^:：]{1,60})[:：]\s*(.{1,160})$/u.exec(textIn(li));
      if (m && !gone(li)) add({ kind: kindOfLabel(m[1] as string) ?? "spec", label: cleanLabel(m[1] as string), value: (m[2] as string).trim(), el: li });
    }
  }

  // One line: "Záruka: 24 měsíců", a label element and its value beside it, or a phrase by itself.
  const ls = lines(body);
  const phraseHits: { kind: ProductFactKind; el: Element }[] = [];
  for (const el of ls) {
    if (gone(el) || taken.has(el)) continue;
    const t = textIn(el);
    const f = fold(t);
    if (CART.test(f.replace(/[!.]+$/, "")) && (el.localName === "a" || el.localName === "button" || el.closest("button, a, [role=button]"))) out.cart = true;
    const m = /^([^:：]{1,40})[:：]\s*(.{1,160})$/u.exec(t);
    if (m) {
      const kind = kindOfLabel(m[1] as string);
      if (kind && !Array.from(taken).some((x) => x.contains(el) || el.contains(x))) {
        const label = cleanLabel(m[1] as string);
        const value = (m[2] as string).trim();
        if (kind === "price" || kind === "oldPrice") {
          const p = priceAt(value, lang);
          if (p) add({ kind, label, value: p.words, el, amount: p.amount });
        } else add({ kind, label, value, el });
        continue;
      }
    }
    // A label element alone, its value the next element ("<span>Dostupnost</span><span>Skladem</span>").
    const kind = kindOfLabel(t);
    // "Skladem" / "In stock" alone is a value, not a label.
    const selfValue = kind === "stock" && !!PHRASES[0]?.[1].test(f);
    if (kind && t.length <= LABEL_MAX) {
      const next = el.nextElementSibling;
      if (!selfValue && next && !gone(next) && !taken.has(next) && !next.matches(VALUE_NOT) && !next.querySelector(BLOCK_CHILD)) {
        const v = textIn(next);
        if (v && v.length <= VALUE_MAX && !kindOfLabel(v)) {
          if (kind === "price" || kind === "oldPrice") { const p = priceAt(v, lang); if (p) add({ kind, label: cleanLabel(t), value: p.words, el: next, amount: p.amount }); }
          else add({ kind, label: cleanLabel(t), value: v, el: next });
          continue;
        }
      }
      if (!selfValue) continue;
    }
    for (const [k, re] of PHRASES) if (t.length <= 80 && re.test(f)) { phraseHits.push({ kind: k, el }); break; }
  }
  for (const h of phraseHits) {
    if (phraseHits.some((o) => o !== h && o.kind === h.kind && h.el.contains(o.el))) continue;
    if (Array.from(taken).some((x) => x.contains(h.el) || h.el.contains(x))) continue;
    add({ kind: h.kind, label: PHRASE_LABEL[h.kind], value: textIn(h.el), el: h.el });
  }
  // Buttons and inputs that say "Do košíku".
  if (!out.cart) {
    for (const b of Array.from(body.querySelectorAll("button, input[type=submit], input[type=button], [role=button]"))) {
      const t = fold(collapse(b.getAttribute("value") ?? b.textContent ?? "")).replace(/[!.]+$/, "");
      if (CART.test(t) && !gone(b)) { out.cart = true; break; }
    }
  }

  // The price the page shows, by an element that names itself a price, when no label gave one.
  const prices = priceElements(doc, lang);
  const h1 = body.querySelector("h1");
  const after = (el: Element) => !h1 || !!(h1.compareDocumentPosition(el) & 4 /* FOLLOWING */) || h1.contains(el);
  const ordered = [...prices.filter((p) => after(p.el)), ...prices.filter((p) => !after(p.el))];
  for (const p of ordered) {
    if (taken.has(p.el)) continue;
    out.cands.push({ kind: p.old ? "oldPrice" : "price", label: p.old ? "Before" : "Price", value: p.words, el: p.el, amount: p.amount });
  }
  return out;
}

// ---------------------------------------------------------------- together

/** Null when the page is not a product page. `onElement` hears where each page fact was read (Show me). */
export function readProduct(doc: Document, opts: ReadProductOptions = {}): ProductFacts | null {
  const lang = pageLang(doc);
  const data = fromJsonLd(doc, lang);
  const micro = fromMicrodata(doc, lang);
  const page = fromPage(doc, lang);
  const og = (doc.querySelector('meta[property="og:type" i]')?.getAttribute("content") ?? "").toLowerCase();

  const pagePrice = page.cands.find((c) => c.kind === "price");
  const otherKinds = new Set(page.cands.filter((c) => c.kind !== "price" && c.kind !== "oldPrice").map((c) => c.kind));
  const structured = !!data || !!micro;
  const looksLikeProduct = structured
    || (!!pagePrice && (og === "product" || og.startsWith("product.") || page.cart || otherKinds.size >= 2 || (otherKinds.size >= 1 && page.specs.length >= 2)));
  if (!looksLikeProduct) return null;

  // Data first (JSON-LD, then microdata), each kind once; then what the page says, by the rules at the top.
  const fromData = [...(data?.cands ?? []), ...(micro?.cands ?? [])];
  const pick = (kind: ProductFactKind): Cand[] => {
    const d = fromData.filter((c) => c.kind === kind);
    const p = page.cands.filter((c) => c.kind === kind);
    if (kind === "price" || kind === "oldPrice") {
      const dataOne = d[0];
      if (!dataOne) return p.slice(0, 1);
      if (dataOne.el) return [dataOne];
      const same = p.find((c) => c.amount !== undefined && dataOne.amount !== undefined && Math.abs(c.amount - dataOne.amount) < 0.005);
      return [same ?? dataOne];
    }
    if (kind === "delivery") {
      const out: Cand[] = [];
      for (const c of p.length ? p : d) if (out.length < MAX_DELIVERY && !out.some((o) => fold(o.value) === fold(c.value))) out.push(c);
      return out;
    }
    const dataPage = d.find((c) => c.el);
    return [dataPage ?? p[0] ?? d[0]].filter((c): c is Cand => !!c);
  };
  const chosen: Cand[] = [];
  for (const kind of PRODUCT_FACTS) {
    if (kind === "spec") continue;
    chosen.push(...pick(kind));
  }
  // An old price is only an old price when it is above the price.
  const price = chosen.find((c) => c.kind === "price");
  const oldAt = chosen.findIndex((c) => c.kind === "oldPrice");
  const old = chosen[oldAt];
  if (old && (!price || old.amount === undefined || price.amount === undefined || old.amount <= price.amount)) chosen.splice(oldAt, 1);

  const specs: Cand[] = [];
  const seen = new Set<string>();
  for (const c of [...page.specs, ...fromData.filter((x) => x.kind === "spec")]) {
    const k = fold(c.label);
    if (seen.has(k) || specs.length >= MAX_SPECS) continue;
    seen.add(k);
    specs.push(c);
  }
  const all = [...chosen, ...specs];
  if (!all.length) return null;

  const facts: ProductFact[] = all.map((c, i) => {
    const id = `p${i}`;
    if (c.el) opts.onElement?.(id, c.el);
    return { id, kind: c.kind, label: c.label.slice(0, LABEL_MAX), value: c.value.slice(0, VALUE_MAX), from: c.el ? "page" : "data" };
  });
  const out: ProductFacts = { facts };
  const name = data?.name ?? micro?.name ?? (doc.querySelector("h1") ? collapse(doc.querySelector("h1")?.textContent ?? "") || undefined : undefined);
  if (name) out.name = name.slice(0, 160);
  return out;
}
