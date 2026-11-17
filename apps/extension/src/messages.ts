// Messages between the side panel and the content script. Structure and values travel only inside the browser
// (chrome.tabs.sendMessage); nothing here leaves the device.
import type { FormStructure, FormValues, PageModel } from "@distill/engine";

export type ContentRequest =
  | { type: "distill:ping" }
  | { type: "distill:getPage" }
  | { type: "distill:getForm"; formIndex: number }
  | { type: "distill:readValues"; structure: FormStructure }
  | { type: "distill:writeValues"; structure: FormStructure; values: FormValues }
  | { type: "distill:highlight"; fieldIds: string[] };

export interface ContentReplies {
  "distill:ping": { ready: true };
  "distill:getPage": PageModel;
  "distill:getForm": FormStructure;
  "distill:readValues": FormValues;
  "distill:writeValues": { written: string[]; failed: string[] };
  "distill:highlight": { ok: true };
}

export type ContentResponse<T> = { ok: true; data: T } | { ok: false; error: string };

export const HANDRAIL_PORT = "handrail";
/** Native messaging host name registered by tools/handrail (see its PROTOCOL.md). */
export const HANDRAIL_NATIVE_HOST = "dev.distill.handrail";
