// Round 4, card 5 (r4-05): explain this word. Selecting a word or a few words (up to TERM_MAX characters) in the main
// text shows a small Explain button beside them: a note in its own custom element with a closed shadow root, like the
// link notes (links.ts), out of the page's CSS and scripts. Pressing it:
//  - an abbreviation the page spells out itself ("osoba samostatně výdělečně činná (OSVČ)", "OSVČ (osoba ...)") is
//    explained from the page, with no AI (engine spelledOut); the note says "From this page";
//  - otherwise this tab's caption frame is asked (CaptionExplainAsk: the words and their sentence, inside the browser
//    only). It runs the on-device model (explainTerm, values: never the cloud) and answers with
//    distill:caption:explainShow, shown here with "On this device", or why it could not ("refused").
// Esc closes the note, and so does a press anywhere else, Original and close. Never in a form field, never outside the
// main text. The keyboard reaches it: Tab while the button is up moves to it, Esc or Shift+Tab leaves it.
import { cleanTerm, spelledOut, TERM_MAX } from "@distill/engine";
import type { CaptionExplainAsk } from "../messages";
import type { CleanContext } from "./context";
import { NOTE_CSS as BASE_NOTE_CSS } from "./marks";

const ORIGINAL = "data-distill-original";
const HIDE = "data-distill-hide";
/** The note's element (also what the e2e and the live probe look for). */
export const NOTE_TAG = "distill-explain-note";
/** The selection must rest this long before the button comes (ms): a drag in progress shows nothing. */
export const SETTLE_MS = 250;
/** No answer from the strip in this long: the note says so (ms). The first on-device run can take a while. */
const ANSWER_MS = 60_000;
/** Room kept free at the bottom of the window for Distill's strip (px). */
const STRIP_ROOM = 64;
/** The sentence sent with the words is cut here (the prompt cuts at 600 as well). */
const SENTENCE_MAX = 600;
/** The page's words searched for a spelled-out abbreviation beyond the main text are cut here (characters). */
const PAGE_WORDS_MAX = 300_000;
/** Where a selection is never explained: a form field, Distill's own parts, what Clean hid. */
const NOT_HERE = `input, textarea, select, option, button, [contenteditable]:not([contenteditable=false]), distill-caption, distill-link-note, ${NOTE_TAG}, [${HIDE}]`;

export type ExplainSource = "page" | "on_device" | "refused";
type Phase = "offer" | "asking" | "shown";

// The one note shape of caption/marks.ts (r5-07, shared with the link notes): system colours only, so the note sits on
// any page and follows the person's light or dark setting and forced colours, with no colour of Distill's own. System
// fonts only: nothing is loaded. The offer (its one Explain button) is the same box, tighter.
const NOTE_CSS = `${BASE_NOTE_CSS}
.note:not(.open) { padding: 4px; }
.note.open { pointer-events: auto; }
.foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.busy { opacity: .8; }
.foot button { margin-inline-start: auto; }
`;

const SOURCE_WORDS: Record<ExplainSource, string> = {
  page: "From this page",
  on_device: "On this device",
  refused: "Not explained",
};

interface State {
  doc: Document;
  win: Window;
  ctx: CleanContext;
  tabId: number;
  host: HTMLElement | null;
  box: HTMLElement | null;
  phase: Phase | null;
  /** The ask now in the note: a late answer to an older one is dropped. */
  id: string;
  term: string;
  sentence: string;
  /** Where the words are: the note follows them on scroll. */
  range: Range | null;
  /** The person moved on from this selection with Tab: Tab is not taken again until the selection changes. */
  passed: string;
  settleTimer: number;
  answerTimer: number;
  frame: number;
  observer: MutationObserver | null;
  off: () => void;
}

let state: State | null = null;
let counter = 0;

/** The main text holds `node` (never what Clean hid, a form field or Distill's own parts). */
function inMainText(s: State, node: Node | null): Element | null {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  if (!el || el.closest(NOT_HERE)) return null;
  const { main, body } = s.ctx;
  const block = body.find((b) => b.contains(el));
  if (block) return block;
  if (main && main !== s.doc.body && main !== s.doc.documentElement && main.contains(el)) {
    return el.closest("p, li, td, th, dd, dt, blockquote, h1, h2, h3, h4, h5, h6, figcaption") ?? main;
  }
  return null;
}

/** The selection, when it is a few words of the main text: the words, their sentence, the range. */
function selected(s: State): { term: string; sentence: string; range: Range } | null {
  const { doc } = s;
  if (doc.documentElement.hasAttribute(ORIGINAL)) return null;
  const active = doc.activeElement;
  if (active && active !== doc.body && active.matches?.(NOT_HERE) && active !== s.host) return null;
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount !== 1 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const raw = sel.toString();
  // Far longer than TERM_MAX: a paragraph, not words to explain (cleanTerm checks the exact length).
  if (raw.length > TERM_MAX * 4) return null;
  const term = cleanTerm(raw);
  if (!term) return null;
  const start = inMainText(s, range.startContainer);
  const end = inMainText(s, range.endContainer);
  if (!start || !end) return null;
  const block = start.contains(end) ? start : end.contains(start) ? end : start;
  return { term, sentence: sentenceOf(block.textContent ?? "", term), range: range.cloneRange() };
}

/** The sentence of `text` holding `term` (the block's start when none does), at most SENTENCE_MAX characters. */
export function sentenceOf(text: string, term: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const parts = flat.split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"'„“(])/u);
  const found = parts.find((p) => p.includes(term)) ?? parts.find((p) => p.toLowerCase().includes(term.toLowerCase())) ?? flat;
  if (found.length <= SENTENCE_MAX) return found;
  const at = Math.max(0, found.indexOf(term));
  const from = Math.max(0, Math.min(at - SENTENCE_MAX / 2, found.length - SENTENCE_MAX));
  return found.slice(from, from + SENTENCE_MAX);
}

/** The page's own words, as text: the main text first, then the rest of the page (a tag list, a glossary), never a
 *  script, a style or Distill's own parts. Only what the page shows in its markup; nothing is fetched. */
function pageWords(s: State): { main: string; rest: string } {
  const main = (s.ctx.main && s.ctx.main !== s.doc.body ? [s.ctx.main] : s.ctx.body).map((e) => e.textContent ?? "").join("\n");
  const parts: string[] = [];
  let used = 0;
  const root = s.doc.body ?? s.doc.documentElement;
  const walker = s.doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("script, style, noscript, template, distill-caption, distill-link-note, " + NOTE_TAG) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n && used < PAGE_WORDS_MAX; n = walker.nextNode()) {
    const t = (n as Text).data;
    if (!t.trim()) continue;
    parts.push(t);
    used += t.length + 1;
  }
  return { main, rest: parts.join(" ") };
}

function ensureHost(s: State): HTMLElement {
  if (s.host?.isConnected && s.box) return s.box;
  const host = s.doc.createElement(NOTE_TAG);
  for (const [k, v] of Object.entries({
    all: "initial", position: "fixed", left: "0", top: "0", "z-index": "2147483646", display: "block", margin: "0", padding: "0",
    border: "0", "pointer-events": "none", visibility: "hidden",
  })) host.style.setProperty(k, v, "important");
  // E2E AND UNIT TESTS ONLY: those builds open the shadow root so the tests and the live probe can read the note and press
  // its button. Every other build (the one people install) keeps it closed. The MODE comparison is replaced at build.
  const root = host.attachShadow({ mode: import.meta.env.MODE === "e2e" || import.meta.env.MODE === "test" ? "open" : "closed" });
  const style = s.doc.createElement("style");
  style.textContent = NOTE_CSS;
  const box = s.doc.createElement("div");
  box.className = "note";
  root.append(style, box);
  s.doc.documentElement.append(host);
  s.host = host;
  s.box = box;
  return box;
}

/** Puts the note beside the words: below them, or above when the strip or the window's end leaves no room. */
function place(s: State): void {
  const host = s.host, box = s.box, range = s.range;
  if (!host || !box || !range) return;
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  const first = rects[0] ?? range.getBoundingClientRect();
  const last = rects[rects.length - 1] ?? first;
  const w = box.offsetWidth, h = box.offsetHeight;
  const vw = s.win.innerWidth, vh = s.win.innerHeight;
  let top = last.bottom + 6;
  if (top + h > vh - STRIP_ROOM) top = Math.max(4, first.top - 6 - h);
  const left = Math.max(8, Math.min(s.phase === "offer" ? last.right - w / 2 : first.left, vw - w - 8));
  host.style.setProperty("left", `${Math.round(left)}px`, "important");
  host.style.setProperty("top", `${Math.round(top)}px`, "important");
  host.style.setProperty("visibility", "visible", "important");
}

function el<K extends keyof HTMLElementTagNameMap>(s: State, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = s.doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The note with its one Explain button, beside the selected words. */
function offer(s: State, pick: { term: string; sentence: string; range: Range }): void {
  s.win.clearTimeout(s.answerTimer);
  const box = ensureHost(s);
  s.phase = "offer";
  s.id = "";
  s.term = pick.term;
  s.sentence = pick.sentence;
  s.range = pick.range;
  box.className = "note";
  box.removeAttribute("role");
  box.removeAttribute("aria-live");
  box.dataset.phase = "offer";
  delete box.dataset.source;
  const button = el(s, "button", "", "Explain");
  button.type = "button";
  button.setAttribute("aria-label", `Explain "${pick.term}"`);
  // Pressing the button keeps the page's selection (and the focus where it was).
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); press(s); });
  box.replaceChildren(button);
  place(s);
}

/** The note in its open form: the words, a line of text, where it came from, Close. */
function render(s: State, phase: "asking" | "shown", text: string, source?: ExplainSource): void {
  const box = ensureHost(s);
  const hadFocus = s.doc.activeElement === s.host;
  s.phase = phase;
  box.className = "note open";
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.dataset.phase = phase;
  if (source) box.dataset.source = source;
  else delete box.dataset.source;
  const children: HTMLElement[] = [el(s, "div", "title", s.term), el(s, "div", phase === "asking" ? "line busy" : "line", text)];
  const foot = el(s, "div", "foot");
  if (source) foot.append(el(s, "span", "src", SOURCE_WORDS[source]));
  const close = el(s, "button", "", "Close");
  close.type = "button";
  close.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); hide(); });
  foot.append(close);
  children.push(foot);
  box.replaceChildren(...children);
  place(s);
  if (hadFocus) close.focus({ preventScroll: true });
}

/** Explain pressed: from the page when it spells the words out, else this tab's strip is asked. */
function press(s: State): void {
  if (s.phase !== "offer" || !s.term) return;
  const id = `x${++counter}`;
  s.id = id;
  const words = pageWords(s);
  const spelled = spelledOut(words.main, s.term) ?? spelledOut(words.rest, s.term);
  if (spelled) {
    render(s, "shown", spelled, "page");
    return;
  }
  render(s, "asking", "Explaining on this device...");
  const msg: CaptionExplainAsk = { type: "distill:caption:explainAsk", tabId: s.tabId, id, term: s.term, sentence: s.sentence };
  try {
    void chrome.runtime.sendMessage(msg).catch(() => answer(id, "The strip did not answer, so nothing was explained.", "refused"));
  } catch {
    answer(id, "Distill was updated or turned off, so nothing was explained.", "refused");
  }
  s.win.clearTimeout(s.answerTimer);
  s.answerTimer = s.win.setTimeout(() => answer(id, "No answer came from the AI on this device.", "refused"), ANSWER_MS);
}

function answer(id: string, text: string, source: ExplainSource): void {
  const s = state;
  if (!s || s.id !== id || s.phase !== "asking") return;
  s.win.clearTimeout(s.answerTimer);
  render(s, "shown", text, source);
}

/** From this tab's strip (distill:caption:explainShow): the explanation of the words asked as `id`, or why not. An
 *  answer to anything but the note's current ask is dropped. The text is shown as text, never as markup. */
export function showExplanation(_doc: Document, id: string, text: string, source: ExplainSource): void {
  answer(id, String(text).slice(0, 400), source === "on_device" || source === "page" ? source : "refused");
}

/** Focus leaves the note (its button inside the shadow root, then the host). */
function blurNote(s: State): void {
  if (!s.host || s.doc.activeElement !== s.host) return;
  ((s.box?.getRootNode() as ShadowRoot | undefined)?.activeElement as HTMLElement | null | undefined)?.blur();
  if (s.doc.activeElement === s.host) s.host.blur();
}

/** Takes the note down (it stays in the page, hidden, for the next one). */
function hide(): void {
  const s = state;
  if (!s) return;
  blurNote(s);
  s.win.clearTimeout(s.answerTimer);
  s.win.clearTimeout(s.settleTimer);
  s.host?.style.setProperty("visibility", "hidden", "important");
  s.box?.replaceChildren();
  if (s.box) delete s.box.dataset.phase;
  s.phase = null;
  s.id = "";
  s.range = null;
}

/** What the note shows now (the e2e and the live probe read it through the page). */
export function explainShown(): { phase: Phase; term: string; text: string; source?: ExplainSource } | null {
  const s = state;
  if (!s?.phase || !s.box) return null;
  const source = s.box.dataset.source as ExplainSource | undefined;
  return { phase: s.phase, term: s.term, text: s.box.querySelector(".line")?.textContent ?? "", ...(source ? { source } : {}) };
}

function listen(s: State): () => void {
  const { doc, win } = s;
  const inNote = (t: EventTarget | null) => !!s.host && t === s.host;

  const settle = () => {
    win.clearTimeout(s.settleTimer);
    s.settleTimer = win.setTimeout(() => {
      const pick = selected(s);
      if (pick) {
        // The same words again (the selection only moved its ends inside them): leave an open note alone.
        if (s.phase && s.phase !== "offer" && pick.term === s.term) return;
        if (s.phase === "offer" && pick.term === s.term) { s.range = pick.range; place(s); return; }
        s.passed = "";
        offer(s, pick);
      } else if (s.phase === "offer") {
        hide();
      }
    }, SETTLE_MS);
  };
  const down = (e: PointerEvent) => {
    if (inNote(e.target) || !s.phase) return;
    // A press elsewhere closes an open note; a press that starts a new selection replaces the button when it settles.
    if (s.phase !== "offer") hide();
  };
  const key = (e: KeyboardEvent) => {
    if (!s.phase) return;
    const fromNote = inNote(e.target);
    if (e.key === "Escape") {
      hide();
      // The page's own Escape (closing its dialog) still runs when the key was not pressed inside the note.
      if (fromNote) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
    const button = s.box?.querySelector("button");
    if (!button) return;
    if (!fromNote) {
      // Tab from the page while the note is up moves to its button, once per selection.
      if (!e.shiftKey && s.passed !== s.term) { e.preventDefault(); button.focus({ preventScroll: true }); }
      return;
    }
    // Tab or Shift+Tab out of the note: the button stays up for the mouse, and Tab is the page's again.
    e.preventDefault();
    s.passed = s.term;
    blurNote(s);
  };
  const scrolled = () => {
    if (!s.phase || s.frame) return;
    s.frame = win.requestAnimationFrame(() => { s.frame = 0; place(s); });
  };

  const opts = { capture: true, passive: true } as const;
  doc.addEventListener("selectionchange", settle);
  doc.addEventListener("pointerdown", down, opts);
  doc.addEventListener("keydown", key, true);
  doc.addEventListener("scroll", scrolled, opts);
  win.addEventListener("resize", scrolled);
  return () => {
    doc.removeEventListener("selectionchange", settle);
    doc.removeEventListener("pointerdown", down, opts);
    doc.removeEventListener("keydown", key, true);
    doc.removeEventListener("scroll", scrolled, opts);
    win.removeEventListener("resize", scrolled);
    if (s.frame) win.cancelAnimationFrame(s.frame);
  };
}

/** Starts listening for selections in the main text (with the caption). Called again (Stay clean read the page again),
 *  it follows the new main text. */
export function explainWords(ctx: CleanContext, tabId: number): void {
  if (state && state.doc === ctx.doc) { state.ctx = ctx; state.tabId = tabId; return; }
  if (state) clearExplain(state.doc);
  const s: State = {
    doc: ctx.doc, win: ctx.win, ctx, tabId, host: null, box: null, phase: null, id: "", term: "", sentence: "", range: null,
    passed: "", settleTimer: 0, answerTimer: 0, frame: 0, observer: null, off: () => undefined,
  };
  s.off = listen(s);
  // Original shows the untouched page: the note goes with it.
  if (typeof MutationObserver === "function") {
    s.observer = new MutationObserver(() => { if (ctx.doc.documentElement.hasAttribute(ORIGINAL)) hide(); });
    s.observer.observe(ctx.doc.documentElement, { attributes: true, attributeFilter: [ORIGINAL] });
  }
  state = s;
}

/** Takes the note and its listeners off (close). */
export function clearExplain(doc: Document): void {
  if (state) {
    hide();
    state.off();
    state.observer?.disconnect();
    state.host?.remove();
    state = null;
  }
  doc.querySelectorAll(NOTE_TAG).forEach((n) => n.remove());
}
