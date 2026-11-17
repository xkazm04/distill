// DOM helpers shared by the web host (iframe document) and the extension content script. No React here.
const MARK = "data-distill-mark";

function fieldElement(doc: Document, fieldId: string): HTMLElement | null {
  return doc.getElementById(fieldId) ?? (doc.getElementsByName(fieldId)[0] as HTMLElement | undefined) ?? null;
}

/** Outline the given fields (and clear any earlier outline). Reversible: the original inline style is restored. */
export function applyHighlight(doc: Document, fieldIds: readonly string[]): void {
  doc.querySelectorAll<HTMLElement>(`[${MARK}]`).forEach((el) => {
    el.style.outline = el.getAttribute(MARK) ?? "";
    el.removeAttribute(MARK);
  });
  for (const id of fieldIds) {
    const el = fieldElement(doc, id);
    if (!el) continue;
    el.setAttribute(MARK, el.style.outline);
    el.style.outline = "3px solid #0b5fff";
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
