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
  | { type: "distill:caption:close" };

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
