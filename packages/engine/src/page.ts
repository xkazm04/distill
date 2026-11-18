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

// Form controls and anything else that can hold what a person typed. Their text is never read into a block.
const CONTROL_TAGS = new Set(["input", "select", "textarea", "button", "option", "optgroup", "datalist", "output"]);
const HINT_CLASS = /(^|[\s_-])(hint|help|helper|description|form-text|note)([\s_-]|$)/i;
// ARIA widgets that show a value: a custom combobox shows the chosen option, a suggestion list repeats what was typed,
// a role=textbox or spinbutton holds what was entered. (A role=radio or checkbox shows its own label; its state is an
// attribute, so it stays readable as page text.)
const VALUE_ROLES = new Set(["combobox", "listbox", "option", "textbox", "searchbox", "spinbutton"]);
const isControl = (el: Element): boolean =>
  CONTROL_TAGS.has(tag(el)) || el.hasAttribute("contenteditable") || VALUE_ROLES.has(attr(el, "role").trim().toLowerCase());
const holdsInput = (el: Element): boolean =>
  isControl(el) || !!el.querySelector("input, select, textarea, [contenteditable], [role=combobox], [role=listbox], [role=textbox], [role=searchbox], [role=spinbutton]");
/** Visible text with every control (and so every value) left out. */
const humanText = (el: Element): string => textOf(el, isControl);
const isHint = (el: Element): boolean => tag(el) === "small" || HINT_CLASS.test(`${attr(el, "class")} ${attr(el, "id")}`);

/**
 * The human text of a form, never its values: headings, instructions, legends (as headings), and the field labels with
 * their help text as a list. Controls are skipped whole, so neither a typed value nor a chosen option is ever read.
 */
function collectForm(form: Element, push: Push, skipped: (el: Element) => boolean): void {
  let items: string[] = [];
  /** Where each list item was read from; the list's source is the smallest element that holds them all. */
  let from: Element[] = [];
  const flush = (): void => {
    if (items.length) push({ kind: "list", text: items.join("\n") }, from.reduce(commonAncestor));
    items = [];
    from = [];
  };
  const item = (text: string, el: Element): void => {
    if (text) { items.push(text); from.push(el); }
  };
  const hint = (text: string, el: Element): void => {
    if (!text) return;
    if (items.length) items[items.length - 1] += ` - ${text}`;
    else { items.push(text); from.push(el); }
  };

  const walk = (el: Element, depth: number): void => {
    let run: string[] = [];
    const flushRun = (): void => {
      item(collapse(run.join(" ")), el);
      run = [];
    };
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        run.push(child.nodeValue ?? "");
        continue;
      }
      if (child.nodeType !== 1) continue;
      const c = child as Element;
      const t = tag(c);
      if (isControl(c) || skipped(c)) continue;
      if (!BLOCKISH.has(t) && !holdsInput(c) && !isHint(c)) {
        run.push(humanText(c));
        continue;
      }
      flushRun();
      if (/^h[1-6]$/.test(t) || t === "legend") {
        flush();
        const text = humanText(c);
        if (text) push({ kind: "heading", text, level: t === "legend" ? Math.min(depth + 1, 6) : Number(t[1]) }, c);
      } else if (t === "fieldset") {
        flush();
        walk(c, depth + 1);
        flush();
      } else if (t === "label") {
        item(textOf(c, (e) => isControl(e) || isHint(e)), c);
        Array.from(c.querySelectorAll("*")).filter((e) => isHint(e) && !isHidden(e)).forEach((e) => hint(humanText(e), e));
      } else if (isHint(c)) {
        hint(humanText(c), c);
      } else if (t === "p" && !holdsInput(c)) {
        flush();
        const text = humanText(c);
        if (text) push({ kind: "paragraph", text }, c);
      } else {
        walk(c, depth);
      }
    }
    flushRun();
  };
  walk(form, 0);
  flush();
}

/** Adds a block, read from `el`. */
type Push = (b: Omit<Block, "id">, el: Element) => void;

/** The blocks of `root`, each with the element it was read from (same order, same length). */
function collectBlocks(root: Element, url: string, formPage: boolean): { blocks: Block[]; sources: Element[] } {
  const blocks: Block[] = [];
  const sources: Element[] = [];
  const push: Push = (b, el) => {
    const last = blocks[blocks.length - 1];
    if (last && last.kind === b.kind && last.text === b.text && b.kind !== "image") return;
    blocks.push({ id: `b${blocks.length}`, ...b });
    sources.push(el);
  };
  // On a form page, a page-level <header> that holds the h1 carries the form's title and instructions, so it is content.
  // A <nav> inside it is still noise on its own.
  const pageHeader = (el: Element): boolean => formPage && tag(el) === "header" && !!el.querySelector("h1");
  // A control (input, textarea, select, a contenteditable editor) holds what a PERSON typed, never page content. It is
  // skipped everywhere, not only inside a <form>: an email draft in a contenteditable region is a value, and page
  // models feed cloud-eligible prompts (CLAUDE.md law: values never leave the device).
  const skipped = (el: Element): boolean =>
    SKIP_TAGS.has(tag(el)) || isControl(el) || isHidden(el) || (isNoise(el) && !pageHeader(el));

  const visit = (el: Element, isRoot: boolean): void => {
    const t = tag(el);
    if (isRoot ? SKIP_TAGS.has(t) || isHidden(el) : skipped(el)) return;
    if (t === "form") {
      if (formPage) collectForm(el, push, skipped);
      return;
    }
    if (/^h[1-6]$/.test(t)) {
      const text = textOf(el);
      if (text) push({ kind: "heading", text, level: Number(t[1]) }, el);
    } else if (t === "p") {
      const text = textOf(el);
      if (text) push({ kind: "paragraph", text }, el);
    } else if (t === "ul" || t === "ol") {
      const items = Array.from(el.children).filter((c) => tag(c) === "li" && !isHidden(c)).map((li) => textOf(li)).filter(Boolean);
      if (items.length) push({ kind: "list", text: items.join("\n") }, el);
    } else if (t === "table") {
      const rows = Array.from(el.querySelectorAll("tr"))
        .map((tr) => Array.from(tr.children).filter((c) => ["td", "th"].includes(tag(c))).map((c) => textOf(c)))
        .filter((r) => r.some(Boolean));
      if (rows.length) push({ kind: "table", text: rows.map((r) => r.join(" | ")).join("\n"), rows }, el);
    } else if (t === "blockquote") {
      const text = textOf(el);
      if (text) push({ kind: "quote", text }, el);
    } else if (t === "pre") {
      const text = (el.textContent ?? "").replace(/\s+$/, "").replace(/^\n+/, "");
      if (text.trim()) push({ kind: "code", text }, el);
    } else if (t === "img") {
      const alt = collapse(attr(el, "alt"));
      const src = absUrl(attr(el, "src"), url);
      if (alt && src) push({ kind: "image", text: alt, src }, el);
    } else {
      let run: Node[] = [];
      const flush = (): void => {
        const text = collapse(run.map((n) => (n.nodeType === 3 ? n.nodeValue ?? "" : textOf(n))).join(" "));
        if (text) push({ kind: "paragraph", text }, el);
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
  return { blocks, sources };
}

const PRICE_RE = /([$€£]\s?\d|\d[\d.,]*\s?(€|Kč|USD|EUR|CZK|£|\$))/g;
const PRICING_WORDS = /(per month|\/\s?mo\b|\/\s?month|monthly|annually|\/\s?year|pricing|billed|buy now|add to cart|checkout|free trial|za měsíc)/i;

/** The form that dominates the page (three fields or more, and a good share of its text), if there is one. */
function dominantForm(doc: Document, forms: Element[]): Element | undefined {
  const rawBodyLen = collapse(doc.body?.textContent ?? "").length || 1;
  return forms.find((f) => buildBindings(f).length >= 3 && textOf(f).length >= rawBodyLen * 0.35);
}

function classify(doc: Document, url: string, blocks: Block[], formPage: boolean): PageKind {
  if (formPage) return "form";
  const bodyText = blocks.map((b) => b.text).join("\n");
  const paragraphs = blocks.filter((b) => b.kind === "paragraph");
  const longParas = paragraphs.filter((b) => b.text.length >= 80).length;
  const codeBlocks = blocks.filter((b) => b.kind === "code").length;
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

/** Whitespace and letter case do not make two texts different. */
const sameText = (a: string, b: string): boolean => collapse(a).toLowerCase() === collapse(b).toLowerCase();

/** The smallest element that holds both. */
function commonAncestor(a: Element, b: Element): Element {
  for (let el: Element | null = a; el; el = el.parentElement) if (el.contains(b)) return el;
  return b.ownerDocument.documentElement;
}

export interface ExtractOptions {
  /** Called once per block with its final id and the element of `doc` the block was read from, so a host can point
   *  at a block's source in the original page. The element never goes into the PageModel. */
  onSource?: (blockId: string, el: Element) => void;
}

export function extractPage(doc: Document, url: string, opts?: ExtractOptions): PageModel {
  // The page view reads the top document's own tree: a form in a frame or a shadow root is reachable to Wayfill, but
  // its surroundings are not page text here.
  const forms = listForms(doc).filter((f) => f.getRootNode() === doc);
  const form = dominantForm(doc, forms);
  let root = pickRoot(doc);
  // A form page reads the text around its form too, so the root holds the whole form and what sits beside it.
  if (form && (root === form || form.contains(root))) root = form.parentElement ?? form;
  else if (form && !root.contains(form)) root = commonAncestor(root, form);
  const { blocks, sources } = collectBlocks(root, url, !!form);

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep empty */
  }
  const hasHeading = blocks.some((b) => b.kind === "heading");
  const outside = hasHeading ? undefined : Array.from(doc.querySelectorAll("h1")).find((h) => !blocked(h) && !root.contains(h) && textOf(h));
  const h1Text = outside ? textOf(outside) : "";
  const title = collapse(doc.title ?? "") || blocks.find((b) => b.kind === "heading")?.text || h1Text || host;

  // The focus view shows the title above the blocks. The page's h1 leads the blocks when the content root has no
  // heading, unless it only repeats the title; and a leading heading that only repeats the title is not shown again.
  if (h1Text && !sameText(h1Text, title) && !blocks.some((b) => sameText(b.text, h1Text))) {
    blocks.unshift({ id: "", kind: "heading", text: h1Text, level: 1 });
    sources.unshift(outside as Element);
  }
  if (blocks[0]?.kind === "heading" && sameText(blocks[0].text, title)) {
    blocks.shift();
    sources.shift();
  }
  blocks.forEach((b, i) => (b.id = `b${i}`));
  if (opts?.onSource) blocks.forEach((b, i) => opts.onSource?.(b.id, sources[i] as Element));

  const page: PageModel = {
    url: publicUrl(url),
    title,
    lang: pageLang(doc),
    kind: classify(doc, url, blocks, !!form),
    blocks,
  };
  if (forms.length > 0) page.formCount = forms.length;
  return page;
}
