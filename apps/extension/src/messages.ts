// Messages between the side panel and the content script. Structure and values travel only inside the browser
// (chrome.tabs.sendMessage); nothing here leaves the device.
import type { FormStructure, FormValues, PageModel } from "@distill/engine";
import type { PageThemeSeed } from "@distill/web/ui/theme/roles";

export type ContentRequest =
  | { type: "distill:ping" }
  | { type: "distill:getPage" }
  | { type: "distill:getForm"; formIndex: number }
  | { type: "distill:readValues"; structure: FormStructure }
  | { type: "distill:writeValues"; structure: FormStructure; values: FormValues }
  /** `color`: the side panel's accent at call time; the content script normalises it or falls back. */
  | { type: "distill:highlight"; fieldIds: string[]; color?: string }
  | { type: "distill:getTheme" }
  /** Outline a block of the last read (by its id) or a step's fields in the focus colour, and scroll it into view;
   *  null clears it. Never touches the outline of filled fields (distill:highlight). */
  | { type: "distill:locate"; target: LocateTarget | null; color?: string };

/** What distill:locate points at: a block of the PageModel or the fields of a form step (the shared UI's LocateTarget). */
export type LocateTarget = { blockId: string } | { fieldIds: string[] };

export interface ContentReplies {
  "distill:ping": { ready: true };
  "distill:getPage": PageModel;
  "distill:getForm": FormStructure;
  "distill:readValues": FormValues;
  "distill:writeValues": { written: string[]; failed: string[] };
  "distill:highlight": { ok: true };
  /** Computed colours, fonts and radius only (see pageTheme.ts): no value, no text. */
  "distill:getTheme": PageThemeSeed;
  "distill:locate": { ok: true };
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
