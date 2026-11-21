// #5 Call, write or find them: the page side of the contact card. Reads the whole page with the engine's findContacts
// (the parts Clean hid included) and keeps the elements to show where each item was found. The items are page text
// (a shop's phone number); nothing the person typed is read (findContacts skips form fields and editable areas).
import { findContacts } from "@distill/engine";
import { applyLocate } from "@distill/web/dom";
import type { ContactItem } from "../messages";

/** Item id -> where it was found, by the last readContacts. Never leaves the page. */
let where = new Map<string, Element>();
let unmark: ReturnType<typeof setTimeout> | null = null;
/** How long "here it is" stays outlined. */
const MARK_MS = 2400;
const ORIGINAL = "data-distill-original";
const HIDE = "data-distill-hide";

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The contact items of the page; `removed`: what Clean hid, to mark the items found there. */
export function readContacts(doc: Document, removed: readonly Element[]): ContactItem[] {
  const next = new Map<string, Element>();
  const found = findContacts(doc, { url: doc.location?.href ?? "", onElement: (id, el) => next.set(id, el) });
  where = next;
  return found.map((f) => {
    const el = next.get(f.id);
    const item: ContactItem = { id: f.id, kind: f.kind, text: f.text, hidden: !!el && removed.some((r) => r.hasAttribute(HIDE) && r.contains(el)) };
    if (f.href) item.href = f.href;
    return item;
  });
}

/** Whether `el` is out of sight now because Clean hid the part of the page it is in (and the original is not shown). */
function hiddenByClean(doc: Document, el: Element): boolean {
  return !doc.documentElement.hasAttribute(ORIGINAL) && !!el.closest(`[${HIDE}]`);
}

/**
 * Scrolls to the element item `id` was found in and outlines it for a moment. When Clean hid that part of the page the
 * page is left as it is: the frame says where it was found and that Original shows it (bringing one removed part back
 * from here would undo Clean behind the person's back).
 */
export function showContact(doc: Document, id: string): void {
  const el = where.get(id);
  if (!el?.isConnected) throw new Error("That part of the page is no longer there.");
  if (hiddenByClean(doc, el)) return;
  markOnPage(doc, el);
}

/**
 * Outlines `el` for a moment ("here it is") and brings it into view: applyLocate scrolls it to a third of the window
 * when it is out of view; one that is in view but under the strip at the bottom is moved up clear of it. The outline
 * and its style sheet go again after MARK_MS. Shared with the form check (#9).
 */
export function markOnPage(doc: Document, el: Element): void {
  const win = doc.defaultView;
  const instant = reducedMotion();
  const r = el.getBoundingClientRect();
  const inView = !!win && r.top >= 8 && r.bottom <= win.innerHeight - 8;
  applyLocate(doc, [el], undefined, instant);
  // The strip covers the bottom of the window: 46 px at first sight, up to 45% with More open.
  if (win && inView && r.bottom > win.innerHeight * 0.5) {
    win.scrollBy({ top: r.bottom - win.innerHeight * 0.4, behavior: instant ? "auto" : "smooth" });
  }
  if (unmark) clearTimeout(unmark);
  unmark = setTimeout(() => {
    unmark = null;
    applyLocate(doc, []);
    // applyLocate leaves its style sheet for the next call; take it away when nothing else is outlined.
    if (!doc.querySelector("[data-distill-locate]")) doc.getElementById("distill-locate-style")?.remove();
  }, MARK_MS);
}
