// Round 3, card 5 (r3-05): who wrote this and when, from the page's own data. Pure reading: structured data (JSON-LD and
// schema.org microdata), meta tags, then the visible byline. Nothing is fetched and the page is never changed. The
// published and the updated date are told apart; a date the page does not state is never guessed.

export interface Byline {
  publisher?: string;
  author?: string;
  /** ISO date (YYYY-MM-DD) or date-time, as the page states it. */
  published?: string;
  updated?: string;
  /** Where the dates came from: structured data, meta tags, the visible text, or nowhere. */
  from: "data" | "meta" | "text" | "none";
}

type From = Exclude<Byline["from"], "none">;
interface Found { publisher?: string; author?: string; published?: string; updated?: string }

/** Reads the byline of `doc`. Never throws; a page with nothing says `{ from: "none" }`. */
export function readByline(doc: Document): Byline {
  try {
    const sources: [From, Found][] = [["data", fromData(doc)], ["meta", fromMeta(doc)], ["text", fromText(doc)]];
    const out: Byline = { from: "none" };
    // Each field from the first source that has it; the dates as a pair from one source when it has the published date
    // (a published date from one place and an updated date from another may disagree on what "the page" is).
    const dated = sources.find(([, f]) => f.published) ?? sources.find(([, f]) => f.updated);
    if (dated) {
      const [from, f] = dated;
      out.from = from;
      if (f.published) out.published = f.published;
      const updated = f.updated ?? (f.published ? sources.find(([, g]) => g.updated && !g.published)?.[1].updated : undefined);
      if (updated) out.updated = updated;
    }
    const author = sources.map(([, f]) => f.author).find(Boolean);
    const publisher = sources.map(([, f]) => f.publisher).find(Boolean);
    if (author) out.author = author;
    if (publisher && publisher !== author) out.publisher = publisher;
    // An "updated" before the published date, or the same moment, is no update.
    if (out.published && out.updated && dayOf(out.updated) !== undefined && dayOf(out.published) !== undefined
      && (dayOf(out.updated) as number) < (dayOf(out.published) as number)) delete out.updated;
    if (out.published && out.updated === out.published) delete out.updated;
    return out;
  } catch {
    return { from: "none" };
  }
}

/** The strip's words, or null when there is nothing worth a line ("Published 3 years ago, updated yesterday" only when
 *  the two dates differ by more than a week). `now` is passed in so tests are stable. */
export function bylineLine(b: Byline, now: Date): string | null {
  if (!b.published || !b.updated) return null;
  const p = dayOf(b.published);
  const u = dayOf(b.updated);
  if (p === undefined || u === undefined || u - p <= 7) return null;
  return `Published ${ago(p, now)}, updated ${ago(u, now)}`;
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago", "a year ago", "3 years ago". */
export function ago(day: number, now: Date): string {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
  const days = Math.round(today - day);
  if (days <= 0) return days < 0 ? "in the future" : "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 45) return `${Math.round(days / 7)} weeks ago`;
  const d = new Date(day * DAY_MS);
  let months = (now.getFullYear() - d.getUTCFullYear()) * 12 + now.getMonth() - d.getUTCMonth();
  if (now.getDate() < d.getUTCDate()) months--;
  if (months < 12) return `${Math.max(1, months)} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "a year ago" : `${years} years ago`;
}

const DAY_MS = 86_400_000;

/** Days since 1970 of an ISO date or date-time (its calendar day as written), or undefined. */
export function dayOf(iso: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return undefined;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? undefined : t / DAY_MS;
}

// ---- structured data ----

/** Types that are the page's own text, best first. A WebPage or WebSite only when nothing better is there. */
const ARTICLE_TYPES = /^(?:\w+Article|Article|BlogPosting|Report|Review|Recipe|LiveBlogPosting|SocialMediaPosting|CreativeWork|HowTo|Event|ScholarlyArticle)$/;
const PAGE_TYPES = /^(?:WebPage|ItemPage|AboutPage|ContactPage|FAQPage|CollectionPage|QAPage)$/;

function fromData(doc: Document): Found {
  const nodes: Record<string, unknown>[] = [];
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json" i]'))) {
    let json: unknown;
    try { json = JSON.parse((s.textContent ?? "").trim()); } catch { continue; }
    collect(json, nodes, 0);
  }
  const typed = (re: RegExp) => nodes.filter((n) => types(n).some((t) => re.test(t)));
  const best = [...typed(ARTICLE_TYPES), ...typed(PAGE_TYPES)];
  const out: Found = {};
  for (const n of best) {
    out.published ??= isoOf(n["datePublished"]) ?? isoOf(n["dateCreated"]);
    out.updated ??= isoOf(n["dateModified"]);
    out.author ??= names(n["author"]) ?? names(n["creator"]);
    out.publisher ??= names(n["publisher"]);
    if (out.published && out.author && out.publisher) break;
  }
  // The site itself names the publisher when the article does not.
  out.publisher ??= typed(/^(?:WebSite|Organization|NewsMediaOrganization|Corporation|GovernmentOrganization|LocalBusiness)$/).map((n) => text(n["name"])).find(Boolean);

  // schema.org microdata.
  const prop = (name: string): string | undefined => {
    const el = doc.querySelector(`[itemprop="${name}"]`);
    return el ? el.getAttribute("content") ?? el.getAttribute("datetime") ?? el.textContent ?? undefined : undefined;
  };
  out.published ??= isoOf(prop("datePublished"));
  out.updated ??= isoOf(prop("dateModified"));
  if (!out.author) {
    const a = doc.querySelector('[itemprop="author"]');
    const n = a?.querySelector('[itemprop="name"]') ?? a;
    out.author = text(n?.getAttribute("content") ?? n?.textContent);
  }
  if (!out.author) delete out.author;
  return out;
}

function collect(v: unknown, out: Record<string, unknown>[], depth: number): void {
  if (depth > 6 || !v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v.slice(0, 50)) collect(x, out, depth + 1); return; }
  const o = v as Record<string, unknown>;
  out.push(o);
  if (o["@graph"]) collect(o["@graph"], out, depth + 1);
  if (o["mainEntity"]) collect(o["mainEntity"], out, depth + 1);
}

const types = (n: Record<string, unknown>): string[] => {
  const t = n["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^https?:\/\/schema\.org\//, ""));
};

/** One name, or names joined: "Jan Novák, Eva Malá". A link or an id alone is no name. */
function names(v: unknown): string | undefined {
  const list = (Array.isArray(v) ? v : [v]).map((x) => (x && typeof x === "object" ? text((x as Record<string, unknown>)["name"]) : text(x))).filter((x): x is string => !!x);
  const uniq = [...new Set(list)].slice(0, 4);
  return uniq.length ? uniq.join(", ") : undefined;
}

function text(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || t.length > 120 || /^(?:https?:|www\.|\/)/i.test(t) || !/\p{L}/u.test(t)) return undefined;
  return t;
}

// ---- meta tags ----

function fromMeta(doc: Document): Found {
  const meta = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const el = doc.querySelector(`meta[property="${k}" i], meta[name="${k}" i], meta[itemprop="${k}" i]`);
      const c = el?.getAttribute("content")?.trim();
      if (c) return c;
    }
    return undefined;
  };
  const out: Found = {};
  const published = isoOf(meta("article:published_time", "og:published_time", "datePublished", "pubdate", "publishdate", "date",
    "dc.date.issued", "dcterms.issued", "dc.date", "dcterms.created", "sailthru.date", "parsely-pub-date"));
  const updated = isoOf(meta("article:modified_time", "og:updated_time", "dateModified", "last-modified", "dcterms.modified", "dc.date.modified"));
  if (published) out.published = published;
  if (updated) out.updated = updated;
  const author = text(meta("author", "article:author", "dc.creator", "parsely-author", "sailthru.author"));
  const publisher = text(meta("og:site_name", "application-name", "publisher", "dc.publisher"));
  if (author) out.author = author;
  if (publisher) out.publisher = publisher;
  return out;
}

// ---- the visible byline ----

const UPDATED_WORD = /(?:aktualizov[áa]no|aktualizace|upraveno|změněno|zmeneno|naposledy upraveno|poslední aktualizace|posledni aktualizace|updated|last updated|last modified|modified|revised|aktualisiert)\s*:?\s*$/iu;
const PUBLISHED_WORD = /(?:publikov[áa]no|zveřejněno|zverejneno|vyd[áa]no|vloženo|vlozeno|datum(?: vydání| zveřejnění| vložení)?|published|posted|first published|veröffentlicht)\s*:?\s*$/iu;
const AUTHOR_RE = /(?:^|[|·•]\s*)(?:[Aa]utor(?:ka)?|[Aa]utoři|[Tt]ext|[Nn]apsala?|[Bb]y|[Ww]ritten by|[Aa]uthor)\s*:?\s+(\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){1,3})/u;

/**
 * The visible byline: `<time datetime>` first, then a date written in the text next to "Publikováno" / "Aktualizováno"
 * / "Published" / "Updated" (or the first date near the headline), Czech and English forms.
 */
function fromText(doc: Document): Found {
  const out: Found = {};
  const root = doc.querySelector("article, main, [role=main]") ?? doc.body;
  if (!root) return out;
  for (const t of Array.from(root.querySelectorAll("time[datetime]")).slice(0, 10)) {
    const iso = isoOf(t.getAttribute("datetime"));
    if (!iso) continue;
    let label = "";
    for (let s = t.previousSibling; s && label.length < 60; s = s.previousSibling) label = (s.textContent ?? "") + label;
    if (UPDATED_WORD.test(label) || /updated|modified|aktualiz/i.test(t.className + " " + (t.getAttribute("itemprop") ?? ""))) out.updated ??= iso;
    else out.published ??= iso;
  }
  const lines = visibleLines(root, 6000);
  for (const line of lines) {
    for (const d of datesIn(line)) {
      const before = line.slice(Math.max(0, d.at - 40), d.at);
      if (UPDATED_WORD.test(before)) out.updated ??= d.iso;
      else if (PUBLISHED_WORD.test(before)) out.published ??= d.iso;
    }
    const a = AUTHOR_RE.exec(line);
    if (a?.[1] && !out.author) out.author = a[1];
  }
  // No label at all: a short byline line under the headline that is mostly its date ("Petr Malý | 15. 3. 2024 10:30"),
  // never a date inside a sentence of the text ("comment until 15 February 2027").
  if (!out.published && doc.querySelector("article, h1")) {
    for (const line of lines.slice(0, 12)) {
      const d = datesIn(line)[0];
      if (!d || line.length > 80) continue;
      const rest = (line.slice(0, d.at) + line.slice(d.at + d.len)).match(/\p{L}+/gu) ?? [];
      if (rest.length <= 4 && !UPDATED_WORD.test(line.slice(Math.max(0, d.at - 40), d.at))) { out.published = d.iso; break; }
    }
  }
  return out;
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "NAV", "BUTTON", "SELECT", "TEXTAREA", "INPUT"]);
const BLOCK_TAGS = /^(?:P|DIV|LI|H[1-6]|TD|TH|DT|DD|SECTION|ARTICLE|HEADER|FOOTER|ASIDE|SPAN|TIME|ADDRESS|FIGCAPTION|BR|TR|BLOCKQUOTE)$/;

/** The text under `root` as short lines (block by block), at most `max` characters; forms and editable areas skipped. */
function visibleLines(root: Element, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  let total = 0;
  const flush = () => { const t = cur.replace(/\s+/g, " ").trim(); if (t) { out.push(t); total += t.length; } cur = ""; };
  const walk = (el: Element) => {
    for (const n of Array.from(el.childNodes)) {
      if (total > max) return;
      if (n.nodeType === 3) cur += n.nodeValue ?? "";
      else if (n.nodeType === 1) {
        const e = n as Element;
        if (SKIP_TAGS.has(e.tagName.toUpperCase()) || e.hasAttribute("contenteditable")) continue;
        const block = BLOCK_TAGS.test(e.tagName.toUpperCase()) && e.tagName.toUpperCase() !== "SPAN";
        if (block) flush();
        walk(e);
        if (block) flush();
      }
    }
  };
  walk(root);
  flush();
  return out;
}

// ---- dates ----

export const CZ_MONTHS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const CZ_NOMINATIVE = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
export const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A month by its Czech (any case of the genitive, with or without diacritics) or English name; 1-12, or 0. */
export function monthOf(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");
  for (let i = 0; i < 12; i++) {
    const cz = CZ_MONTHS[i] as string;
    if (w === cz || fold(w) === fold(cz) || w === CZ_NOMINATIVE[i]) return i + 1;
    const en = EN_MONTHS[i] as string;
    if (w === en || (w.length >= 3 && en.startsWith(w) && (w.length === 3 || w === "sept"))) return i + 1;
  }
  return 0;
}

const MONTH_WORD = String.raw`(?:${[...CZ_MONTHS, ...CZ_NOMINATIVE.slice(0, 8), ...EN_MONTHS].join("|")}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|brezna|kvetna|cervna|cervence|zari|rijna|unora)\.?`;
const TIME_AFTER = String.raw`(?:[,\s]+(?:v\s+|at\s+)?(\d{1,2})[:.](\d{2})(?!\d))?`;
/** "15. 3. 2024", "15.3.2024 10:30", "2024-03-15", "15. března 2024", "March 15, 2024", "15 March 2024". */
const DATE_RES: { re: RegExp; read: (m: RegExpExecArray) => [number, number, number, string?, string?] | null }[] = [
  { re: new RegExp(String.raw`(?<![\d.])(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?`, "g"), read: (m) => [Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]] },
  { re: new RegExp(String.raw`(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)${TIME_AFTER}`, "g"), read: (m) => [Number(m[3]), Number(m[2]), Number(m[1]), m[4], m[5]] },
  { re: new RegExp(String.raw`(?<![\d.])(\d{1,2})\.?\s+(${MONTH_WORD})\s+(\d{4})(?!\d)${TIME_AFTER}`, "giu"), read: (m) => { const mo = monthOf(m[2] as string); return mo ? [Number(m[3]), mo, Number(m[1]), m[4], m[5]] : null; } },
  { re: new RegExp(String.raw`(?<![\p{L}])(${MONTH_WORD})\s+(\d{1,2}),?\s+(\d{4})(?!\d)${TIME_AFTER}`, "giu"), read: (m) => { const mo = monthOf(m[1] as string); return mo ? [Number(m[3]), mo, Number(m[2]), m[4], m[5]] : null; } },
];

/** Full dates (with a year) written in `text`, each as ISO with where it starts, in order. */
export function datesIn(text: string): { at: number; len: number; iso: string }[] {
  const out: { at: number; len: number; iso: string }[] = [];
  for (const { re, read } of DATE_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const r = read(m);
      if (!r) continue;
      const iso = isoFrom(...r);
      if (iso && !out.some((o) => m && m.index < o.at + o.len && o.at < m.index + m[0].length)) out.push({ at: m.index, len: m[0].length, iso });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function isoFrom(y: number, mo: number, d: number, hh?: string, mm?: string): string | null {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCMonth() !== mo - 1) return null; // 31. 2.
  const day = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (hh !== undefined && mm !== undefined && Number(hh) < 24 && Number(mm) < 60) return `${day}T${hh.padStart(2, "0")}:${mm}`;
  return day;
}

/** An ISO date or date-time as the page states it ("2024-03-15T10:30:00+01:00" kept), a Czech or English written date
 *  turned into ISO, or undefined. */
export function isoOf(v: unknown): string | undefined {
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (iso) return isoFrom(Number(iso[1]), Number(iso[2]), Number(iso[3])) ? s.replace(" ", "T") : undefined;
  return datesIn(s)[0]?.iso;
}
