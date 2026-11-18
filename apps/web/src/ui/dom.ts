// DOM helpers shared by the web host (iframe document) and the extension content script. No React here.
import { readableColor, toHex } from "./theme/derive";

const MARK = "data-distill-mark";
/** Used only when the theme's accent cannot be read as a solid colour. */
export const HIGHLIGHT_FALLBACK = "#0b5fff";

/** A tree a form's fields can live in: the document, an open shadow root, or a same-origin frame's document. */
export type Tree = Document | ShadowRoot;

/**
 * The document, then every open shadow root and same-origin frame under it, as the engine reads forms. A frame Distill
 * may not read (another origin: no document, or reading it throws) is skipped without a sound; a closed shadow root
 * cannot be entered. Frames are followed three deep.
 */
export function treesOf(doc: Document): Tree[] {
  const out: Tree[] = [];
  const seen = new Set<Tree>();
  const visit = (tree: Tree, depth: number): void => {
    if (seen.has(tree)) return;
    seen.add(tree);
    out.push(tree);
    for (const el of Array.from(tree.querySelectorAll("*"))) {
      if (el.shadowRoot) visit(el.shadowRoot, depth);
      if ((el.localName === "iframe" || el.localName === "frame") && depth < 3) {
        let inner: Document | null = null;
        try {
          inner = (el as HTMLIFrameElement).contentDocument;
        } catch {
          inner = null;
        }
        if (inner?.documentElement) visit(inner, depth + 1);
      }
    }
  };
  visit(doc, 0);
  return out;
}

/** A value for a quoted CSS attribute selector: backslashes and double quotes escaped. */
const attrValue = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** The element a field id names: by id, then by name, in the document first, then in its shadow roots and frames. */
function fieldElement(trees: readonly Tree[], fieldId: string): HTMLElement | null {
  const v = attrValue(fieldId);
  for (const tree of trees) {
    const el = tree.querySelector(`[id="${v}"]`) ?? tree.querySelector(`[name="${v}"]`);
    if (el) return el as HTMLElement;
  }
  return null;
}

/** The active theme's colour for `role`, resolved now to hex (the brand on the web, the matched page in the
 *  extension's side panel). Falls back to HIGHLIGHT_FALLBACK when it is missing or unreadable. */
function roleColor(role: string, doc: Document): string {
  try {
    const root = doc.documentElement;
    const view = doc.defaultView;
    const raw = (view ? view.getComputedStyle(root).getPropertyValue(role) : "").trim() || root.style.getPropertyValue(role).trim();
    const c = readableColor(raw);
    return c ? toHex(c) : HIGHLIGHT_FALLBACK;
  } catch {
    return HIGHLIGHT_FALLBACK;
  }
}

/** The active theme's `--accent`: the outline of filled fields. */
export function accentColor(doc: Document = document): string {
  return roleColor("--accent", doc);
}

/** The active theme's `--focus`: the outline that says "this is where it is" in the original. */
export function focusColor(doc: Document = document): string {
  return roleColor("--focus", doc);
}

/** The elements of these fields that exist in `doc`. */
export function fieldElements(doc: Document, fieldIds: readonly string[]): HTMLElement[] {
  const trees = treesOf(doc);
  return fieldIds.map((id) => fieldElement(trees, id)).filter((el): el is HTMLElement => !!el);
}

const LOCATE = "data-distill-locate";
const LOCATE_STYLE = "distill-locate-style";

/**
 * Outline `els` in `color` as "this is where it is" (and clear the earlier ones; an empty list only clears). Uses its
 * own attribute and style sheet, never the inline outline applyHighlight saves and restores: a filled field that is
 * also located keeps its outline and gets a ring around it. Scrolls `doc`'s own window only, so the page around a
 * frame never moves; `instant` skips the smooth scroll (reduced motion).
 */
export function applyLocate(doc: Document, els: readonly Element[], color?: string, instant = false): void {
  for (const tree of treesOf(doc)) tree.querySelectorAll(`[${LOCATE}]`).forEach((el) => el.removeAttribute(LOCATE));
  if (!els.length) return;
  const solid = readableColor(color);
  const c = solid ? toHex(solid) : HIGHLIGHT_FALLBACK;
  const css =
    `[${LOCATE}]:not([${MARK}]){outline:3px solid ${c} !important;outline-offset:4px !important;border-radius:3px}` +
    `[${LOCATE}][${MARK}]{box-shadow:0 0 0 6px ${c} !important}`;
  // A style sheet reaches only its own tree, so a field in a shadow root or a frame gets the rule there too.
  const trees = new Set<Tree>([doc, ...els.map((el) => el.getRootNode() as Tree)]);
  for (const tree of trees) {
    const owner = tree.nodeType === 9 ? (tree as Document) : (tree as ShadowRoot).ownerDocument;
    let style = tree.querySelector(`#${LOCATE_STYLE}`);
    if (!style) {
      style = owner.createElement("style");
      style.id = LOCATE_STYLE;
      const at = tree.nodeType === 9 ? ((tree as Document).head ?? (tree as Document).documentElement) : tree;
      at.appendChild(style);
    }
    style.textContent = css;
  }
  els.forEach((el) => el.setAttribute(LOCATE, ""));

  const win = doc.defaultView;
  if (!win) return;
  const away = els.find((el) => el.ownerDocument !== doc);
  if (away) {
    // A field in a frame: the frame's own coordinates are not the page's, so let the browser bring it into view.
    (away as HTMLElement).scrollIntoView?.({ block: "center", behavior: instant ? "auto" : "smooth" });
    return;
  }
  const rects = els.map((el) => el.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  if (top >= 8 && bottom <= win.innerHeight - 8) return; // already in view
  const y = top + win.scrollY - Math.max(24, (win.innerHeight - (bottom - top)) / 3);
  win.scrollTo({ top: Math.max(0, y), behavior: instant ? "auto" : "smooth" });
}

/** Outline the given fields (and clear any earlier outline) in `color`, normalised to hex so no other CSS can ride
 *  along. Reversible: the original inline style is restored. */
export function applyHighlight(doc: Document, fieldIds: readonly string[], color?: string): void {
  const solid = readableColor(color);
  const outline = `3px solid ${solid ? toHex(solid) : HIGHLIGHT_FALLBACK}`;
  const trees = treesOf(doc);
  for (const tree of trees) {
    tree.querySelectorAll<HTMLElement>(`[${MARK}]`).forEach((el) => {
      el.style.outline = el.getAttribute(MARK) ?? "";
      el.removeAttribute(MARK);
    });
  }
  const els = fieldIds.map((id) => fieldElement(trees, id));
  for (const el of els) {
    if (!el) continue;
    el.setAttribute(MARK, el.style.outline);
    el.style.outline = outline;
    el.style.outlineOffset = "2px";
  }
  els[0]?.scrollIntoView?.({ block: "center" });
}

/** Turn pasted text into a minimal document so it can go through the same extraction as any page. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pasted text</title></head><body><article>${paras
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("")}</article></body></html>`;
}

/** True when pasted input is a page of HTML rather than plain text. */
export function looksLikeHtml(input: string): boolean {
  return /<\s*(html|body|form|article|main|div|p|h[1-6]|table|ul|ol)[\s>]/i.test(input);
}

export function looksLikeUrl(input: string): boolean {
  return /^https?:\/\/\S+$/i.test(input.trim());
}
