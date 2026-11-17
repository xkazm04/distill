// DOM helpers shared by the web host (iframe document) and the extension content script. No React here.
import { readableColor, toHex } from "./theme/derive";

const MARK = "data-distill-mark";
/** Used only when the theme's accent cannot be read as a solid colour. */
export const HIGHLIGHT_FALLBACK = "#0b5fff";

function fieldElement(doc: Document, fieldId: string): HTMLElement | null {
  return doc.getElementById(fieldId) ?? (doc.getElementsByName(fieldId)[0] as HTMLElement | undefined) ?? null;
}

/** The active theme's `--accent`, resolved now to a colour string (the brand on the web, the matched page in the
 *  extension's side panel). Falls back to HIGHLIGHT_FALLBACK when it is missing or unreadable. */
export function accentColor(doc: Document = document): string {
  try {
    const root = doc.documentElement;
    const view = doc.defaultView;
    const raw = (view ? view.getComputedStyle(root).getPropertyValue("--accent") : "").trim() || root.style.getPropertyValue("--accent").trim();
    const c = readableColor(raw);
    return c ? toHex(c) : HIGHLIGHT_FALLBACK;
  } catch {
    return HIGHLIGHT_FALLBACK;
  }
}

/** Outline the given fields (and clear any earlier outline) in `color`, normalised to hex so no other CSS can ride
 *  along. Reversible: the original inline style is restored. */
export function applyHighlight(doc: Document, fieldIds: readonly string[], color?: string): void {
  const solid = readableColor(color);
  const outline = `3px solid ${solid ? toHex(solid) : HIGHLIGHT_FALLBACK}`;
  doc.querySelectorAll<HTMLElement>(`[${MARK}]`).forEach((el) => {
    el.style.outline = el.getAttribute(MARK) ?? "";
    el.removeAttribute(MARK);
  });
  for (const id of fieldIds) {
    const el = fieldElement(doc, id);
    if (!el) continue;
    el.setAttribute(MARK, el.style.outline);
    el.style.outline = outline;
    el.style.outlineOffset = "2px";
  }
  fieldIds.length && fieldElement(doc, fieldIds[0] as string)?.scrollIntoView?.({ block: "center" });
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
