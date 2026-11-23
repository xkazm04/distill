// The caption's page side, in the content script: the strip's place on the page (a fixed box at the bottom holding the
// caption frame, an extension page), and what Distill changes in the page itself (Clean, Original). Everything here is
// reversible: closing the caption puts the page back exactly as it was. Nothing read here leaves the page except the
// CleanReport (kinds and labels, no page text). See docs/caption.md.
import { cssLabel, detectLang, extractPage, findClutter, type ClutterItem, type ClutterOptions, type PageModel } from "@distill/engine";
import type { CaptionUpdate, CleanReport } from "../messages";
import { calmCounts, calmMore, calmPage, calmProtect, clearCalm } from "./calm";
import { applyComfort, clearComfort, comfortOff } from "./comfort";
import { commonAncestor, type CleanContext } from "./context";
import { restick, unstick } from "./float";
import { layoutOf, type Layout } from "./layout";
import { unwiden, widen } from "./reflow";
import { clearTranslation, originalShown } from "./translate";
import { inUse, sincePress, spent, watchForClutter } from "./watch";
import { clearClaims } from "./claims";
import { clearActions } from "./actions";
import { clearTables, readableTables, remeasureTables } from "./tables";
import { clearTerms } from "./terms";
import { clearLinks, linkNotes } from "./links";
import { clearConsent, consentAfterClean, loadConsentPrefs, setConsent } from "./consent";
import { clearDark } from "./dark";

/** The consent switch for this site as Clean read it (r3-04): late banners are answered only while it is on. */
let consentOn = false;
/** What Clean hid as a cookie notice. */
const cookieBanners = (items: readonly ClutterItem[], removed: ReadonlyMap<string, Element>): Element[] =>
  items.filter((it) => it.kind === "cookie").map((it) => removed.get(it.id)).filter((el): el is Element => !!el);

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
/** r4-02: a page that took this long to read (ms) had the person wait already: what Clean hides fades faster. */
const BUSY_READ_MS = 100;
const FADE_BUSY_MS = 90;

const PAGE_CSS = `
html:not([${ORIGINAL}]) [${HIDE}] { display: none !important; }
html:not([${ORIGINAL}]) [${FADE}] { opacity: 0 !important; transition: opacity ${FADE_MS}ms ease-out !important; }
html:not([${ORIGINAL}]) [${FADE}="busy"] { transition-duration: ${FADE_BUSY_MS}ms !important; }
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
  /** The address the context was read at: another one is a single-page app's next view. */
  href: string;
  /** Stay clean changed the page and what depends on its layout has not followed yet (follow). */
  stale: boolean;
}

let state: State | null = null;

/**
 * r4-02: the reads the strip makes once Clean answered, which add to it later (the main text for claims and the gist,
 * the byline, what the page asks of you, prices and dates in your terms). On YouTube they hold the page's thread for
 * 250-300 ms together, and they all arrived at once, right while the strip appeared: the page stuttered then. Now each
 * waits for Clean to have answered, then takes its own turn in the page's idle time, one per idle period (at most
 * IDLE_WAIT_MS each), so the page and the strip can draw between them.
 */
let sight: { win: Window; drawn: Promise<void>; done: () => void; queue: Promise<void>; pending: number; at: number } | null = null;
const IDLE_WAIT_MS = 500;
/** Once first sight is this long past (ms) and no turn waits, a read (Ask's, a switch in More) runs at once. */
const SIGHT_PAST_MS = 2000;
const idle = (win: Window): Promise<void> => new Promise((r) => {
  if (typeof win.requestIdleCallback === "function") win.requestIdleCallback(() => r(), { timeout: IDLE_WAIT_MS });
  else win.setTimeout(r, 0);
});
function newSight(win: Window): NonNullable<typeof sight> {
  const s = { win, drawn: Promise.resolve(), done: () => undefined as void, queue: Promise.resolve(), pending: 0, at: 0 };
  s.drawn = new Promise<void>((r) => { s.done = () => { if (!s.at) s.at = Date.now(); r(); }; });
  s.queue = s.drawn;
  return s;
}
/** Resolves on this caller's idle turn after Clean answered (at once while Distill is not on the page, or long after
 *  first sight). The caller's work runs right after, before the next turn is asked for. */
export function afterFirstSight(): Promise<void> {
  const s = sight;
  if (!s || (s.at && !s.pending && Date.now() - s.at > SIGHT_PAST_MS)) return Promise.resolve();
  s.pending++;
  const turn = s.queue.then(() => (sight === s ? idle(s.win) : undefined)).finally(() => { s.pending--; });
  s.queue = turn;
  return turn;
}
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
  state = { tabId, host, frame, spacer, style, report: null, removed: new Map(), ctx: null, unwatch: () => undefined, href: "", stale: false };
  sight = newSight(doc.defaultView ?? window);
  // Clean starts now, while the strip's frame loads, instead of when the frame asks for it: the frame's request then
  // gets the running (or finished) Clean. Measured on the live sites (round-1 gaps, GB): Deník 1.8 -> 1.0 s and YouTube
  // 2.4 -> 1.6 s from the click to the first-sight line.
  // r4-02: but one frame later, once the strip's slide-in has started. Reading a large page holds the page's thread
  // for 150-400 ms (YouTube), and a transition starts only when a frame is drawn: started first, the slide runs on the
  // compositor while the page is judged and is over before the line shows, instead of starting after the reading.
  const win = doc.defaultView;
  const start = () => { if (win && state?.host === host) void clean(doc, win).catch(() => undefined); };
  // No slide under reduced motion; no frame drawn in a tab in the background (a remembered site opening by itself).
  if (reducedMotion() || doc.visibilityState === "hidden") { host.style.setProperty("transform", "none", "important"); start(); return; }
  // The box's style from below the window, read now, so the change to "none" is a transition and not a jump.
  void getComputedStyle(host).transform;
  host.style.setProperty("transform", "none", "important");
  requestAnimationFrame(() => setTimeout(start, 0));
}

/** Takes Distill off the page: every change goes back, and the strip goes. */
export function close(doc: Document): void {
  if (!state) return;
  state.unwatch();
  unwiden(doc);
  clearComfort(doc);
  clearCalm(doc);
  restick(doc);
  clearTerms(doc); // r3-07: before the translation goes, so its text nodes are whole again
  clearTranslation();
  clearClaims(doc);
  clearActions(doc);
  clearTables(doc);
  clearLinks(doc);
  clearDark(doc);
  clearConsent();
  for (const el of state.removed.values()) { el.removeAttribute(HIDE); el.removeAttribute(FADE); }
  doc.documentElement.removeAttribute(ORIGINAL);
  doc.documentElement.removeAttribute(UNLOCK);
  doc.documentElement.removeAttribute(OPEN);
  state.host.remove();
  state.spacer.remove();
  state.style.remove();
  state = null;
  sight?.done();
  sight = null;
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
 * tells the frame. Returns whether anything new was hidden. Judging runs before the first await (watch.ts times it).
 */
export async function recheck(doc: Document, win: Window): Promise<boolean> {
  if (!state?.report || !state.ctx || originalOn(doc)) return false;
  // One at a time: a call while one fades its finds in runs once more after it.
  if (rechecking) { recheckAgain = true; return false; }
  rechecking = true;
  try {
    let hid = false;
    do {
      recheckAgain = false;
      hid = (await recheckOnce(doc, win)) || hid;
    } while (recheckAgain && state && !originalOn(doc));
    return hid;
  } finally {
    rechecking = false;
  }
}

let rechecking = false;
let recheckAgain = false;
/** Boxes that showed up just after the person pressed something (a menu they opened): never hidden by Stay clean. */
const spared = new WeakSet<Element>();
/** A box that appears this soon after the person clicked is theirs, not the page's (ms). */
const PRESS_MS = 3000;
/** What a click opens: a menu, a dialog, a panel. Never an advert, a cookie notice or a sign-up. */
const OPENED_BY_PERSON = new Set<ClutterItem["kind"]>(["menu", "popup", "header", "sidebar", "footer", "other"]);
/** The address at the last judgement: a click that changed it went to another view, not to a menu. */
let lastHref = "";

/** findClutter's options as Clean and Stay clean both use them: what is on screen and where comes from the browser,
 *  each element's style and box read once per judgement (layout.ts). */
function clutterOptions(win: Window, keep: readonly Element[], body: readonly Element[], protect: readonly Element[],
  onElement: (id: string, el: Element) => void): ClutterOptions {
  const look = layoutOf(win);
  return {
    keep,
    protect,
    body,
    shown: shownOn(win, look),
    position: (el) => look.style(el).position,
    rendered: (el) => look.style(el).display !== "none",
    covers: (el) => {
      const r = look.rect(el);
      const w = Math.max(0, Math.min(r.right, win.innerWidth) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0));
      return (w * h) / (win.innerWidth * win.innerHeight);
    },
    box: (el) => {
      const r = look.rect(el);
      return { left: r.left, top: r.top, width: r.width, height: r.height, winWidth: win.innerWidth, winHeight: win.innerHeight };
    },
    // The words CSS draws in the box (an empty ad slot's "REKLAMA"), asked only of boxes with no words of their own.
    label: (el) => `${cssLabel(win.getComputedStyle(el, "::before").content)} ${cssLabel(win.getComputedStyle(el, "::after").content)}`.trim(),
    onElement,
  };
}

/** What Clean knows, read again from the page as it is now (a single-page app showed another page). What Clean hid is
 *  not read as content. */
function readContext(doc: Document, win: Window, removed: Map<string, Element>): CleanContext {
  const read: Element[] = [];
  const page = extractPage(doc, win.location.href, { onSource: (_id, el) => read.push(el) });
  const kinds = page.blocks.map((b) => b.kind);
  const visible = (el: Element) => !el.closest(`[${HIDE}]`);
  const keep = read.filter(visible);
  const body = read.filter((el, i) => visible(el) && ["paragraph", "list", "table", "quote", "code"].includes(kinds[i] ?? ""));
  const main = body.length ? body.reduce<Element>((a, b) => commonAncestor(a, b), body[0] as Element) : null;
  return { doc, win, keep, body, main, protect: contentExtras(doc, win, main), removed };
}

async function recheckOnce(doc: Document, win: Window): Promise<boolean> {
  const s = state;
  if (!s?.report || !s.ctx) return false;
  // The page as it is now: new text (a lazy paragraph, the advert's own words, a single-page app's next view) is read as
  // content, so what holds it is judged as Clean judges it. What Clean knew stays known while it is on the page (the
  // text inside boxes it hid, the main video), so the main column never shrinks and Clean's own judgement holds; after
  // a single-page app replaced the old text, only the new one counts.
  const before = s.ctx;
  const read = readContext(doc, win, s.removed);
  const union = (old: readonly Element[], now: readonly Element[]) => [...new Set([...old.filter((e) => e.isConnected), ...now])];
  const body = union(before.body, read.body);
  const main = body.length ? body.reduce<Element>((a, b) => commonAncestor(a, b), body[0] as Element) : null;
  const ctx: CleanContext = { ...read, keep: union(before.keep, read.keep), body, main, protect: union(before.protect, read.protect) };
  s.ctx = ctx;
  calmProtect(ctx.protect);
  // A single-page app's next view: another address, another main column, or the old text gone.
  if (win.location.href !== s.href || ctx.main !== before.main || before.body.some((e) => !e.isConnected)) s.stale = true;
  s.href = win.location.href;

  const found = new Map<string, Element>();
  const items = findClutter(doc, clutterOptions(win, ctx.keep, ctx.body, ctx.protect, (id, el) => found.set(id, el)));
  const known = Array.from(s.removed.values());
  // Right after the person clicked something, a box that came up is theirs (a menu they opened), unless the click went
  // to another page of a single-page app, or the box names itself (an advert is never the person's doing).
  const href = win.location.href;
  const justPressed = sincePress() < PRESS_MS && href === lastHref;
  lastHref = href;
  const fresh: { item: ClutterItem; el: Element }[] = [];
  for (const it of items) {
    const el = found.get(it.id);
    if (!el || spared.has(el) || el.hasAttribute(HIDE) || el.closest(`[${HIDE}]`) || el.hasAttribute(SPACER) || el.hasAttribute("data-distill-unstick")) continue;
    // Never what the person brought back, or anything holding it; never what they are using.
    if (known.some((k) => k === el || k.contains(el) || el.contains(k))) continue;
    if (justPressed && OPENED_BY_PERSON.has(it.kind)) { spared.add(el); continue; }
    if (inUse(el)) continue;
    fresh.push({ item: it, el });
  }

  const calm = calmCounts();
  const calmChanged = calm.media !== s.report.calm.media || calm.motion !== s.report.calm.motion;
  if (!fresh.length) {
    if (s.stale) { follow(s, ctx); notifyFrame(current()); }
    else if (calmChanged) { s.report = { ...s.report, calm }; notifyFrame(current()); }
    return false;
  }

  // New ids after the highest so far ("c<n>"): an id once given never names anything else.
  let next = 1 + Math.max(-1, ...s.report.items.map((i) => Number(i.id.slice(1))).filter(Number.isFinite));
  const added: ClutterItem[] = fresh.map(({ item, el }) => {
    const id = `c${next++}`;
    s.removed.set(id, el);
    return { ...item, id };
  });
  const els = fresh.map((f) => f.el);
  const anchor = win.scrollY > 0 ? anchorOf([...ctx.keep], win) : null;
  const html = doc.documentElement;
  // A late cookie wall locks the page's scroll like an early one.
  const locked = !html.hasAttribute(UNLOCK) && scrollLocked(doc, win);
  if (!reducedMotion()) {
    for (const el of els) el.setAttribute(FADE, "");
    await new Promise((r) => setTimeout(r, FADE_MS));
  }
  if (state !== s || !s.report) return false; // closed meanwhile: close() took the marks back
  for (const [i, el] of els.entries()) { el.setAttribute(HIDE, added[i]?.id ?? ""); el.removeAttribute(FADE); }
  if (locked) html.setAttribute(UNLOCK, "");
  if (anchor?.el.isConnected) win.scrollBy({ top: anchor.el.getBoundingClientRect().top - anchor.top, behavior: "instant" });
  s.report = { ...s.report, items: [...s.report.items, ...added], unlockedScroll: s.report.unlockedScroll || locked, calm: calmCounts() };
  // A cookie banner that came late (r3-04) is answered like an early one, still at most once per page load.
  if (consentOn && s.report.consent !== "rejected" && added.some((it) => it.kind === "cookie")) {
    s.report = { ...s.report, consent: setConsent(doc, true, cookieBanners(s.report.items, s.removed)) };
  }
  s.stale = true;
  follow(s, ctx);
  notifyFrame(current());
  return true;
}

/**
 * Stay clean changed the page (#3): new items went, or a single-page app showed its next view. What Clean did from the
 * page's layout and text follows: the column grows into a hole a late sidebar advert left (#1), tall headers scroll
 * (#4), the reading layer covers the new text (#6, the person's switch kept), new moving parts stop (#8, never media
 * the person played), new data tables become readable and link notes follow the new main text (r2-05, r2-07). While
 * the original is shown it waits for the next look (Back to Distill brings one).
 */
function follow(s: State, ctx: CleanContext): void {
  if (!s.report || originalOn(ctx.doc)) return;
  s.stale = false;
  const t0 = performance.now();
  s.report = { ...s.report, unstuck: unstick(ctx), widened: widen(ctx), comfort: applyComfort(ctx), calm: calmMore(ctx), tables: readableTables(ctx) };
  linkNotes(ctx);
  spent(performance.now() - t0);
}

/** Whether a box takes space on screen right now. `look`: one judgement's reading of the layout, shared with its other
 *  questions (a fresh one by default). */
function shownOn(win: Window, look: Layout = layoutOf(win)) {
  return (el: Element): boolean => {
    const cs = look.style(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    if (cs.display === "contents") return true;
    const r = look.rect(el);
    return r.width >= 2 && r.height >= 2;
  };
}

/** What the page is for, beyond its text: the main video, a form someone came to fill. `main`: the main column. */
function contentExtras(doc: Document, win: Window, main: Element | null): Element[] {
  const shown = shownOn(win);
  // The column and what sits beside it, unless that is the whole page.
  const around = main?.parentElement && main.parentElement !== doc.body && main.parentElement !== doc.documentElement ? main.parentElement : null;
  const video = mainVideo(doc, win, shown, main, around);
  const fields = (f: Element) =>
    Array.from(f.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea"));
  const forms = Array.from(doc.querySelectorAll("form")).filter((f) => {
    if (!shown(f)) return false;
    const all = fields(f);
    if (all.length >= 3) return true; // a form someone came to fill, wherever it is
    // A small form of the article itself (a comment or a question to the editors): inside the main column, or right
    // after it beside nothing else. Never a search box, a login or a sign-up that names itself.
    if (!main || !all.some(shown)) return false;
    const inside = main.contains(f);
    const after = !inside && !!around?.contains(f) && !!(main.compareDocumentPosition(f) & 4 /* f follows main */);
    if (!inside && !after) return false;
    return !searchOrLogin(f, all.filter(shown)) && !selfNamed(f, inside ? main : around as Element);
  });
  return [...(video ? [video] : []), ...forms];
}

/**
 * The page's main video, the one it is for: of the videos with a player 320 px wide or more, the largest that is in the
 * first screen or in or beside the main column (a video page's player is both). Other videos are not protected: a
 * second one that plays by itself is Calm's to pause, and one that sits in the text is kept by Clean as content anyway.
 */
function mainVideo(doc: Document, win: Window, shown: (el: Element) => boolean, main: Element | null, around: Element | null): Element | null {
  // A player shows a poster before it plays, so the video's own box can still be empty; its player is not.
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
  let best: Element | null = null;
  let bestArea = 0;
  for (const v of Array.from(doc.querySelectorAll("video"))) {
    if (!wide(v, 3)) continue;
    const box = player(v);
    const r = box.getBoundingClientRect();
    const firstScreen = r.top + win.scrollY < win.innerHeight && r.bottom + win.scrollY > 0;
    const column = !!main && (main.contains(box) || box.contains(main) || !!around?.contains(box));
    if (!firstScreen && !column) continue;
    const area = r.width * r.height;
    if (area > bestArea) { best = box; bestArea = area; }
  }
  return best;
}

/** A search box (one field of type search or named q/s/search/query, or a search landmark) or a login (a password). */
function searchOrLogin(form: Element, shownFields: Element[]): boolean {
  if (form.querySelector("input[type=password]")) return true;
  if (form.closest("[role=search], search")) return true;
  if (shownFields.length !== 1) return false;
  const f = shownFields[0] as HTMLInputElement;
  return f.type === "search" || /^(q|s|search|query)$/i.test(f.name);
}

/** Names Clean takes out even from the main column (engine clutter.ts, its STRONG kinds): a form that is, or sits in, a
 *  sign-up, an advert or a share box is that box's, not the article's. */
const SELF_NAMED = /^(newsletters?|subscribe|subscription|odber|signup|ads?|adv|advert|adverts|advertisement|sponsored|reklamy?|related|recommended|share|sharing|social|cookies?|consent|gdpr)$/;
/** A discussion: a comment form inside one is protected only by being the discussion's (protecting it would keep the
 *  whole thread); a form that only calls itself "comment" is the article's own (a remark to the editors). */
const DISCUSSION = /^(comments?|discussion|diskuse|diskuze|disqus|replies)$/;
const SIGN_UP_WORDS = /(?<!\p{L})(newsletter|odeb[ií]rat|k odb[eě]ru|subscribe)(?!\p{L})/iu;

/** The form, or a box around it below `bound`, names itself as something Clean takes out (a newsletter sign-up, an
 *  advert, a discussion around it), by its class or id, its role, or its words (a sign-up says so in a few words). */
function selfNamed(form: Element, bound: Element): boolean {
  for (let el: Element | null = form; el && el !== bound; el = el.parentElement) {
    const words = `${el.getAttribute("class") ?? ""} ${el.id}`.toLowerCase().split(/[^a-z0-9]+/);
    if (words.some((w) => SELF_NAMED.test(w) || (el !== form && DISCUSSION.test(w)))) return true;
    if (/^(footer|aside|nav)$/.test(el.localName) || /^(contentinfo|complementary|navigation)$/.test(el.getAttribute("role") ?? "")) return true;
    const text = el.textContent ?? "";
    if (text.length < 600 && SIGN_UP_WORDS.test(text)) return true;
  }
  return false;
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
  // A Clean still running (its consent step reads the device's switch) answers with its finished report.
  if (cleaning) return cleaning;
  if (state.report) return current();
  cleaning ??= cleanOnce(doc, win).finally(() => { cleaning = null; sight?.done(); });
  return cleaning;
}

/** What Clean reads and decides before it changes anything: the main text's elements, what it would hide, and the
 *  page's language (its lang attribute, else its words, #2). Clean uses it; so does the proof page (r3-03), which runs
 *  the page tasks on saved copies of real pages without a strip. */
export interface CleanReading {
  page: PageModel;
  keep: Element[];
  body: Element[];
  main: Element | null;
  protect: Element[];
  items: ClutterItem[];
  removed: Map<string, Element>;
  lang: string;
  langFrom: CleanReport["langFrom"];
}

export function readForClean(doc: Document, win: Window): CleanReading {
  const keep: Element[] = [];
  const page: PageModel = extractPage(doc, win.location.href, { onSource: (_id, el) => keep.push(el) });
  const body = keep.filter((_el, i) => {
    const k = page.blocks[i]?.kind;
    return k === "paragraph" || k === "list" || k === "table" || k === "quote" || k === "code";
  });
  const removed = new Map<string, Element>();
  const main = body.length ? body.reduce<Element>((a, b) => commonAncestor(a, b), body[0] as Element) : null;
  const protect = contentExtras(doc, win, main);
  const items: ClutterItem[] = findClutter(doc, clutterOptions(win, keep, body, protect, (id, el) => removed.set(id, el)));

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
  return { page, keep, body, main, protect, items, removed, lang, langFrom };
}

/** Marks what Clean hides, the way Clean does (the attribute every page task skips). */
export function hideRemoved(removed: ReadonlyMap<string, Element>): void {
  for (const [id, el] of removed) { el.setAttribute(HIDE, id); el.removeAttribute(FADE); }
}

async function cleanOnce(doc: Document, win: Window): Promise<CleanReport> {
  if (!state) throw new Error("Distill is not open on this page.");
  // r4-02: the consent switch is read from the device's storage while the page is judged, not after it was cleaned.
  const prefs = loadConsentPrefs();

  const t0 = performance.now();
  const { page, keep, body, main, protect, items, removed, lang, langFrom } = readForClean(doc, win);
  const busy = performance.now() - t0 >= BUSY_READ_MS;
  const unlockedScroll = scrollLocked(doc, win);

  const anchor = win.scrollY > 0 ? anchorOf(keep, win) : null;
  if (!reducedMotion() && removed.size) {
    for (const el of removed.values()) el.setAttribute(FADE, busy ? "busy" : "");
    await new Promise((r) => setTimeout(r, busy ? FADE_BUSY_MS : FADE_MS));
  }
  hideRemoved(removed);
  if (unlockedScroll) doc.documentElement.setAttribute(UNLOCK, "");
  // Keep the reader's place: what they were looking at stays where it was on screen.
  if (anchor?.el.isConnected) win.scrollBy({ top: anchor.el.getBoundingClientRect().top - anchor.top, behavior: "instant" });

  const base: CleanReport = { items, restored: [], lang, kind: page.kind, unlockedScroll, langFrom, widened: 0, comfort: 0, calm: { media: 0, motion: 0 }, unstuck: 0, tables: 0 };
  if (!state) return base; // closed meanwhile

  // Round 1 (spark universal-core): each module changes the page only through what it can take back.
  const ctx: CleanContext = { doc, win, keep, body, main, protect, removed };
  state.ctx = ctx;
  state.removed = removed;
  state.href = win.location.href;
  state.report = {
    ...base,
    unstuck: unstick(ctx),
    widened: widen(ctx),
    comfort: applyComfort(ctx),
    calm: calmPage(ctx),
    tables: readableTables(ctx),
  };
  linkNotes(ctx);
  // r3-04: after Clean, in the top frame, once per page load: a cookie banner's reject button pressed (never Accept).
  const s = state;
  const answered = await consentAfterClean(doc, cookieBanners(items, removed), prefs);
  if (state !== s || !s.report) return base; // closed meanwhile
  consentOn = answered.on;
  s.report = { ...s.report, consent: answered.outcome };
  s.unwatch = watchForClutter(doc, win, () => { void recheck(doc, win); });
  return s.report;
}

/** The report as it stands, with what the person brought back, what Calm holds right now, and the reading layer as
 *  the person's switch has it (0 while off, as the switch itself answers). */
function current(): CleanReport {
  if (!state?.report) throw new Error("Nothing was removed on this page.");
  const doc = state.host.ownerDocument;
  return { ...state.report, restored: restoredIds(), calm: calmCounts(), comfort: comfortOff(doc) ? 0 : state.report.comfort };
}

/** Play again (#8) let everything move: the report says so at once, so a Show clicked right after reads 0/0. */
export function recount(): void {
  if (state?.report) state.report = { ...state.report, calm: calmCounts() };
}

function restoredIds(): string[] {
  if (!state) return [];
  return Array.from(state.removed).filter(([, el]) => !el.hasAttribute(HIDE)).map(([id]) => id);
}

/** Brings one removed item back (or all). It stays back for as long as the caption is open. A tall header that comes
 *  back scrolls with the page, like the ones Clean left (#4). */
export function restore(id: string): CleanReport {
  if (!state?.report) throw new Error("Nothing was removed on this page.");
  const els = id === "all" ? Array.from(state.removed.values()) : [state.removed.get(id)].filter((e): e is Element => !!e);
  if (!els.length) throw new Error("That part of the page is no longer there.");
  const back = els.filter((el) => el.hasAttribute(HIDE));
  for (const el of els) el.removeAttribute(HIDE);
  const ctx = state.ctx;
  if (ctx && back.some((el) => floats(el, ctx.win))) {
    state.report = { ...state.report, unstuck: unstick(ctx) };
    // A header that sticks again: a table's header row sticks below it, not under it (r2-05).
    remeasureTables();
  }
  return current();
}

/** The element or something in it is fixed or sticky (a header bar, a menu that follows the page). */
function floats(el: Element, win: Window): boolean {
  const walker = el.ownerDocument.createTreeWalker(el, 1 /* NodeFilter.SHOW_ELEMENT */);
  for (let n: Node | null = el; n; n = walker.nextNode()) {
    const p = win.getComputedStyle(n as Element).position;
    if (p === "fixed" || p === "sticky") return true;
  }
  return false;
}
