// Messages between the side panel and the content script. Structure and values travel only inside the browser
// (chrome.tabs.sendMessage); nothing here leaves the device.
import type { ClutterItem, FormErrors, FormStructure, FormValues, PageAction, PageKind, PageModel } from "@distill/engine";
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
  | { type: "distill:caption:open"; tabId: number; toggle?: boolean }
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
  | { type: "distill:caption:sourceText"; on: boolean };

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
