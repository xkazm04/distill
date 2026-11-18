// Runs in the page (content script). Tells the side panel when the page changed in a way that matters to it, so the
// panel can read it again without a reload: form controls came or went, the main text changed by more than a little,
// or the address changed without a load (a single-page app's history). Only counts and control shapes are compared;
// no text, value or address leaves this function, and the message carries only the reason. Controls are counted in
// every tree the engine reads a form from: the document, its open shadow roots and its same-origin frames.
import { treesOf } from "@distill/web/dom";

/** What two moments of a page are compared by: the visible form controls (by tag, type and id/name) and the main text
 *  length. */
export interface PageSnapshot {
  controls: string;
  textLength: number;
}

const CONTROLS = "input:not([type='hidden']), select, textarea, [role=radio], [role=checkbox], [role=switch], [role=combobox], [role=listbox]";
const MAIN = "main, [role='main'], article";
/** A text change counts when it is at least this many characters, and at least TEXT_SHARE of the text. */
const TEXT_MIN = 80;
const TEXT_SHARE = 0.05;
export const WATCH_DELAY_MS = 800;

/** Hidden as the engine sees it (it skips these fields): the hidden attribute, aria-hidden, or an inline
 *  display:none / visibility:hidden on the control or an ancestor, across shadow roots. */
function hiddenUp(el: Element): boolean {
  for (let cur: Element | null = el; cur; cur = cur.parentElement ?? ((cur.parentNode as ShadowRoot | null)?.host ?? null)) {
    if (cur.hasAttribute("hidden") || cur.getAttribute("aria-hidden") === "true") return true;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(cur.getAttribute("style") ?? "")) return true;
  }
  return false;
}

/** The attributes that show or hide a part of a form (the next step of a form in steps). */
const VISIBILITY_ATTRS = ["hidden", "aria-hidden", "style"];

export function snapshot(doc: Document): PageSnapshot {
  const controls = treesOf(doc)
    .flatMap((tree) => Array.from(tree.querySelectorAll(CONTROLS)))
    .filter((el) => !hiddenUp(el))
    .map((el) => `${el.tagName}:${el.getAttribute("type") ?? el.getAttribute("role") ?? ""}:${el.id || el.getAttribute("name") || ""}`)
    .join("|");
  const main = doc.querySelector(MAIN) ?? doc.body;
  return { controls, textLength: (main?.textContent ?? "").replace(/\s+/g, " ").trim().length };
}

/** True when the page changed enough for the panel to read it again. */
export function meaningfulChange(before: PageSnapshot, after: PageSnapshot): boolean {
  if (before.controls !== after.controls) return true;
  const delta = Math.abs(after.textLength - before.textLength);
  return delta >= TEXT_MIN && delta >= before.textLength * TEXT_SHARE;
}

/**
 * Watches `doc` and calls `notify` at most once per quiet period of `delayMs` after a meaningful change. Of the
 * attributes, only those that show or hide (hidden, aria-hidden, style) are watched, so the next step of a form in
 * steps counts; Distill's own outline (a style attribute) only wakes the comparison, which finds the same visible
 * controls, and its marker attributes and one style element change neither the controls nor the text. A same-origin frame's document and an open shadow root are
 * watched too (a step of a form in a frame shows inside the frame), picked up again after each quiet period and when
 * a frame loads. pushState/replaceState are seen through the Navigation API: a
 * content script's own patch of history.pushState would never see the page's calls (they run in another JS world).
 * Returns a function that stops watching.
 */
export function watchPage(
  win: Window,
  doc: Document,
  notify: (reason: "mutation" | "history") => void,
  delayMs = WATCH_DELAY_MS,
): () => void {
  let base = snapshot(doc);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let history = false;

  const flush = () => {
    timer = undefined;
    attach();
    const next = snapshot(doc);
    const changed = meaningfulChange(base, next);
    if (history || changed) {
      notify(history ? "history" : "mutation");
      base = next;
    }
    history = false;
  };
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  };
  const onHistory = () => { history = true; schedule(); };

  const Observer = (win as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver ?? MutationObserver;
  const observer = new Observer(schedule);
  const watched = new WeakSet<Node>();
  /** Observes every tree not yet observed: a new frame document, a new shadow root. */
  const attach = (): void => {
    for (const tree of treesOf(doc)) {
      const node = tree.nodeType === 9 ? (tree as Document).documentElement : tree;
      if (!node || watched.has(node)) continue;
      watched.add(node);
      observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: VISIBILITY_ATTRS });
    }
  };
  attach();
  // A frame's load does not bubble, but it passes the document on the way down: a capturing listener hears it.
  const onLoad = (e: Event): void => {
    const t = e.target as Element | null;
    if (t && (t.localName === "iframe" || t.localName === "frame")) { attach(); schedule(); }
  };
  doc.addEventListener("load", onLoad, true);
  win.addEventListener("popstate", onHistory);
  const nav = (win as Window & { navigation?: EventTarget }).navigation;
  nav?.addEventListener?.("currententrychange", onHistory);

  return () => {
    observer.disconnect();
    doc.removeEventListener("load", onLoad, true);
    win.removeEventListener("popstate", onHistory);
    nav?.removeEventListener?.("currententrychange", onHistory);
    if (timer !== undefined) clearTimeout(timer);
  };
}
