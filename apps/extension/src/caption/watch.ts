// #3 Stay clean while the page keeps changing: watches for new boxes (a late pop-up, an ad loaded on scroll, a single-page
// app's new view) and asks page.ts to judge them (page.ts recheck). Only element additions and the attribute changes that
// can make a fixed box appear wake it; what Distill does itself never does. It waits for the page to be quiet, runs at
// most about once a second (less often when judging takes long, so a huge page stays smooth), and rests while the
// person looks at the original. Nothing here reads page text.
import { onCalmChange } from "./calm";

/** Quiet time after the last change before judging (ms). */
const QUIET_MS = 400;
/** At most one judgement per this long (ms); stretched to JUDGE_SHARE of the time when judging is slow. */
const MIN_GAP_MS = 1000;
/** A page that never stops changing is still judged this long after its first change (ms). */
const MAX_WAIT_MS = 3000;
/** Judging may take at most this share of the time (a 200 ms judgement waits at least 1.6 s for the next one). */
const JUDGE_SHARE = 1 / 8;
/** How long a pointer or key press inside a box counts as the person using it (ms). */
const ENGAGED_MS = 60_000;

const ORIGINAL = "data-distill-original";
const HIDE = "data-distill-hide";
const IGNORED_TAGS = new Set(["script", "style", "link", "meta", "noscript", "template", "br", "wbr", "distill-caption"]);

/** The last place the person pressed a pointer or a key, and when (for page.ts: never hide what they are using). */
let touched: { el: Element; at: number } | null = null;
/** When the person last clicked or activated a control with the keyboard (not a scroll: a touch scroll is no click). */
let activated = 0;

/** Milliseconds since the person last clicked or activated something on the page (Infinity: never). What shows up
 *  right after is their doing (a menu they opened), not the page's. */
export const sincePress = (): number => (activated ? Date.now() - activated : Infinity);

/** True when the person pressed a pointer or a key inside `el` lately, or is typing in a field inside it. */
export function inUse(el: Element): boolean {
  if (touched && touched.el.isConnected && el.contains(touched.el) && Date.now() - touched.at < ENGAGED_MS) return true;
  const active = el.ownerDocument.activeElement;
  if (!active || !el.contains(active)) return false;
  const field = active as HTMLInputElement;
  return (active.localName === "input" || active.localName === "textarea") && !!field.value
    || (active as HTMLElement).isContentEditable;
}

/** Distill's own: its strip, its spacer, its style elements and anything it marked. */
const ours = (el: Element): boolean =>
  el.localName === "distill-caption" || el.getAttributeNames().some((n) => n === "data-distill" || n.startsWith("data-distill-"));

/** Inside a box Clean hid: nothing there can show. */
const insideHidden = (el: Element): boolean => !!el.closest(`[${HIDE}]`);

/** Inside a video player (the box about the video's size around it): captions and controls change all the time, and
 *  nothing in the player is ever clutter. */
function inPlayer(el: Element): boolean {
  for (let p = el.parentElement, i = 0; p && i < 12; p = p.parentElement, i++) {
    const v = p.localName === "video" ? p : p.querySelector("video");
    if (!v) continue;
    const vr = v.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    return vr.width > 0 && pr.width <= vr.width * 1.15 && pr.height <= vr.height * 1.3;
  }
  return false;
}

/** Calls `recheck` after the page changed and settled; returns a function that stops watching. */
export function watchForClutter(doc: Document, win: Window, recheck: () => void): () => void {
  const html = doc.documentElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstChange = 0;
  let lastRun = 0;
  let gap = MIN_GAP_MS;
  let stopped = false;
  /** Elements added since the last judgement, and the elements whose style, class or hidden changed. */
  const added: Element[] = [];
  const changed = new Set<Element>();
  /** A history step or Calm's state changed: judge whatever the DOM says. */
  let forced = false;
  /** Fixed boxes already seen on screen: a header whose class flips on every scroll wakes the judging once, not always. */
  const seenFixed = new WeakSet<Element>();

  const original = () => html.hasAttribute(ORIGINAL);

  /** Whether anything since the last judgement can be new clutter. Reads layout only for the few changed boxes. */
  const worthJudging = (): boolean => {
    if (forced) return true;
    for (const el of added.splice(0)) {
      if (el.isConnected && !ours(el) && !insideHidden(el) && !inPlayer(el)) { added.length = 0; changed.clear(); return true; }
    }
    const boxes = Array.from(changed);
    changed.clear();
    for (const el of boxes) {
      if (!el.isConnected || ours(el) || insideHidden(el)) continue;
      // The box itself, or a box right inside it (a wrapper's class shows its fixed dialog).
      for (const b of [el, ...Array.from(el.children).slice(0, 20)]) {
        if (seenFixed.has(b) || ours(b)) continue;
        const cs = win.getComputedStyle(b);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = b.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        seenFixed.add(b);
        return true;
      }
    }
    return false;
  };

  const run = () => {
    timer = undefined;
    firstChange = 0;
    if (stopped || original()) return;
    if (!worthJudging()) return;
    forced = false;
    const t0 = performance.now();
    lastRun = Date.now();
    try { recheck(); } finally {
      // recheck judges synchronously before its first await (the fade), so this is the cost of judging.
      gap = Math.max(MIN_GAP_MS, (performance.now() - t0) / JUDGE_SHARE);
    }
  };

  const schedule = () => {
    if (stopped || original()) return;
    const now = Date.now();
    firstChange ||= now;
    if (timer !== undefined) clearTimeout(timer);
    const quiet = Math.min(now + QUIET_MS, firstChange + MAX_WAIT_MS);
    const at = Math.max(quiet, lastRun + gap);
    timer = setTimeout(run, Math.max(0, at - now));
  };

  const observer = new MutationObserver((records) => {
    let wake = false;
    for (const r of records) {
      if (r.type === "attributes") {
        if (r.target === html && r.attributeName === ORIGINAL) {
          // Original on: rest. Original off: one look at what came meanwhile.
          if (original()) { if (timer !== undefined) clearTimeout(timer); timer = undefined; firstChange = 0; }
          else { forced = true; wake = true; }
          continue;
        }
        const el = r.target as Element;
        if (el === html || el === doc.body) continue; // a page-wide class flip; a new box comes with its own change
        changed.add(el);
        wake = true;
      } else {
        for (const n of Array.from(r.addedNodes)) {
          if (n.nodeType !== 1) continue; // text: a translation, a counter ticking; never a new box
          const el = n as Element;
          if (IGNORED_TAGS.has(el.localName) || ours(el)) continue;
          added.push(el);
          wake = true;
        }
      }
    }
    if (added.length > 400) added.splice(0, added.length - 400);
    if (wake) schedule();
  });
  observer.observe(html, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden", ORIGINAL] });

  const onHistory = () => { forced = true; schedule(); };
  win.addEventListener("popstate", onHistory);
  const nav = (win as Window & { navigation?: EventTarget }).navigation;
  nav?.addEventListener?.("currententrychange", onHistory);
  const offCalm = onCalmChange(onHistory);

  /** Where the person last pressed: what they use is never hidden from under them. */
  const onPress = (e: Event) => { if (e.isTrusted && e.target instanceof Element) touched = { el: e.target, at: Date.now() }; };
  const onActivate = (e: Event) => {
    if (!e.isTrusted) return;
    if (e.type === "keydown") {
      const k = (e as KeyboardEvent).key;
      const t = e.target as Element | null;
      if ((k !== "Enter" && k !== " ") || !t || t === doc.body || t === html) return; // Space on the page scrolls it
    }
    activated = Date.now();
  };
  doc.addEventListener("pointerdown", onPress, true);
  doc.addEventListener("keydown", onPress, true);
  doc.addEventListener("click", onActivate, true);
  doc.addEventListener("keydown", onActivate, true);

  return () => {
    stopped = true;
    observer.disconnect();
    win.removeEventListener("popstate", onHistory);
    nav?.removeEventListener?.("currententrychange", onHistory);
    offCalm();
    doc.removeEventListener("pointerdown", onPress, true);
    doc.removeEventListener("keydown", onPress, true);
    doc.removeEventListener("click", onActivate, true);
    doc.removeEventListener("keydown", onActivate, true);
    if (timer !== undefined) clearTimeout(timer);
    touched = null;
    activated = 0;
  };
}
