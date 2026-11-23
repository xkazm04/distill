// Round 3, card 4 (r3-04): a cookie banner answered for you. Where the banner offers a button that rejects everything
// that is not needed (OneTrust, Didomi, Cookiebot, Quantcast / InMobi, Usercentrics, Sourcepoint, TrustArc, a few
// smaller ones, or a plain button whose words say so), Distill presses it, at most once per page load, in the top frame,
// only after Clean ran. Accept is never pressed, and neither is a button whose words are ambiguous ("OK", "Continue",
// "Save settings"). Without a reject button the banner is only hidden, as Clean does anyway (engine clutter.ts).
//
// The switch (More, frame/Consent.tsx) is kept on this device in chrome.storage.local: per site, else for every site;
// on by default. The page side reads it when Clean runs (page.ts). Nothing here leaves the page.
import type { ConsentOutcome } from "../messages";

export const CONSENT_KEY = "distill:consent";

/** The switch as kept: `on` for every site (absent: on), `sites` the per-site choices that differ. */
export interface ConsentPrefs { on?: boolean; sites: Record<string, boolean> }

export function parseConsentPrefs(raw: unknown): ConsentPrefs {
  const out: ConsentPrefs = { sites: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { on?: unknown; sites?: unknown };
  if (typeof r.on === "boolean") out.on = r.on;
  if (r.sites && typeof r.sites === "object") {
    for (const [origin, v] of Object.entries(r.sites as Record<string, unknown>)) if (typeof v === "boolean") out.sites[origin] = v;
  }
  return out;
}

/** Does Distill answer banners on this site? The site's own choice, else the choice for every site, else yes. */
export const consentWanted = (prefs: ConsentPrefs, origin: string | null): boolean =>
  (origin ? prefs.sites[origin] : undefined) ?? prefs.on ?? true;

/** Reads the kept switch (no storage, as in unit tests: the default). */
export async function loadConsentPrefs(): Promise<ConsentPrefs> {
  try {
    const got = await chrome.storage.local.get(CONSENT_KEY);
    return parseConsentPrefs(got[CONSENT_KEY]);
  } catch {
    return parseConsentPrefs(undefined);
  }
}

export async function saveConsentPrefs(prefs: ConsentPrefs): Promise<void> {
  await chrome.storage.local.set({ [CONSENT_KEY]: prefs });
}

// ---- The words of a button ------------------------------------------------------------------------------------------

/**
 * A button that rejects everything not needed, by its whole text (lower case, spaces folded, an optional trailing
 * "cookies" and punctuation dropped). A whole-text match only: "Reject all" yes, "Accept or reject later" no.
 */
const REJECT = new RegExp(
  "^(" + [
    // English
    "reject( all)?", "reject all( and close)?", "decline( all)?", "deny( all)?", "refuse( all)?", "disagree( to all)?",
    "i (do not|don't) (accept|agree)", "do not accept", "(only|just) (the )?(necessary|essential|required|strictly necessary)( ones)?",
    "(necessary|essential|required|strictly necessary) only", "(use|allow|accept) (only )?(necessary|essential|required|strictly necessary)( only)?",
    "(use|allow|accept) (only )?(necessary|essential|required|strictly necessary) cookies( only)?",
    "continue without (accepting|agreeing|consent)",
    // Czech, Slovak
    "odmítnout( vše| všechny| vše a zavřít)?", "zamítnout( vše| všechny)?", "nesouhlasím", "(pouze|jen|povolit pouze|povolit jen|přijmout pouze|použít pouze) (nezbytné|nutné|technické)",
    "pokračovat bez (souhlasu|přijetí)", "odmietnuť( všetko| všetky)?", "nesúhlasím", "(iba|len) (nevyhnutné|nutné)",
    // German, French, Polish
    "(alle )?ablehnen", "nur (notwendige|erforderliche|essenzielle)", "tout refuser", "refuser( tout)?", "continuer sans accepter",
    "odrzuć( wszystkie)?", "tylko (niezbędne|wymagane)",
  ].join("|") + ")$",
  "u",
);

/** Words that say yes: a button with any of them is never pressed, whatever its id says, unless its whole text is one
 *  of REJECT's phrases ("I do not accept", "Accept only necessary"). */
const ACCEPT = /(?<!\p{L})(accept|agree|allow all|got it|ok|okay|souhlasím|přijmout|povolit vše|rozumím|súhlasím|prijať|akzeptieren|zustimmen|alle erlauben|accepter|j'accepte|akceptuj|zgadzam)(?!\p{L})/iu;

/** The button's words as a person reads them, folded for matching. */
export function buttonWords(el: Element): string {
  // localName, not instanceof: a same-origin frame's elements come from another window.
  const own = el.localName === "input" ? (el as HTMLInputElement).value : el.textContent ?? "";
  return foldWords(own.trim() ? own : el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "");
}

/** Lower case, spaces folded, a trailing "cookies" and punctuation dropped: "Reject All Cookies." -> "reject all". */
export const foldWords = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!…]+$/u, "").replace(/ cookies?$/u, "").trim();

/** The words, whole, say reject everything not needed ("Accept only necessary" counts: it rejects the rest). */
export const rejectsByWords = (words: string): boolean => !!words && words.length <= 60 && REJECT.test(words);

/** The words say yes (Accept, Agree, OK...) and not no. */
export const acceptsByWords = (words: string): boolean => ACCEPT.test(words) && !rejectsByWords(words);

// ---- The banner systems -----------------------------------------------------------------------------------------------

/** A consent system: where its banner is, and its own reject buttons (ids and classes it ships with). `wordsMust`:
 *  the system's selector is shared with other buttons, so the words must also say reject. */
export interface Cmp {
  name: string; banner: string; reject: string[]; wordsMust?: boolean;
  /** r4-01: the system's own "choose" button, for a notice that shows no reject button on its first layer (Deník's
   *  Didomi: only "Podrobné nastavení" and "Souhlasím"). Pressed only then, never when its words say yes; then the
   *  reject button of the choices it opens (`reject`, its words saying reject) is pressed once it appears. */
  settings?: string;
}

export const CMPS: Cmp[] = [
  { name: "OneTrust", banner: "#onetrust-consent-sdk, #onetrust-banner-sdk", reject: ["#onetrust-reject-all-handler", ".ot-pc-refuse-all-handler"] },
  { name: "Didomi", banner: "#didomi-host, #didomi-notice, #didomi-popup", reject: ["#didomi-notice-disagree-button", ".didomi-continue-without-agreeing", "#btn-toggle-disagree"],
    settings: "#didomi-notice-learn-more-button" },
  { name: "Cookiebot", banner: "#CybotCookiebotDialog", reject: ["#CybotCookiebotDialogBodyButtonDecline", "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll"] },
  { name: "Quantcast", banner: "#qc-cmp2-container, .qc-cmp2-container, #qc-cmp2-ui, .qc-cmp2-ui", reject: [".qc-cmp2-summary-buttons button[mode=secondary]", ".qc-cmp2-footer button[mode=secondary]"], wordsMust: true },
  { name: "Usercentrics", banner: "#usercentrics-root, #usercentrics-cmp-ui, #uc-banner", reject: ["[data-testid=uc-deny-all-button]", "#uc-btn-deny-banner", "button.uc-deny-button"] },
  { name: "Sourcepoint", banner: "[id^=sp_message_container], .sp-message-open, iframe[id^=sp_message_iframe]", reject: [".sp_choice_type_13", ".sp_choice_type_REJECT_ALL", "button[title='Reject all']", "button[aria-label='Reject all']"] },
  { name: "TrustArc", banner: "#truste-consent-track, #truste-consent-content, .truste_box_overlay, #consent_blackbar", reject: ["#truste-consent-required", ".truste-consent-required"] },
  // Smaller ones seen on Czech and European sites.
  { name: "CookieConsent", banner: "#cc-main, #cc_div, .cc-window", reject: ["#cc-main [data-role=necessary]", "#cc_div [data-role=necessary]", ".cc-window .cc-deny"] },
  { name: "Complianz", banner: "#cmplz-cookiebanner-container, .cmplz-cookiebanner", reject: [".cmplz-btn.cmplz-deny"] },
  { name: "CookieYes", banner: ".cky-consent-container, #cookie-law-info-bar", reject: [".cky-btn-reject", "#cookie_action_close_header_reject"] },
  { name: "Seznam", banner: "szn-cmp-dialog-container", reject: ["[data-testid=cw-button-reject-all]"], wordsMust: true },
];

/** What a press looks like. Never a link that leaves the page (a "Reject" that is a policy link). */
function pressable(el: Element): el is HTMLElement {
  if (typeof (el as HTMLElement).click !== "function") return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.localName === "a") {
    const href = (el.getAttribute("href") ?? "").trim();
    if (href && href !== "#" && !/^javascript:/i.test(href) && el.getAttribute("role") !== "button") return false;
  }
  return true;
}

const BUTTONS = "button, [role=button], input[type=button], input[type=submit], a";

/** Every root to search: the document, the open shadow roots under `scope` (Usercentrics, Seznam draw inside one), and
 *  frames of the same origin (Sourcepoint, when it is served from the site itself). A frame from elsewhere cannot be
 *  reached: that banner is only hidden. */
function roots(scope: ParentNode, depth = 0): ParentNode[] {
  const out: ParentNode[] = [scope];
  if (depth > 3) return out;
  const els = [...("localName" in scope ? [scope as Element] : []), ...Array.from(scope.querySelectorAll("*"))];
  for (const el of els) {
    if (el.shadowRoot) out.push(...roots(el.shadowRoot, depth + 1));
    if (el.localName === "iframe") {
      let inner: Document | null = null;
      try { inner = (el as HTMLIFrameElement).contentDocument; } catch { inner = null; }
      if (inner?.body) out.push(...roots(inner, depth + 1));
    }
  }
  return out;
}

/** The banners on the page: what Clean hid as a cookie notice, and every consent system's box that is there. */
function bannersOf(doc: Document, hidden: readonly Element[]): { el: Element; cmp?: Cmp }[] {
  const out: { el: Element; cmp?: Cmp }[] = hidden.filter((el) => el.isConnected).map((el) => ({ el }));
  for (const cmp of CMPS) for (const el of Array.from(doc.querySelectorAll(cmp.banner))) {
    // A system's empty container (Didomi keeps #didomi-host on the page before and after it asks) is no banner.
    const asks = !!el.shadowRoot || el.localName === "iframe" || !!el.querySelector(`${BUTTONS}, iframe`);
    if (asks && !out.some((b) => b.el === el || b.el.contains(el))) out.push({ el, cmp });
  }
  return out;
}

/** The reject button to press, or null: a system's own reject button (its words not saying yes), else a plain button
 *  inside a banner whose whole text says reject. */
export function findReject(doc: Document, hidden: readonly Element[] = []): { button: HTMLElement; via: string } | null {
  const banners = bannersOf(doc, hidden);
  if (!banners.length) return null;
  for (const cmp of CMPS) {
    if (!banners.some((b) => b.cmp === cmp || b.el.matches(cmp.banner) || !!b.el.querySelector(cmp.banner))) continue;
    for (const root of banners.flatMap((b) => roots(b.el))) {
      for (const sel of cmp.reject) {
        for (const el of Array.from(root.querySelectorAll(sel))) {
          const words = buttonWords(el);
          if (!pressable(el) || acceptsByWords(words)) continue;
          if (cmp.wordsMust && !rejectsByWords(words)) continue;
          return { button: el, via: cmp.name };
        }
      }
    }
  }
  for (const b of banners) {
    for (const root of roots(b.el)) {
      for (const el of Array.from(root.querySelectorAll(BUTTONS))) {
        if (pressable(el) && rejectsByWords(buttonWords(el))) return { button: el, via: "words" };
      }
    }
  }
  return null;
}

/** A system's own "choose" button (r4-01), for a notice without a reject button on its first layer; its words never
 *  say yes. Null when the notice has a reject button, or no such system is there. */
export function findSettings(doc: Document, hidden: readonly Element[] = []): { button: HTMLElement; cmp: Cmp } | null {
  const banners = bannersOf(doc, hidden);
  for (const cmp of CMPS) {
    if (!cmp.settings || !banners.some((b) => b.cmp === cmp || b.el.matches(cmp.banner) || !!b.el.querySelector(cmp.banner))) continue;
    for (const root of banners.flatMap((b) => roots(b.el))) {
      for (const el of Array.from(root.querySelectorAll(cmp.settings))) {
        if (pressable(el) && !acceptsByWords(buttonWords(el))) return { button: el, cmp };
      }
    }
  }
  return null;
}

/** The reject button of a system's choices, once open: its own id, its words saying reject (never yes). */
function rejectInChoices(doc: Document, cmp: Cmp): HTMLElement | null {
  const boxes = Array.from(doc.querySelectorAll(cmp.banner));
  for (const root of boxes.flatMap((b) => roots(b))) {
    for (const sel of cmp.reject) {
      for (const el of Array.from(root.querySelectorAll(sel))) {
        if (pressable(el) && rejectsByWords(buttonWords(el)) && !acceptsByWords(buttonWords(el))) return el;
      }
    }
  }
  return null;
}

/** How long the choices may take to open after the "choose" press (ms), looked for every CHOICES_STEP ms. */
const CHOICES_WAIT = 4000;
const CHOICES_STEP = 100;
/** Told when a two-step answer (r4-01) ends: "rejected", or "hidden" when the choices never showed a reject button. */
let onLater: ((outcome: ConsentOutcome) => void) | null = null;
export function onConsentLater(fn: ((outcome: ConsentOutcome) => void) | null): void { onLater = fn; }

// ---- This page ----------------------------------------------------------------------------------------------------

/** Per page load (the content script lives as long as the document): pressed already, and the banners Clean found. */
const pressed = new WeakMap<Document, string>();
let known: Element[] = [];
let last: ConsentOutcome = "none";

/** How the last press was found ("OneTrust", "words"...), for tests and the frame's note. */
export const pressedVia = (doc: Document): string | undefined => pressed.get(doc);

/**
 * Switch on (answer banners) or off (hide only). Returns what happened on this page. `banners`: what Clean hid as a
 * cookie notice (page.ts passes them; the frame's switch leaves it out and the last ones are used). A banner is answered
 * at most once per page load; a press already made stays "rejected" whatever the switch says now.
 */
/** On a cookie banner whose reject button Distill pressed (r3-04). */
export const ANSWERED = "data-distill-answered";

export function setConsent(doc: Document, on: boolean, banners?: readonly Element[]): ConsentOutcome {
  if (banners) known = [...banners];
  if (pressed.has(doc)) return (last = "rejected");
  if (!on) return (last = "off");
  const win = doc.defaultView;
  if (win && win.top !== win) return (last = "none"); // the top frame only
  if (opening.has(doc) || tried.has(doc)) return last; // a two-step answer is under way, or was tried
  const found = findReject(doc, known);
  if (found) {
    pressed.set(doc, found.via);
    // The banner this answered: the site removes or hides it itself once told no, so Original cannot show it again
    // (the press cannot be taken back). Marked so anyone checking Original knows why it stays away.
    for (const b of known) if (b.contains(found.button) || known.length === 1) b.setAttribute(ANSWERED, "");
    found.button.click();
    return (last = "rejected");
  }
  last = bannersOf(doc, known).length ? "hidden" : "none";
  // r4-01: no reject button on the notice itself, but the system's own choices have one (Didomi's "Podrobné nastavení"
  // opens them, "Zamítnout vše" there says no and closes). Hidden until that second press is made.
  const settings = findSettings(doc, known);
  if (settings && win) {
    opening.add(doc);
    const banners = [...known];
    settings.button.click();
    const gen = generation;
    const t0 = Date.now();
    const look = () => {
      if (gen !== generation) { opening.delete(doc); return; } // Distill was closed meanwhile
      const button = rejectInChoices(doc, settings.cmp);
      if (button) {
        opening.delete(doc);
        pressed.set(doc, `${settings.cmp.name} (choices)`);
        for (const b of banners) if (b.contains(button) || banners.length === 1) b.setAttribute(ANSWERED, "");
        button.click();
        last = "rejected";
        onLater?.("rejected");
      } else if (Date.now() - t0 < CHOICES_WAIT) {
        win.setTimeout(look, CHOICES_STEP);
      } else {
        // The choices never showed a reject button: nothing more is pressed on this page.
        opening.delete(doc);
        tried.add(doc);
        onLater?.(last);
      }
    };
    win.setTimeout(look, CHOICES_STEP);
  }
  return last;
}

/** Pages where a two-step answer (r4-01) is under way. */
const opening = new WeakSet<Document>();
/** Pages where the choices were opened and showed no reject button: not tried again. */
const tried = new WeakSet<Document>();
/** Bumped by close: a two-step answer under way stops. */
let generation = 0;

/** What happened last on this page (the report carries it). */
export const consentNow = (): ConsentOutcome => last;

/** Clean ran (page.ts): read the switch for this site, then answer. `banners`: what Clean hid as a cookie notice.
 *  `prefs`: the switch, already being read (r4-02: Clean starts reading it when it starts, so the answer does not wait
 *  for the device's storage after the page was cleaned); read now when not given. */
export async function consentAfterClean(doc: Document, banners: readonly Element[],
  prefs: Promise<ConsentPrefs> = loadConsentPrefs()): Promise<{ outcome: ConsentOutcome; on: boolean }> {
  known = [...banners];
  const origin = doc.defaultView?.location.origin ?? null;
  const on = consentWanted(await prefs, origin && origin !== "null" ? origin : null);
  return { outcome: setConsent(doc, on, banners), on };
}

/** Close: forget the banners (the press itself cannot be taken back, and is not made again on this page). */
export function clearConsent(): void {
  generation++;
  for (const b of known) b.removeAttribute(ANSWERED);
  known = [];
}
