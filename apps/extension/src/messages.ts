// Messages between the side panel and the content script. Structure and values travel only inside the browser
// (chrome.tabs.sendMessage); nothing here leaves the device.
import type { Byline, Chapter, ClaimVerdict, ProductFacts, ClutterItem, FoundAction, Rates, FormErrors, FormStructure, FormValues, PageAction, PageKind, PageModel } from "@distill/engine";
import type { PageThemeSeed } from "@distill/web/ui/theme/roles";

export type ContentRequest =
  | { type: "distill:ping" }
  | { type: "distill:getPage" }
  | { type: "distill:getForm"; formIndex: number }
  | { type: "distill:readValues"; structure: FormStructure }
  | { type: "distill:writeValues"; structure: FormStructure; values: FormValues }
  /** The validation errors the page shows now. Device-only: an error can repeat what the person typed. */
  | { type: "distill:readErrors"; structure: FormStructure }
  /** `color`: the side panel's accent at call time; the content script normalises it or falls back. */
  | { type: "distill:highlight"; fieldIds: string[]; color?: string }
  | { type: "distill:getTheme" }
  /** Outline a block of the last read (by its id) or a step's fields in the focus colour, and scroll it into view;
   *  null clears it. Never touches the outline of filled fields (distill:highlight). */
  | { type: "distill:locate"; target: LocateTarget | null; color?: string }
  /** What can be clicked in the page, by label only (engine extractActions); the content script keeps the elements. */
  | { type: "distill:listActions" }
  /** Click the control `actionId` of the last distill:listActions. Sent only after the person pressed Accept. */
  | { type: "distill:doAction"; actionId: string }
  // ---- the caption: Distill on the page itself (docs/caption.md) ----
  /** From the service worker after the toolbar click: put the caption strip on the page (or take it off, `toggle`). */
  /** `auto` (r2-08): the service worker opens it by itself on a remembered site; the page refuses in a frame, and after
   *  the person closed Distill on this document (until the next load). */
  | { type: "distill:caption:open"; tabId: number; toggle?: boolean; auto?: boolean }
  /** From the caption: hide what is not content. Runs once per page; a second call answers the same report. */
  | { type: "distill:caption:clean" }
  /** From the caption: bring one removed item back, or all of them. */
  | { type: "distill:caption:restore"; id: string | "all" }
  /** From the caption: show the untouched original (true) or Distill's version again (false). */
  | { type: "distill:caption:original"; on: boolean }
  /** From the caption: the strip's content is this tall now (px). The page side clamps it and reserves the space. */
  | { type: "distill:caption:size"; height: number }
  /** From the caption: close Distill on this page; everything it changed goes back. */
  | { type: "distill:caption:close" }
  // ---- spark universal-core, round 1 (docs/caption.md, "Round 1") ----
  /** From the caption: the reading comfort layer on (true) or off (#6). */
  | { type: "distill:caption:comfort"; on: boolean }
  /** From the caption: let what Calm paused play and move again (#8). */
  | { type: "distill:caption:play" }
  /** From the caption: the page's ways to reach whoever runs it (#5). Read from the whole page, removed parts too. */
  | { type: "distill:caption:contact" }
  /** From the caption: scroll to where a contact item was found and mark it (shows the original when it was hidden). */
  | { type: "distill:caption:showContact"; id: string }
  /** From the caption: how far the page's form is filled (#9); null reply when the page has no form. */
  | { type: "distill:caption:form" }
  /** From the caption: scroll to the next empty required field (else the next empty one) and focus it (#9). */
  | { type: "distill:caption:nextField" }
  /** From the caption: the main text's blocks to translate (#10). Page text, kept inside the browser. */
  | { type: "distill:caption:blocks" }
  /** From the caption: put these translations into the page, block by block; originals are kept (#10). */
  | { type: "distill:caption:translated"; blocks: TextBlock[] }
  /** From the caption: show the page's own words (true, "Keep Czech") or the translation again (false) (#10). */
  | { type: "distill:caption:sourceText"; on: boolean }
  /** From the caption once a translation is on the page: watch for text the page adds or rewrites later, and tell this
   *  tab's frame how many blocks wait (CaptionMoreText) (#10). */
  | { type: "distill:caption:watchText"; tabId: number }
  // ---- spark universal-core, round 2 ----
  /** From the caption: the page's title, address and origin (the claim check sends title and address; Remember keys
   *  on the origin). No page text. */
  | { type: "distill:caption:pageInfo" }
  /** From the caption: underline these claims in the main text (r2-01); sent again with a verdict once one is checked
   *  (r2-02). Replaces the marks of the last call. */
  | { type: "distill:caption:markClaims"; claims: ClaimMark[] }
  /** From the caption: scroll to a sentence of a block and highlight it a moment (claims r2-01, gist r2-10). */
  | { type: "distill:caption:showText"; blockId: string; sentence: string }
  /** From the caption: take every claim mark off. */
  | { type: "distill:caption:clearClaims" }
  /** From the caption: every block of the main text as the page shows it now, whatever its language (claims r2-01,
   *  gist r2-10; their ids are what markClaims and showText name). Page text, kept inside the browser. */
  | { type: "distill:caption:mainText" }
  /** From the caption: readable tables on (true) or off (r2-05). */
  | { type: "distill:caption:tables"; on: boolean }
  /** From the caption: link notes on (true) or off (r2-07). */
  | { type: "distill:caption:links"; on: boolean }
  // ---- round 2: plain words (r2-04) ----
  /** From the caption: the main text's blocks to rewrite in plain words, as the page shows them now (a translated
   *  block's translation, else the page's words). Page text, kept inside the browser. */
  | { type: "distill:caption:plainBlocks" }
  /** From the caption: put these plain words (they passed parsePlain) into the page; the page's words are kept. */
  | { type: "distill:caption:plainText"; blocks: TextBlock[] }
  /** From the caption: plain words on (true) or the words as written (false). */
  | { type: "distill:caption:plainShown"; on: boolean }
  // ---- spark universal-core, round 3 ----
  /** From the caption: answer cookie banners with their reject button (true) or only hide them (false) (r3-04). */
  | { type: "distill:caption:consent"; on: boolean }
  /** From the caption: the page's own colours darkened with care (true) or as the page made them (false) (r3-06). */
  | { type: "distill:caption:dark"; on: boolean }
  /** From the caption: who wrote the page and when, from its own data (r3-05). */
  | { type: "distill:caption:byline" }
  /** From the caption: prices with the reader's currency and dates in the reader's terms beside them (true), or off
   *  (r3-07). `rates` comes from the service worker (RatesRequest); without it only dates are written. */
  | { type: "distill:caption:terms"; on: boolean; currency?: string; locale?: string; rates?: Rates }
  /** From the caption: what this page asks of you, found in the main text (r3-09). */
  | { type: "distill:caption:actions" }
  /** From the caption: the light highlight on every action's exact words on (true) or off (r3-09). */
  | { type: "distill:caption:markActions"; on: boolean }
  /** From the caption: scroll to one action's words and flash them (r3-09). */
  | { type: "distill:caption:showAction"; id: string }
  // ---- spark universal-core, round 4 ----
  /** From the caption: a form's own words to translate (labels, hints, placeholders, options, buttons), never a value
   *  and never an error message (r4-04). Ids `f0...`. */
  | { type: "distill:caption:formText" }
  /** From the caption: put these translations of the form's words in place (r4-04). */
  | { type: "distill:caption:formTranslated"; blocks: TextBlock[] }
  /** From the caption: the error messages the form shows now, for an on-device translation only (r4-04; values). */
  | { type: "distill:caption:formErrors" }
  /** From the caption: put these on-device translations of the errors in place (r4-04). */
  | { type: "distill:caption:formErrorsTranslated"; blocks: TextBlock[] }
  /** From the caption: the form's own words (true, Keep <language>) or the translation again (false) (r4-04). */
  | { type: "distill:caption:formSource"; on: boolean }
  /** From the caption: show the explanation of the selected words beside them (r4-05). */
  | { type: "distill:caption:explainShow"; id: string; text: string; source: "page" | "on_device" | "refused" }
  /** From the caption: the video's chapters and sponsor parts from its description, or null (r4-06). */
  | { type: "distill:caption:video" }
  /** From the caption: move the page's main video to this second (r4-06). */
  | { type: "distill:caption:seek"; seconds: number }
  /** From the caption: the product page's facts, or null (r4-07). */
  | { type: "distill:caption:product" }
  /** From the caption: scroll to where a product fact was read and flash it (r4-07). */
  | { type: "distill:caption:showProduct"; id: string }
  /** From the caption: one step of a tour, highlighted and scrolled to; null ends the tour (r4-08). */
  | { type: "distill:caption:tour"; step: TourStep | null };

/** A tour step (r4-08): something Distill already found on the page, by its own id. */
export type TourStep =
  | { kind: "text"; blockId: string; sentence: string }
  | { kind: "action"; id: string }
  | { kind: "contact"; id: string }
  | { kind: "product"; id: string };

/** The video's chapters (r4-06): the description's words and times only. */
export interface VideoInfo {
  chapters: Chapter[];
  duration?: number;
  /** Where the main video is now (seconds), so the strip can mark the chapter playing and offer Skip in a sponsor part.
   *  Omitted while the site plays its own advert in the player. */
  currentTime?: number;
}

/** Content script -> this tab's caption frame (r4-05): the person selected words in the main text and pressed Explain.
 *  The words and their sentence are page text; the frame runs the on-device model (explainTerm, values) or answers
 *  from the page, then sends distill:caption:explainShow. */
export interface CaptionExplainAsk { type: "distill:caption:explainAsk"; tabId: number; id: string; term: string; sentence: string; spelled?: string }
export function isCaptionExplainAsk(m: unknown): m is CaptionExplainAsk {
  const x = m as Partial<CaptionExplainAsk> | null;
  return !!x && x.type === "distill:caption:explainAsk" && typeof x.tabId === "number" && typeof x.id === "string" && typeof x.term === "string";
}

/** What happened to a cookie banner (r3-04): its reject button pressed, only hidden, none on the page, or the switch off. */
export type ConsentOutcome = "rejected" | "hidden" | "none" | "off";

/** An action found on the page (r3-09): page words only. */
export type ActionItem = FoundAction;

/** Caption frame -> service worker (r3-07): the ECB's daily rates, fetched at most once a day and kept on the device.
 *  The request carries nothing about the page or the person. */
export interface RatesRequest { type: "distill:rates" }
export function isRatesRequest(m: unknown): m is RatesRequest {
  return !!m && (m as Partial<RatesRequest>).type === "distill:rates";
}
/** The service worker's answer: the rates, or null when none could be had (offline and none kept). */
export type RatesReply = Rates | null;

/** A claim to mark on the page (r2-01): page text only. `verdict` once checked on the web (r2-02). */
export interface ClaimMark { id: string; blockId: string; text: string; verdict?: ClaimVerdict }

/** The page's title and address (r2-02, r2-08). */
export interface PageInfo { title: string; url: string; origin: string }

/** A block of the main text by its id (#10). `text` is page text or its translation: it never leaves the browser. */
export interface TextBlock { id: string; text: string }

/** Contact details found on the page (#5): page text (a shop's phone number), never anything the person typed. */
export interface ContactItem {
  /** `k0`, `k1`, ... stable while the caption is open. */
  id: string;
  kind: "phone" | "email" | "address" | "hours" | "contactPage";
  /** As shown to the person: "+420 377 912 345", "Po-Pá 8:00-17:00". */
  text: string;
  /** tel:, mailto: or the contact page's https: address. Omitted for an address or hours. */
  href?: string;
  /** Clean hid the part of the page it was found in. */
  hidden: boolean;
}

/** How far the page's form is filled (#9). Counts only: never a value, never a label. */
export interface FormProgress {
  fields: number;
  filled: number;
  required: number;
  requiredLeft: number;
  /** Error messages the page shows now (the engine's readErrors). */
  errors: number;
}

/** Content script -> the caption frame (chrome.runtime.sendMessage), when the page side changed the report by itself:
 *  Stay clean removed something new (#3). The frame takes only the update for its own tab. */
export interface CaptionUpdate { type: "distill:caption:update"; tabId: number; report: CleanReport }

export function isCaptionUpdate(m: unknown): m is CaptionUpdate {
  const x = m as Partial<CaptionUpdate> | null;
  return !!x && x.type === "distill:caption:update" && typeof x.tabId === "number" && !!x.report;
}

/** Content script -> the caption frame: the page added or rewrote text of its main column while a translation is on it
 *  (#10). A count of blocks waiting, never their words: the frame asks distill:caption:blocks for them. */
export interface CaptionMoreText { type: "distill:caption:moreText"; tabId: number; count: number }

export function isCaptionMoreText(m: unknown): m is CaptionMoreText {
  const x = m as Partial<CaptionMoreText> | null;
  return !!x && x.type === "distill:caption:moreText" && typeof x.tabId === "number" && typeof x.count === "number";
}

/** What Clean did, for the caption's status line and "What was removed". Labels and kinds only: no page text. */
export interface CleanReport {
  items: ClutterItem[];
  /** Ids of items the person brought back. */
  restored: string[];
  /** The page's language (PageModel.lang), so the caption can offer a translation. */
  lang: string;
  kind: PageKind;
  /** The page scrolled no more while a cookie wall or pop-up was up; Clean let it scroll again. */
  unlockedScroll: boolean;
  /** Where `lang` came from: the page's lang attribute, its words (engine detectLang, #2), or neither ("und"). */
  langFrom: "page" | "text" | "none";
  /** Boxes of the main column widened into the room Clean freed (#1). 0: nothing needed it. */
  widened: number;
  /** Main-text blocks the reading comfort layer changes (#6). 0: the page reads well as it is. */
  comfort: number;
  /** Media Calm paused and moving things it stopped (#8). */
  calm: { media: number; motion: number };
  /** Sticky headers made to scroll with the page instead of covering it (#4). */
  unstuck: number;
  /** Tables of the main text made readable: header kept in view, wide ones scroll inside themselves (r2-05). */
  tables: number;
  /** What Clean did with a cookie banner (r3-04). Absent: the page side has not decided (older reports, tests). */
  consent?: ConsentOutcome;
}

/** What distill:locate points at: a block of the PageModel or the fields of a form step (the shared UI's LocateTarget). */
export type LocateTarget = { blockId: string } | { fieldIds: string[] };

export interface ContentReplies {
  "distill:ping": { ready: true };
  "distill:getPage": PageModel;
  "distill:getForm": FormStructure;
  "distill:readValues": FormValues;
  "distill:writeValues": { written: string[]; failed: string[] };
  "distill:readErrors": FormErrors;
  "distill:highlight": { ok: true };
  /** Computed colours, fonts and radius only (see pageTheme.ts): no value, no text. */
  "distill:getTheme": PageThemeSeed;
  "distill:locate": { ok: true };
  /** Labels, kinds and link addresses (origin + path): never a value typed into the page. */
  "distill:listActions": PageAction[];
  "distill:doAction": { ok: true };
  "distill:caption:open": { open: boolean };
  "distill:caption:clean": CleanReport;
  "distill:caption:restore": CleanReport;
  "distill:caption:original": { ok: true };
  "distill:caption:size": { height: number };
  "distill:caption:close": { ok: true };
  "distill:caption:comfort": { comfort: number };
  "distill:caption:play": { ok: true };
  "distill:caption:contact": ContactItem[];
  "distill:caption:showContact": { ok: true };
  "distill:caption:form": FormProgress | null;
  "distill:caption:nextField": FormProgress | null;
  "distill:caption:blocks": TextBlock[];
  "distill:caption:translated": { applied: number };
  "distill:caption:sourceText": { ok: true };
  "distill:caption:watchText": { ok: true };
  "distill:caption:pageInfo": PageInfo;
  "distill:caption:markClaims": { marked: number };
  "distill:caption:showText": { found: boolean };
  "distill:caption:clearClaims": { ok: true };
  "distill:caption:mainText": TextBlock[];
  "distill:caption:tables": { tables: number };
  "distill:caption:links": { ok: true };
  // round 2: plain words (r2-04)
  "distill:caption:plainBlocks": TextBlock[];
  "distill:caption:plainText": { applied: number };
  /** Blocks showing plain words now. */
  "distill:caption:plainShown": { shown: number };
  // round 3
  "distill:caption:consent": { consent: ConsentOutcome };
  /** `alreadyDark`: the page was dark already, so nothing was changed. */
  "distill:caption:dark": { dark: boolean; alreadyDark: boolean };
  "distill:caption:byline": Byline;
  "distill:caption:terms": { prices: number; dates: number };
  "distill:caption:actions": ActionItem[];
  "distill:caption:markActions": { marked: number };
  "distill:caption:showAction": { found: boolean };
  // round 4
  "distill:caption:formText": TextBlock[];
  "distill:caption:formTranslated": { applied: number };
  "distill:caption:formErrors": TextBlock[];
  "distill:caption:formErrorsTranslated": { applied: number };
  "distill:caption:formSource": { ok: true };
  "distill:caption:explainShow": { ok: true };
  "distill:caption:video": VideoInfo | null;
  "distill:caption:seek": { ok: boolean };
  "distill:caption:product": ProductFacts | null;
  "distill:caption:showProduct": { found: boolean };
  "distill:caption:tour": { found: boolean };
}

/**
 * Content script -> side panel (chrome.runtime.sendMessage): the page changed in a way that matters - form controls
 * came or went, the main text changed by more than a little, or the address changed without a load (history).
 * It carries no page content; the panel reads the page again itself.
 */
export interface PageChanged { type: "distill:pageChanged"; reason: "mutation" | "history" }

export function isPageChanged(m: unknown): m is PageChanged {
  const x = m as Partial<PageChanged> | null;
  return !!x && x.type === "distill:pageChanged" && (x.reason === "mutation" || x.reason === "history");
}

export type ContentResponse<T> = { ok: true; data: T } | { ok: false; error: string };

export const HANDRAIL_PORT = "handrail";
/** Native messaging host name registered by tools/handrail (see its PROTOCOL.md). */
export const HANDRAIL_NATIVE_HOST = "dev.distill.handrail";
