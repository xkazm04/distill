// Spark universal-core round 2, card 7 (r2-07): where a link of the main text goes, shown on pointing at it (about
// 400 ms), on keyboard focus, or on a long press (about 500 ms) on a touch screen. Read from the link alone (engine
// describeLink): Distill makes no request, loads no picture or font for the note.
//
// The note is a small box near the link, in its own custom element with a closed shadow root (like the strip's host in
// page.ts): the page's CSS cannot reach it and the page's scripts cannot read it. It never takes a click from the page
// (pointer-events: none, except its one button), and it goes away on scroll, Escape, the pointer leaving, Original
// and close. Not on mailto:, tel:, javascript: or #anchor links, nor on links outside the main text.
import { describeLink, PROGRAM_FILE_TYPES, type LinkNote } from "@distill/engine";
import type { CleanContext } from "./context";

const ORIGINAL = "data-distill-original";
const HIDE = "data-distill-hide";
/** Pointing at a link this long shows its note (ms). */
export const HOVER_MS = 400;
/** A press on a touch screen this long shows the note (ms). */
export const PRESS_MS = 500;
/** The pointer may leave the link this long (on its way to the note's button) before the note goes (ms). */
const LEAVE_MS = 250;
/** A press that moves farther than this is a scroll, not a long press (px). */
const PRESS_SLOP = 10;
/** Room kept free at the bottom of the window for Distill's strip (px). */
const STRIP_ROOM = 64;

// The note sits on any page, light or dark, and the frame's theme roles cannot reach into the page. So it uses the
// browser's own system colours (Canvas, CanvasText, ButtonFace ...) with color-scheme: light dark: a neutral,
// high-contrast box that follows the person's light or dark setting, and forced-colours mode, with no colour of
// Distill's own. System fonts only: nothing is loaded.
const NOTE_CSS = `
:host { all: initial; }
.note { box-sizing: border-box; max-width: 300px; padding: 8px 10px; border: 1px solid GrayText; border-radius: 8px;
  background: Canvas; color: CanvasText; color-scheme: light dark; pointer-events: none;
  box-shadow: 0 2px 10px color-mix(in srgb, CanvasText 22%, transparent);
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: start; overflow-wrap: anywhere; }
.site { font-weight: 700; font-size: 14px; }
.line { margin-top: 2px; }
.warn { font-weight: 600; }
button { pointer-events: auto; margin-top: 6px; min-height: 28px; padding: 3px 10px; border: 1px solid ButtonBorder;
  border-radius: 6px; background: ButtonFace; color: ButtonText; font: inherit; cursor: pointer; }
button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
`;

interface State {
  doc: Document;
  win: Window;
  ctx: CleanContext;
  /** The person's switch in More. */
  on: boolean;
  host: HTMLElement | null;
  box: HTMLElement | null;
  /** The link whose note is up, or is about to come up. */
  link: HTMLAnchorElement | null;
  shown: boolean;
  showTimer: number;
  hideTimer: number;
  press: { x: number; y: number; timer: number } | null;
  /** A long press showed the note: the click the lift may send is not a click on the link. */
  swallowUntil: number;
  observer: MutationObserver | null;
  off: () => void;
}

let state: State | null = null;
/** The switch, kept when the notes start after it was set (and between Cleans of one page). */
let wanted = true;

/** The link of the main text that `target` is in, if any: never mailto, tel, javascript or an anchor (checked later). */
function linkOf(s: State, target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element) || target === s.host) return null;
  const a = target.closest("a[href]") as HTMLAnchorElement | null;
  if (!a || a.closest(`[${HIDE}]`) || a.closest("nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]")) return null;
  const { main, body } = s.ctx;
  const doc = s.doc;
  if (body.some((b) => b.contains(a))) return a;
  if (main && main !== doc.body && main !== doc.documentElement && main.contains(a)) return a;
  return null;
}

/** What the link is, or null when it needs no note. */
function noteFor(s: State, a: HTMLAnchorElement): LinkNote | null {
  const raw = (a.getAttribute("href") ?? "").trim();
  const note = describeLink(!raw || raw.startsWith("#") ? raw : a.href, s.win.location.href);
  return note.kind === "web" && note.site ? note : null;
}

/** The note's lines, as the person reads them. */
export function noteLines(note: LinkNote): { text: string; warn?: boolean }[] {
  const lines: { text: string; warn?: boolean }[] = [{ text: note.leaves ? "Leaves this site" : "On this site" }];
  if (note.unwrapped) lines.push({ text: `Goes through a redirect to ${note.site}` });
  if (note.fileType) {
    lines.push(PROGRAM_FILE_TYPES.has(note.fileType)
      ? { text: `${note.fileType} file: a program that runs on your device`, warn: true }
      : { text: `${note.fileType} file` });
  }
  if (note.tracking.length) {
    const shown = note.tracking.slice(0, 3).join(", ");
    lines.push({ text: `Tracking tags: ${shown}${note.tracking.length > 3 ? ` and ${note.tracking.length - 3} more` : ""}` });
  }
  return lines;
}

function ensureHost(s: State): HTMLElement {
  if (s.host?.isConnected && s.box) return s.box;
  const host = s.doc.createElement("distill-link-note");
  for (const [k, v] of Object.entries({
    all: "initial", position: "fixed", left: "0", top: "0", "z-index": "2147483646", display: "block", margin: "0", padding: "0",
    border: "0", "pointer-events": "none", visibility: "hidden",
  })) host.style.setProperty(k, v, "important");
  // E2E ONLY: the test build opens the shadow root so the hermetic e2e and the live probe can read the note and press
  // its button. Every other build (the one people install) keeps it closed. The MODE comparison is replaced at build.
  const root = host.attachShadow({ mode: import.meta.env.MODE === "e2e" ? "open" : "closed" });
  const style = s.doc.createElement("style");
  style.textContent = NOTE_CSS;
  const box = s.doc.createElement("div");
  box.className = "note";
  box.setAttribute("role", "tooltip");
  root.append(style, box);
  s.doc.documentElement.append(host);
  s.host = host;
  s.box = box;
  return box;
}

async function copy(s: State, text: string, button: HTMLButtonElement): Promise<void> {
  let ok = false;
  try {
    await s.win.navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // An older page context or no clipboard permission: the classic copy, from a field inside the note.
    const field = s.doc.createElement("textarea");
    field.value = text;
    field.style.setProperty("position", "fixed", "important");
    field.style.setProperty("opacity", "0", "important");
    button.after(field);
    field.select();
    try { ok = s.doc.execCommand("copy"); } catch { ok = false; }
    field.remove();
  }
  button.textContent = ok ? "Copied" : "Could not copy";
  s.win.clearTimeout(s.hideTimer);
  s.hideTimer = s.win.setTimeout(() => hide(), 1200);
}

function show(s: State, a: HTMLAnchorElement): void {
  if (!s.on || s.doc.documentElement.hasAttribute(ORIGINAL) || !a.isConnected) return;
  const note = noteFor(s, a);
  if (!note) return;
  const box = ensureHost(s);
  const host = s.host as HTMLElement;
  box.replaceChildren();
  const site = s.doc.createElement("div");
  site.className = "site";
  site.textContent = note.site;
  box.append(site);
  for (const l of noteLines(note)) {
    const line = s.doc.createElement("div");
    line.className = l.warn ? "line warn" : "line";
    line.textContent = l.text;
    box.append(line);
  }
  if (note.clean) {
    const button = s.doc.createElement("button");
    button.type = "button";
    button.textContent = "Copy clean link";
    button.title = note.clean;
    const clean = note.clean;
    button.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); void copy(s, clean, button); });
    box.append(button);
  }
  // Near the link: below it, or above when the strip or the window's end leaves no room below.
  host.style.setProperty("visibility", "hidden", "important");
  const rects = Array.from(a.getClientRects());
  const r = rects[0] ?? a.getBoundingClientRect();
  const last = rects[rects.length - 1] ?? r;
  const w = box.offsetWidth, h = box.offsetHeight;
  const vw = s.win.innerWidth, vh = s.win.innerHeight;
  let top = last.bottom + 6;
  if (top + h > vh - STRIP_ROOM) top = Math.max(4, r.top - 6 - h);
  const left = Math.max(8, Math.min(r.left, vw - w - 8));
  host.style.setProperty("left", `${Math.round(left)}px`, "important");
  host.style.setProperty("top", `${Math.round(top)}px`, "important");
  host.style.setProperty("visibility", "visible", "important");
  s.link = a;
  s.shown = true;
}

/** Takes the note down (it stays in the page, hidden, for the next one). */
function hide(): void {
  const s = state;
  if (!s) return;
  s.win.clearTimeout(s.showTimer);
  s.win.clearTimeout(s.hideTimer);
  if (s.press) { s.win.clearTimeout(s.press.timer); s.press = null; }
  s.host?.style.setProperty("visibility", "hidden", "important");
  s.box?.replaceChildren();
  s.link = null;
  s.shown = false;
}

/** Whether the note is up now, and what it says (the e2e and the live probe read it through the page). */
export function noteShown(): string | null {
  return state?.shown ? state.box?.textContent ?? "" : null;
}

function listen(s: State): () => void {
  const { doc, win } = s;
  const inNote = (t: EventTarget | null) => !!s.host && t === s.host;
  const later = (fn: () => void, ms: number) => win.setTimeout(fn, ms);

  const over = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (inNote(e.target)) { win.clearTimeout(s.hideTimer); return; }
    const a = linkOf(s, e.target);
    if (!a) return;
    win.clearTimeout(s.hideTimer);
    if (a === s.link) return;
    win.clearTimeout(s.showTimer);
    s.link = a;
    if (s.shown) { s.shown = false; s.host?.style.setProperty("visibility", "hidden", "important"); }
    s.showTimer = later(() => show(s, a), HOVER_MS);
  };
  const out = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    const to = e.relatedTarget;
    if (inNote(to)) return;
    const from = s.link;
    const leftLink = from && e.target instanceof Node && from.contains(e.target) && !(to instanceof Node && from.contains(to));
    if (!leftLink && !inNote(e.target)) return;
    win.clearTimeout(s.showTimer);
    win.clearTimeout(s.hideTimer);
    s.hideTimer = later(() => hide(), s.shown ? LEAVE_MS : 0);
  };
  const focusIn = (e: FocusEvent) => {
    if (inNote(e.target)) { win.clearTimeout(s.hideTimer); return; }
    const a = linkOf(s, e.target);
    // Keyboard focus only: a click focuses the link too, and the pointer has its own delay.
    if (!a || !a.matches(":focus-visible")) return;
    win.clearTimeout(s.showTimer);
    win.clearTimeout(s.hideTimer);
    show(s, a);
  };
  const focusOut = (e: FocusEvent) => {
    if (!s.shown || inNote(e.relatedTarget)) return;
    if (e.target === s.link || inNote(e.target)) { win.clearTimeout(s.hideTimer); s.hideTimer = later(() => hide(), 150); }
  };
  const down = (e: PointerEvent) => {
    if (inNote(e.target)) return;
    if (s.shown) hide();
    if (e.pointerType !== "touch") return;
    const a = linkOf(s, e.target);
    if (!a) return;
    const timer = later(() => {
      s.press = null;
      show(s, a);
      if (s.shown) s.swallowUntil = Date.now() + 800;
    }, PRESS_MS);
    s.press = { x: e.clientX, y: e.clientY, timer };
  };
  const move = (e: PointerEvent) => {
    if (s.press && Math.hypot(e.clientX - s.press.x, e.clientY - s.press.y) > PRESS_SLOP) { win.clearTimeout(s.press.timer); s.press = null; }
  };
  const up = () => { if (s.press) { win.clearTimeout(s.press.timer); s.press = null; } };
  // The lift after a long press that showed the note is not a click on the link.
  const click = (e: MouseEvent) => {
    if (Date.now() < s.swallowUntil && linkOf(s, e.target) === s.link) { e.preventDefault(); e.stopPropagation(); }
    s.swallowUntil = 0;
  };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape" && s.shown) hide(); };
  const gone = () => { if (s.shown || s.link) hide(); };

  const opts = { capture: true, passive: true } as const;
  doc.addEventListener("pointerover", over, opts);
  doc.addEventListener("pointerout", out, opts);
  doc.addEventListener("focusin", focusIn, true);
  doc.addEventListener("focusout", focusOut, true);
  doc.addEventListener("pointerdown", down, opts);
  doc.addEventListener("pointermove", move, opts);
  doc.addEventListener("pointerup", up, opts);
  doc.addEventListener("pointercancel", up, opts);
  doc.addEventListener("click", click, true);
  doc.addEventListener("keydown", key, true);
  doc.addEventListener("scroll", gone, opts);
  win.addEventListener("resize", gone);
  win.addEventListener("blur", gone);
  return () => {
    doc.removeEventListener("pointerover", over, opts);
    doc.removeEventListener("pointerout", out, opts);
    doc.removeEventListener("focusin", focusIn, true);
    doc.removeEventListener("focusout", focusOut, true);
    doc.removeEventListener("pointerdown", down, opts);
    doc.removeEventListener("pointermove", move, opts);
    doc.removeEventListener("pointerup", up, opts);
    doc.removeEventListener("pointercancel", up, opts);
    doc.removeEventListener("click", click, true);
    doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("scroll", gone, opts);
    win.removeEventListener("resize", gone);
    win.removeEventListener("blur", gone);
  };
}

/** Starts the link notes for the main text. Called again (Stay clean read the page again), it follows the new main
 *  text and keeps the person's switch. */
export function linkNotes(ctx: CleanContext): void {
  if (state && state.doc === ctx.doc) { state.ctx = ctx; return; }
  if (state) clearLinks(state.doc);
  const s: State = {
    doc: ctx.doc, win: ctx.win, ctx, on: wanted, host: null, box: null, link: null, shown: false, showTimer: 0, hideTimer: 0,
    press: null, swallowUntil: 0, observer: null, off: () => undefined,
  };
  s.off = listen(s);
  // Original shows the untouched page: the note goes with it.
  if (typeof MutationObserver === "function") {
    s.observer = new MutationObserver(() => { if (ctx.doc.documentElement.hasAttribute(ORIGINAL)) hide(); });
    s.observer.observe(ctx.doc.documentElement, { attributes: true, attributeFilter: [ORIGINAL] });
  }
  state = s;
}

/** The switch in More. */
export function setLinks(_doc: Document, on: boolean): void {
  wanted = on;
  if (!state) return;
  state.on = on;
  if (!on) hide();
}

/** Takes the notes and their listeners off (close). */
export function clearLinks(doc: Document): void {
  if (state) {
    hide();
    state.off();
    state.observer?.disconnect();
    state.host?.remove();
    state = null;
  }
  doc.querySelectorAll("distill-link-note").forEach((n) => n.remove());
  wanted = true;
}
