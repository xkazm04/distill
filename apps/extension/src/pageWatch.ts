// Runs in the page (content script). Tells the side panel when the page changed in a way that matters to it, so the
// panel can read it again without a reload: form controls came or went, the main text changed by more than a little,
// or the address changed without a load (a single-page app's history). Only counts and control shapes are compared;
// no text, value or address leaves this function, and the message carries only the reason.

/** What two moments of a page are compared by: the form controls (by tag, type and id/name) and the main text length. */
export interface PageSnapshot {
  controls: string;
  textLength: number;
}

const CONTROLS = "input:not([type='hidden']), select, textarea";
const MAIN = "main, [role='main'], article";
/** A text change counts when it is at least this many characters, and at least TEXT_SHARE of the text. */
const TEXT_MIN = 80;
const TEXT_SHARE = 0.05;
export const WATCH_DELAY_MS = 800;

export function snapshot(doc: Document): PageSnapshot {
  const controls = Array.from(doc.querySelectorAll(CONTROLS), (el) =>
    `${el.tagName}:${el.getAttribute("type") ?? ""}:${el.id || el.getAttribute("name") || ""}`).join("|");
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
 * Watches `doc` and calls `notify` at most once per quiet period of `delayMs` after a meaningful change. Attribute
 * changes are not watched, so Distill's own outlines (style attributes, a marker attribute) never count; its one style
 * element changes neither the controls nor the text. pushState/replaceState are seen through the Navigation API: a
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
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  win.addEventListener("popstate", onHistory);
  const nav = (win as Window & { navigation?: EventTarget }).navigation;
  nav?.addEventListener?.("currententrychange", onHistory);

  return () => {
    observer.disconnect();
    win.removeEventListener("popstate", onHistory);
    nav?.removeEventListener?.("currententrychange", onHistory);
    if (timer !== undefined) clearTimeout(timer);
  };
}
