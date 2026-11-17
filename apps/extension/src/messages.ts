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
  | { type: "distill:getTheme" };

export interface ContentReplies {
  "distill:ping": { ready: true };
  "distill:getPage": PageModel;
  "distill:getForm": FormStructure;
  "distill:readValues": FormValues;
  "distill:writeValues": { written: string[]; failed: string[] };
  "distill:highlight": { ok: true };
  /** Computed colours, fonts and radius only (see pageTheme.ts): no value, no text. */
  "distill:getTheme": PageThemeSeed;
}

export type ContentResponse<T> = { ok: true; data: T } | { ok: false; error: string };

export const HANDRAIL_PORT = "handrail";
/** Native messaging host name registered by tools/handrail (see its PROTOCOL.md). */
export const HANDRAIL_NATIVE_HOST = "dev.distill.handrail";
