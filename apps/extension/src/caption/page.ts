// The caption's page side, in the content script: the strip's place on the page (a fixed box at the bottom holding the
// caption frame, an extension page), and what Distill changes in the page itself (Clean, Original). Everything here is
// reversible: closing the caption puts the page back exactly as it was. Nothing read here leaves the page except the
// CleanReport (kinds and labels, no page text). See docs/caption.md.
import { detectLang, extractPage, findClutter, type ClutterItem, type PageModel } from "@distill/engine";
import type { CaptionUpdate, CleanReport } from "../messages";
import { calmPage, clearCalm } from "./calm";
import { applyComfort, clearComfort } from "./comfort";
import { commonAncestor, type CleanContext } from "./context";
import { restick, unstick } from "./float";
import { unwiden, widen } from "./reflow";
import { clearTranslation, originalShown } from "./translate";
import { watchForClutter } from "./watch";

/** On each removed element: its item id. On <html>: the original is shown, or the page may scroll again. */
export const HIDE = "data-distill-hide";
const FADE = "data-distill-fade";
const ORIGINAL = "data-distill-original";
const UNLOCK = "data-distill-unlock";
const SPACER = "data-distill-spacer";
/** On <html> while the caption is on the page, for anyone checking (the e2e harness reads it). */
export const OPEN = "data-distill-caption";

/** The strip at first sight (px). The frame tells the real height once it has drawn. */
export const STRIP_MIN = 46;
/** The strip never takes more than this share of the window, whatever it holds. */
export const STRIP_MAX_SHARE = 0.45;
const FADE_MS = 180;

const PAGE_CSS = `
html:not([${ORIGINAL}]) [${HIDE}] { display: none !important; }
html:not([${ORIGINAL}]) [${FADE}] { opacity: 0 !important; transition: opacity ${FADE_MS}ms ease-out !important; }
html[${UNLOCK}]:not([${ORIGINAL}]), html[${UNLOCK}]:not([${ORIGINAL}]) > body { overflow: auto !important; }
`;

interface State {
  tabId: number;
  host: HTMLElement;
  frame: HTMLIFrameElement;
  spacer: HTMLElement;
  style: HTMLStyleElement;
  report: CleanReport | null;
  removed: Map<string, Element>;
  /** What the last Clean knew (round-1 modules read it). */
  ctx: CleanContext | null;
  /** Stops Stay clean's watching (#3). */
  unwatch: () => void;
}

let state: State | null = null;
/** A Clean that is running: a second ask (the frame mounting twice) waits for it instead of cleaning again. */
let cleaning: Promise<CleanReport> | null = null;

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const important = (el: HTMLElement, css: Record<string, string>) => { for (const [k, v] of Object.entries(css)) el.style.setProperty(k, v, "important"); };

export const isOpen = (): boolean => state !== null;

/** Puts the strip on the page. The frame is an extension page (caption.html): its own document, styles and fonts, out
 *  of the page's reach. The page gets a spacer at its end, so its last lines can scroll clear of the strip. */
export function open(doc: Document, tabId: number): void {
  if (state) return;
  const host = doc.createElement("distill-caption");
  important(host, {
    all: "initial", display: "block", position: "fixed", left: "0", right: "0", bottom: "0", height: `${STRIP_MIN}px`,
    "z-index": "2147483647", margin: "0", padding: "0", border: "0", contain: "strict",
    transform: reducedMotion() ? "none" : "translateY(100%)", transition: "transform 240ms cubic-bezier(.2,.8,.2,1), height 220ms cubic-bezier(.2,.8,.2,1)",
  });
  const root = host.attachShadow({ mode: "closed" });
  const frame = doc.createElement("iframe");
  frame.src = chrome.runtime.getURL(`caption.html?tabId=${tabId}`);
  frame.title = "Distill";
  // The on-device model (Prompt API) is a policy-controlled feature: a frame gets it only when its embedder delegates
  // it. Without this the caption could never translate on the device (round-1 spike, W4). A site that forbids it for
  // itself by header still blocks it; that case needs the offscreen document (docs/caption.md, risk 1).
  frame.allow = "language-model";
  important(frame, { display: "block", width: "100%", height: "100%", border: "0", margin: "0", "color-scheme": "normal" });
  root.append(frame);
  doc.documentElement.append(host);

  const spacer = doc.createElement("div");
  spacer.setAttribute(SPACER, "");
  important(spacer, { all: "initial", display: "block", height: `${STRIP_MIN}px` });
  doc.body?.append(spacer);

  const style = doc.createElement("style");
  style.setAttribute("data-distill", "caption");
  style.textContent = PAGE_CSS;
  (doc.head ?? doc.documentElement).append(style);

  doc.documentElement.setAttribute(OPEN, "");
  state = { tabId, host, frame, spacer, style, report: null, removed: new Map(), ctx: null, unwatch: () => undefined };
  // Slide in on the next frame, so the transition runs from below the window.
  requestAnimationFrame(() => requestAnimationFrame(() => host.style.setProperty("transform", "none", "important")));
}

/** Takes Distill off the page: every change goes back, and the strip goes. */
export function close(doc: Document): void {
  if (!state) return;
  state.unwatch();
  unwiden(doc);
  clearComfort(doc);
  clearCalm(doc);
  restick(doc);
  clearTranslation();
  for (const el of state.removed.values()) { el.removeAttribute(HIDE); el.removeAttribute(FADE); }
  doc.documentElement.removeAttribute(ORIGINAL);
  doc.documentElement.removeAttribute(UNLOCK);
  doc.documentElement.removeAttribute(OPEN);
  state.host.remove();
  state.spacer.remove();
  state.style.remove();
  state = null;
}

/** The strip's content height, clamped; the spacer follows so nothing ends up under the strip. */
export function resize(height: number, win: Window): number {
  if (!state) return 0;
  const h = Math.round(Math.max(STRIP_MIN, Math.min(height, win.innerHeight * STRIP_MAX_SHARE)));
  state.host.style.setProperty("height", `${h}px`, "important");
  state.spacer.style.setProperty("height", `${h}px`, "important");
  return h;
}

export function showOriginal(doc: Document, on: boolean): void {
  if (!state) return;
  doc.documentElement.toggleAttribute(ORIGINAL, on);
  originalShown(on);
}

/** True while the person looks at the untouched original (round-1 modules leave the page alone then). */
export const originalOn = (doc: Document): boolean => doc.documentElement.hasAttribute(ORIGINAL);

/** What the last Clean knew, for the round-1 modules the content script calls (translate, contact). */
export const context = (): CleanContext | null => state?.ctx ?? null;

/** Tells the caption frame that the report changed without being asked (Stay clean, #3). */
export function notifyFrame(report: CleanReport): void {
  if (!state) return;
  const msg: CaptionUpdate = { type: "distill:caption:update", tabId: state.tabId, report };
  try { void chrome.runtime.sendMessage(msg).catch(() => undefined); } catch { /* the extension went away */ }
}

/**
 * Stay clean (#3): judges what came into the page since the last Clean, hides new clutter, adds it to the report and
 * tells the frame. Returns whether anything new was hidden. STUB: owned by the round-1 builder W2, who fills this body.
 */
export async function recheck(doc: Document, win: Window): Promise<boolean> {
  void doc; void win;
  return false;
}

/** Whether a box takes space on screen right now. */
function shownOn(win: Window) {
  return (el: Element): boolean => {
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    if (cs.display === "contents") return true;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
}

/** What the page is for, beyond its text: the main video, a form someone came to fill. */
function contentExtras(doc: Document, win: Window): Element[] {
  const shown = shownOn(win);
  // The main video: a player shows a poster before it plays, so the video's own box can still be empty; its player is not.
  const wide = (el: Element | null, depth: number): boolean =>
    !!el && depth >= 0 && ((shown(el) && el.getBoundingClientRect().width >= 320) || wide(el.parentElement, depth - 1));
  // Protect the whole player (its controls and poster sit beside the <video>), not the <video> alone: climb while the
  // box stays about the video's size.
  const player = (v: Element): Element => {
    const vr = v.getBoundingClientRect();
    let box = v;
    for (let p = v.parentElement, i = 0; p && i < 5; p = p.parentElement, i++) {
      const r = p.getBoundingClientRect();
      if (vr.width > 0 && (r.width > vr.width * 1.15 || r.height > vr.height * 1.3)) break;
      box = p;
    }
    return box;
  };
  const videos = Array.from(doc.querySelectorAll("video")).filter((v) => wide(v, 3)).map(player);
  const forms = Array.from(doc.querySelectorAll("form")).filter((f) =>
    shown(f) && f.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea").length >= 3);
  return [...videos, ...forms];
}

function scrollLocked(doc: Document, win: Window): boolean {
  const locks = (el: Element | null) => !!el && /hidden|clip/.test(win.getComputedStyle(el).overflowY);
  return (locks(doc.documentElement) || locks(doc.body)) && doc.documentElement.scrollHeight > win.innerHeight + 8;
}

/** The first content element on screen, to keep the reader's place while boxes above it go. */
function anchorOf(keep: Element[], win: Window): { el: Element; top: number } | null {
  for (const el of keep) {
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < win.innerHeight) return { el, top: r.top };
  }
  return null;
}

/** Clean, once per page: hide what is not content, fading it out first (instantly under reduced motion). */
export async function clean(doc: Document, win: Window): Promise<CleanReport> {
  if (!state) throw new Error("Distill is not open on this page.");
  if (state.report) return current();
  cleaning ??= cleanOnce(doc, win).finally(() => { cleaning = null; });
  return cleaning;
}

async function cleanOnce(doc: Document, win: Window): Promise<CleanReport> {
  if (!state) throw new Error("Distill is not open on this page.");

  const keep: Element[] = [];
  const page: PageModel = extractPage(doc, win.location.href, { onSource: (_id, el) => keep.push(el) });
  const body = keep.filter((_el, i) => {
    const k = page.blocks[i]?.kind;
    return k === "paragraph" || k === "list" || k === "table" || k === "quote" || k === "code";
  });
  const removed = new Map<string, Element>();
  const protect = contentExtras(doc, win);
  const items: ClutterItem[] = findClutter(doc, {
    keep,
    protect,
    body,
    shown: shownOn(win),
    position: (el) => win.getComputedStyle(el).position,
    covers: (el) => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, win.innerWidth) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0));
      return (w * h) / (win.innerWidth * win.innerHeight);
    },
    onElement: (id, el) => removed.set(id, el),
  });
  const unlockedScroll = scrollLocked(doc, win);

  const anchor = win.scrollY > 0 ? anchorOf(keep, win) : null;
  if (!reducedMotion() && removed.size) {
    for (const el of removed.values()) el.setAttribute(FADE, "");
    await new Promise((r) => setTimeout(r, FADE_MS));
  }
  for (const [id, el] of removed) { el.setAttribute(HIDE, id); el.removeAttribute(FADE); }
  if (unlockedScroll) doc.documentElement.setAttribute(UNLOCK, "");
  // Keep the reader's place: what they were looking at stays where it was on screen.
  if (anchor?.el.isConnected) win.scrollBy({ top: anchor.el.getBoundingClientRect().top - anchor.top, behavior: "instant" });

  // The language: the page's own lang attribute, else its words (#2).
  let lang = page.lang;
  let langFrom: CleanReport["langFrom"] = lang === "und" ? "none" : "page";
  if (lang === "und") {
    // The running text first; an old site's "text" can be one phone line, so then the title and the whole page's text.
    let text = body.map((el) => el.textContent ?? "").join("\n").slice(0, 20_000);
    if ((text.match(/\p{L}/gu)?.length ?? 0) < 200) text = `${doc.title}\n${doc.body?.innerText ?? ""}`.slice(0, 20_000);
    const found = detectLang(text);
    if (found.lang !== "und") { lang = found.lang; langFrom = "text"; }
  }
  const base: CleanReport = { items, restored: [], lang, kind: page.kind, unlockedScroll, langFrom, widened: 0, comfort: 0, calm: { media: 0, motion: 0 }, unstuck: 0 };
  if (!state) return base; // closed meanwhile

  // Round 1 (spark universal-core): each module changes the page only through what it can take back.
  const main = body.length ? body.reduce<Element>((a, b) => commonAncestor(a, b), body[0] as Element) : null;
  const ctx: CleanContext = { doc, win, keep, body, main, protect, removed };
  state.ctx = ctx;
  state.removed = removed;
  state.report = {
    ...base,
    unstuck: unstick(ctx),
    widened: widen(ctx),
    comfort: applyComfort(ctx),
    calm: calmPage(ctx),
  };
  state.unwatch = watchForClutter(doc, win, () => { void recheck(doc, win); });
  return state.report;
}

/** The report as it stands, with what the person brought back. */
function current(): CleanReport {
  if (!state?.report) throw new Error("Nothing was removed on this page.");
  return { ...state.report, restored: restoredIds() };
}

function restoredIds(): string[] {
  if (!state) return [];
  return Array.from(state.removed).filter(([, el]) => !el.hasAttribute(HIDE)).map(([id]) => id);
}

/** Brings one removed item back (or all). It stays back for as long as the caption is open. */
export function restore(id: string): CleanReport {
  if (!state?.report) throw new Error("Nothing was removed on this page.");
  const els = id === "all" ? Array.from(state.removed.values()) : [state.removed.get(id)].filter((e): e is Element => !!e);
  if (!els.length) throw new Error("That part of the page is no longer there.");
  for (const el of els) el.removeAttribute(HIDE);
  return { ...state.report, restored: restoredIds() };
}
