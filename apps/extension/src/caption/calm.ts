// #8 Calm the page: media that started by itself is paused (not the main video the page is for: ctx.protect), carousels,
// marquees and endless animations stop. Each can play again. While Calm is on, a video that starts later without the
// person asking (no click or key press just before) is paused too. Everything Calm marks or styles goes on close; media
// it paused stays paused then (sound coming back when Distill closes would be a surprise). See docs/caption.md.
import { treesOf } from "@distill/web/dom";
import type { CleanContext } from "./context";

/** On <html> while Calm holds the page's endless animations (the style below applies only then). */
const CALM = "data-distill-calm";
/** On an element whose endless animation Calm paused. */
const STILL = "data-distill-still";
/** On media Calm paused, and on marquees and carousels it stopped. */
const PAUSED = "data-distill-paused";
const STOPPED = "data-distill-stopped";

const CSS = `
html[${CALM}]:not([data-distill-original]) [${STILL}],
html[${CALM}]:not([data-distill-original]) [${STILL}]::before,
html[${CALM}]:not([data-distill-original]) [${STILL}]::after { animation-play-state: paused !important; }
`;

/** Carousel libraries by the class they put on their root. `hover`: the library pauses its autoplay while the pointer is
 *  over it by default, so a pointer "over" it from Calm stops it; the others are only nudged and not counted. */
const CAROUSELS: { sel: string; hover: boolean }[] = [
  { sel: ".slick-slider", hover: true },
  { sel: ".splide", hover: true },
  { sel: ".glide", hover: true },
  { sel: ".flickity-enabled", hover: true },
  { sel: ".swiper, .swiper-container, swiper-container", hover: false },
  { sel: ".owl-carousel", hover: false },
];
/** The page's own media playing again after Calm paused it this many times: the page insists, Calm lets it be. */
const MAX_FIGHTS = 3;

interface Held { el: HTMLMediaElement; play: boolean }

let active = false;
let protect: readonly Element[] = [];
let media: Held[] = [];
let marquees: Element[] = [];
let carousels: Element[] = [];
/** Animations made with the Web Animations API (not CSS), paused directly. */
let scripted: Animation[] = [];
let animated = false;
let counted = { media: 0, motion: 0 };
const fights = new WeakMap<HTMLMediaElement, number>();
let unguard: () => void = () => undefined;
const listeners = new Set<() => void>();

/** Calls `cb` whenever Calm's counts change by themselves (a late video paused, Play again). Returns the unsubscribe. */
export function onCalmChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const changed = () => { for (const cb of listeners) cb(); };

/** What Calm holds now: the report's `calm` field. */
export const calmCounts = (): { media: number; motion: number } => ({ ...counted });

/** Calm's view of what the page is for, after a single-page app showed another page (Stay clean rebuilt its context). */
export function calmProtect(next: readonly Element[]): void { protect = next; }

/** `el` is `p` or inside it, through shadow roots and same-origin frames. */
function within(p: Element, el: Element): boolean {
  for (let n: Element | null = el; n; ) {
    if (n === p || p.contains(n)) return true;
    const root = n.getRootNode() as Node & { host?: Element };
    n = root.host ?? (root as Document).defaultView?.frameElement ?? null;
  }
  return false;
}
const isProtected = (el: Element): boolean => protect.some((p) => within(p, el));

const shown = (el: Element): boolean => {
  if (el.closest("[data-distill-hide]")) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 2 && r.height >= 2;
};

function pause(m: HTMLMediaElement, play: boolean): void {
  try { m.pause(); } catch { return; }
  m.setAttribute(PAUSED, "");
  if (!media.some((h) => h.el === m)) { media.push({ el: m, play }); counted.media += 1; }
}

/** A video that starts while Calm is on, and not because the person just clicked or pressed a key: pause it. */
function guard(trees: readonly (Document | ShadowRoot)[]): () => void {
  const onPlay = (e: Event) => {
    const m = e.target as HTMLMediaElement;
    if (!active || !(m?.localName === "video" || m?.localName === "audio") || isProtected(m)) return;
    const view = m.ownerDocument.defaultView as (Window & { navigator: Navigator & { userActivation?: { isActive: boolean } } }) | null;
    if (view?.navigator.userActivation?.isActive) return; // the person started it
    const n = (fights.get(m) ?? 0) + 1;
    fights.set(m, n);
    if (n > MAX_FIGHTS) return;
    const before = counted.media;
    pause(m, true);
    if (counted.media !== before) changed();
  };
  // Media events do not bubble and do not leave a shadow root: each tree listens in its capture phase.
  for (const t of trees) t.addEventListener("play", onPlay, true);
  return () => { for (const t of trees) t.removeEventListener("play", onPlay, true); };
}

const hover = (el: Element, on: boolean): void => {
  const types = on ? ["pointerover", "pointerenter", "mouseover", "mouseenter"] : ["pointerout", "pointerleave", "mouseout", "mouseleave"];
  for (const type of types) {
    const bubbles = type.endsWith("over") || type.endsWith("out");
    const ev = type.startsWith("pointer") ? new PointerEvent(type, { bubbles, composed: true }) : new MouseEvent(type, { bubbles, composed: true });
    el.dispatchEvent(ev);
  }
};

/** Pauses and stops; returns the counts. */
export function calmPage(ctx: CleanContext): { media: number; motion: number } {
  clearCalm(ctx.doc);
  const doc = ctx.doc;
  active = true;
  protect = ctx.protect;
  const trees = treesOf(doc);

  // Media that plays, or would start by itself, and is not what the page is for.
  for (const t of trees) {
    for (const m of Array.from(t.querySelectorAll<HTMLMediaElement>("video, audio"))) {
      if (isProtected(m)) continue;
      const autoplay = m.autoplay || m.hasAttribute("autoplay");
      if (!m.paused || autoplay) pause(m, true);
    }
  }

  // Moving parts the person can see: marquees, carousels, endless animations.
  let motion = 0;
  for (const t of trees) {
    for (const mq of Array.from(t.querySelectorAll("marquee"))) {
      if (isProtected(mq) || !shown(mq)) continue;
      (mq as HTMLElement & { stop?: () => void }).stop?.();
      mq.setAttribute(STOPPED, "");
      marquees.push(mq);
      motion += 1;
    }
  }
  for (const { sel, hover: pausesOnHover } of CAROUSELS) {
    for (const c of Array.from(doc.querySelectorAll(sel))) {
      if (carousels.some((o) => o.contains(c)) || isProtected(c) || !shown(c)) continue;
      hover(c, true);
      c.setAttribute(STOPPED, "");
      carousels.push(c);
      if (pausesOnHover) motion += 1;
    }
  }
  const html = doc.documentElement;
  for (const a of typeof doc.getAnimations === "function" ? doc.getAnimations() : []) {
    const effect = a.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!effect || !target || target.localName === "distill-caption" || isProtected(target)) continue;
    if (effect.getComputedTiming().endTime !== Infinity || a.playState !== "running" || !shown(target)) continue;
    if ("animationName" in a) target.setAttribute(STILL, ""); // a CSS animation: the style pauses it
    else { a.pause(); scripted.push(a); }
    animated = true;
  }
  if (animated) {
    html.setAttribute(CALM, "");
    const style = doc.createElement("style");
    style.setAttribute("data-distill", "calm");
    style.textContent = CSS;
    (doc.head ?? html).append(style);
    motion += 1;
  }

  counted = { media: counted.media, motion };
  unguard = guard(trees);
  return calmCounts();
}

/** Lets everything Calm stopped play and move again. Media plays again only when it was playing (or set to start by
 *  itself) when Calm paused it; Calm never changed whether it is muted. */
export function playAgain(doc: Document): void {
  if (!active) return;
  for (const { el, play } of media) {
    el.removeAttribute(PAUSED);
    if (play && el.isConnected) void el.play().catch(() => undefined);
  }
  release(doc);
  changed();
}

/** Takes every change back (close). Paused media stays paused; marquees, carousels and animations move again. */
export function clearCalm(doc: Document): void {
  for (const { el } of media) el.removeAttribute(PAUSED);
  release(doc);
}

function release(doc: Document): void {
  for (const mq of marquees) { mq.removeAttribute(STOPPED); (mq as HTMLElement & { start?: () => void }).start?.(); }
  for (const c of carousels) { c.removeAttribute(STOPPED); hover(c, false); }
  for (const a of scripted) { try { a.play(); } catch { /* gone */ } }
  for (const el of Array.from(doc.querySelectorAll(`[${STILL}]`))) el.removeAttribute(STILL);
  doc.documentElement.removeAttribute(CALM);
  doc.querySelector('style[data-distill="calm"]')?.remove();
  unguard();
  unguard = () => undefined;
  active = false;
  media = [];
  marquees = [];
  carousels = [];
  scripted = [];
  animated = false;
  counted = { media: 0, motion: 0 };
}
