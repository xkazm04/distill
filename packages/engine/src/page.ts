import type { Block, PageKind, PageModel } from "./types.js";
import { publicUrl } from "./url.js";
import { BLOCKISH, SKIP_TAGS, attr, blocked, collapse, isHidden, isNoise, pageLang, tag, textOf } from "./dom.js";
import { buildBindings, listForms } from "./form.js";

const SEMANTIC_ROOT = "main, article, [role=main]";

interface Scored {
  el: Element;
  score: number;
}

function paragraphScores(body: Element): Scored[] {
  const out: Scored[] = [];
  for (const p of Array.from(body.querySelectorAll("p"))) {
    if (blocked(p)) continue;
    const text = textOf(p);
    if (text.length < 10) continue;
    const linkLen = Array.from(p.querySelectorAll("a")).reduce((n, a) => n + textOf(a).length, 0);
    const base = 1 + (text.match(/[,;]/g)?.length ?? 0) + Math.min(Math.floor(text.length / 100), 3);
    out.push({ el: p, score: base * (1 - Math.min(linkLen / text.length, 0.9)) });
  }
  return out;
}

/** Readability-style choice of the element that holds the main content. */
function pickRoot(doc: Document): Element {
  const body = doc.body ?? doc.documentElement;
  const scored = paragraphScores(body);
  const acc = new Map<Element, number>();
  for (const { el, score } of scored) {
    const parent = el.parentElement;
    const grand = parent?.parentElement;
    if (parent) acc.set(parent, (acc.get(parent) ?? 0) + score);
    if (grand) acc.set(grand, (acc.get(grand) ?? 0) + score / 2);
  }
  let best: Scored | undefined;
  for (const [el, score] of acc) {
    if (tag(el) === "body" || tag(el) === "html") continue;
    if (!best || score > best.score) best = { el, score };
  }
  const semantic = Array.from(body.querySelectorAll(SEMANTIC_ROOT))
    .filter((e) => !blocked(e))
    .map((el) => ({ el, score: scored.filter((s) => el.contains(s.el)).reduce((n, s) => n + s.score, 0) }))
    .sort((a, b) => b.score - a.score)[0];
  if (semantic && (!best || semantic.score >= best.score * 0.5)) return semantic.el;
  return best?.el ?? body;
}

function absUrl(src: string, base: string): string | undefined {
  if (!src || /^data:/i.test(src)) return undefined;
  try {
    return new URL(src, base).href;
  } catch {
    return undefined;
  }
}

function collectBlocks(root: Element, url: string): Block[] {
  const blocks: Block[] = [];
  const push = (b: Omit<Block, "id">): void => {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === b.kind && last.text === b.text && b.kind !== "image") return;
    blocks.push({ id: `b${blocks.length}`, ...b });
  };
  const skipped = (el: Element): boolean => SKIP_TAGS.has(tag(el)) || isHidden(el) || isNoise(el);

  const visit = (el: Element, isRoot: boolean): void => {
    const t = tag(el);
    if (isRoot ? SKIP_TAGS.has(t) || isHidden(el) : skipped(el)) return;
    if (t === "form") return;
    if (/^h[1-6]$/.test(t)) {
      const text = textOf(el);
      if (text) push({ kind: "heading", text, level: Number(t[1]) });
    } else if (t === "p") {
      const text = textOf(el);
      if (text) push({ kind: "paragraph", text });
    } else if (t === "ul" || t === "ol") {
      const items = Array.from(el.children).filter((c) => tag(c) === "li" && !isHidden(c)).map((li) => textOf(li)).filter(Boolean);
      if (items.length) push({ kind: "list", text: items.join("\n") });
    } else if (t === "table") {
      const rows = Array.from(el.querySelectorAll("tr"))
        .map((tr) => Array.from(tr.children).filter((c) => ["td", "th"].includes(tag(c))).map((c) => textOf(c)))
        .filter((r) => r.some(Boolean));
      if (rows.length) push({ kind: "table", text: rows.map((r) => r.join(" | ")).join("\n"), rows });
    } else if (t === "blockquote") {
      const text = textOf(el);
      if (text) push({ kind: "quote", text });
    } else if (t === "pre") {
      const text = (el.textContent ?? "").replace(/\s+$/, "").replace(/^\n+/, "");
      if (text.trim()) push({ kind: "code", text });
    } else if (t === "img") {
      const alt = collapse(attr(el, "alt"));
      const src = absUrl(attr(el, "src"), url);
      if (alt && src) push({ kind: "image", text: alt, src });
    } else {
      let run: Node[] = [];
      const flush = (): void => {
        const text = collapse(run.map((n) => (n.nodeType === 3 ? n.nodeValue ?? "" : textOf(n))).join(" "));
        if (text) push({ kind: "paragraph", text });
        run = [];
      };
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 3) run.push(child);
        else if (child.nodeType === 1) {
          const c = child as Element;
          if (BLOCKISH.has(tag(c))) {
            flush();
            visit(c, false);
          } else if (!skipped(c)) run.push(c);
        }
      }
      flush();
    }
  };
  visit(root, true);
  return blocks;
}

const PRICE_RE = /([$€£]\s?\d|\d[\d.,]*\s?(€|Kč|USD|EUR|CZK|£|\$))/g;
const PRICING_WORDS = /(per month|\/\s?mo\b|\/\s?month|monthly|annually|\/\s?year|pricing|billed|buy now|add to cart|checkout|free trial|za měsíc)/i;

function classify(doc: Document, url: string, blocks: Block[], hasForms: boolean): PageKind {
  const bodyText = blocks.map((b) => b.text).join("\n");
  const paragraphs = blocks.filter((b) => b.kind === "paragraph");
  const longParas = paragraphs.filter((b) => b.text.length >= 80).length;
  const codeBlocks = blocks.filter((b) => b.kind === "code").length;
  const rawBodyLen = collapse(doc.body?.textContent ?? "").length || 1;

  let dominantForm = false;
  if (hasForms) {
    for (const f of listForms(doc)) {
      if (buildBindings(f, doc).length >= 3 && textOf(f).length >= rawBodyLen * 0.35) dominantForm = true;
    }
  }
  if (dominantForm) return "form";
  if ((bodyText.match(PRICE_RE)?.length ?? 0) >= 2 && PRICING_WORDS.test(bodyText)) return "product";
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    /* no path */
  }
  if (codeBlocks >= 2 || (/\/(docs?|reference|api|guide)(\/|$)/i.test(path) && blocks.filter((b) => b.kind === "heading").length >= 2)) return "docs";
  const comments = Array.from(doc.querySelectorAll("[class*=comment], [class*=reply]")).filter((e) => !isHidden(e)).length;
  if (blocks.filter((b) => b.kind === "quote").length >= 3 || comments >= 3) return "thread";
  const og = doc.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? "";
  if (doc.querySelector("article") || /article/i.test(og) || longParas >= 3) return "article";
  const listItems = blocks.filter((b) => b.kind === "list").reduce((n, b) => n + b.text.split("\n").length, 0);
  if (listItems >= 8 && paragraphs.length < 3) return "listing";
  return "other";
}

export function extractPage(doc: Document, url: string): PageModel {
  const root = pickRoot(doc);
  const blocks = collectBlocks(root, url);
  if (!blocks.some((b) => b.kind === "heading")) {
    const h1 = Array.from(doc.querySelectorAll("h1")).find((h) => !blocked(h) && !root.contains(h));
    const text = h1 ? textOf(h1) : "";
    if (text) {
      blocks.unshift({ id: "", kind: "heading", text, level: 1 });
      blocks.forEach((b, i) => (b.id = `b${i}`));
    }
  }
  const h1 = blocks.find((b) => b.kind === "heading");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep empty */
  }
  const forms = listForms(doc).length;
  const page: PageModel = {
    url: publicUrl(url),
    title: collapse(doc.title ?? "") || h1?.text || host,
    lang: pageLang(doc),
    kind: classify(doc, url, blocks, forms > 0),
    blocks,
  };
  if (forms > 0) page.formCount = forms;
  return page;
}
