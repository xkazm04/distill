// "Your agent is the AI": the pure parts of Distill's agent path. The person's own CLI agent (Claude Code or agy) can
// do Distill's page and structure work over Handrail; its answers pass the SAME doors as a model's (parseSimplified,
// parseWizard, validateAndRepair) and are bound to the page they were made for by `pageToken`. A values task is never
// handed to an agent. Page actions are listed by label only: a typed value never leaves the page this way.
import type { Block, FormStructure, PageModel, Task } from "./types.js";
import { attr, collapse, isHidden, tag } from "./dom.js";
import { errorElements } from "./errors.js";
import { listForms } from "./form.js";
import { validateAndRepair } from "./repair.js";
import { route } from "./route.js";
import { cleanText, hasScriptUrl, isObj } from "./sanitize.js";
import { publicUrl } from "./url.js";
import { parseWizard } from "./wizard.js";

const hex = (buf: ArrayBuffer): string => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * sha-256 hex of `page.url + "\n"` + one `id:text` line per block. It names the page an agent read, so an answer or an
 * action proposal made for it can be refused once the page has changed. Text only: never a typed value.
 */
export async function pageToken(page: PageModel): Promise<string> {
  const text = page.url + "\n" + page.blocks.map((b) => `${b.id}:${b.text}`).join("\n");
  return hex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Block id -> simpler text. */
export type Simplified = Record<string, string>;

/** Reads schemas.simplify ({blocks:[{id,text}]}) and the shapes a model plausibly returns anyway: [{id,text}] or
 *  {id: text}. Unknown ids and empty texts are ignored. The one door for simplified text. */
export function parseSimplified(data: unknown, blocks: Block[]): Simplified {
  return readSimplified(data, blocks).out;
}

function readSimplified(data: unknown, blocks: Block[]): { out: Simplified; offered: number; errors: string[]; emptyList: boolean } {
  const ids = new Set(blocks.map((b) => b.id));
  const out: Simplified = {};
  const errors: string[] = [];
  let offered = 0;
  const list = Array.isArray(data) ? data : Array.isArray((data as { blocks?: unknown })?.blocks) ? (data as { blocks: unknown[] }).blocks : null;
  if (list) {
    list.forEach((item, i) => {
      offered++;
      const { id, text } = (item ?? {}) as { id?: unknown; text?: unknown };
      if (typeof id !== "string" || typeof text !== "string") errors.push(`Item ${i + 1}: needs a string "id" and a string "text"`);
      else if (!ids.has(id)) errors.push(`Item ${i + 1}: "${cleanText(id, 40)}" is not a block of this page`);
      else if (!text.trim()) errors.push(`Item ${i + 1}: the text is empty`);
      else out[id] = text;
    });
  } else if (isObj(data)) {
    for (const [id, text] of Object.entries(data)) {
      offered++;
      if (typeof text === "string" && text.trim() && ids.has(id)) out[id] = text;
      else errors.push(`"${cleanText(id, 40)}" is not a block of this page with text`);
    }
  } else {
    errors.push('The answer must be an object like {"blocks":[{"id":"b0","text":"..."}]}');
  }
  return { out, offered, errors, emptyList: !!list && list.length === 0 };
}

// ---- the agent's work queue: which tasks, and the door each answer passes ------------------------------------------

/** The tasks an agent may do: each has a door. Page and structure only; a values task is never among them. */
export const AGENT_TASKS = ["simplifyBlocks", "recast", "buildWizard"] as const satisfies readonly Task[];
export type AgentTask = (typeof AGENT_TASKS)[number];

/** True when `task` may be posted to the person's agent: it has a door and it carries no person's values. */
export function agentCanDo(task: Task): task is AgentTask {
  return (AGENT_TASKS as readonly string[]).includes(task) && route(task).promptClass !== "values";
}

/** What a door needs besides the answer: the page or form the task was made from (kept in the panel, never sent). */
export interface DoorContext {
  page?: PageModel;
  structure?: FormStructure;
  readerLang?: string;
  /** Recast: the section kinds switched on. */
  kinds?: readonly string[];
}

/** What `distill_answer` returns, so the agent can retry. */
export interface AgentVerdict {
  accepted: boolean;
  /** Parts of the answer that could not be used. */
  dropped: number;
  /** Plain reasons, at most 10. */
  errors: string[];
}

const capped = (errors: string[]): string[] => (errors.length > 10 ? [...errors.slice(0, 9), `...and ${errors.length - 9} more`] : errors);

/**
 * The door an agent's answer passes for `task`: the same function a model's answer passes. Nothing is accepted that
 * the door would not keep; `accepted` is false when nothing usable is left.
 */
export function agentDoor(task: Task, data: unknown, ctx: DoorContext): AgentVerdict {
  if (!agentCanDo(task)) return { accepted: false, dropped: 0, errors: [`"${task}" is not a task for an agent`] };
  if (hasScriptUrl(data)) return { accepted: false, dropped: 1, errors: ["The answer contains a script link"] };
  switch (task) {
    case "simplifyBlocks": {
      if (!ctx.page) return { accepted: false, dropped: 0, errors: ["The page for this task is gone"] };
      const r = readSimplified(data, ctx.page.blocks);
      const kept = Object.keys(r.out).length;
      // An explicit empty list is a real answer: every block was already plain enough.
      return { accepted: kept > 0 || r.emptyList, dropped: r.offered - kept, errors: capped(r.errors) };
    }
    case "buildWizard": {
      if (!ctx.structure) return { accepted: false, dropped: 0, errors: ["The form for this task is gone"] };
      const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.steps) ? data.steps : null;
      if (!list) return { accepted: false, dropped: 1, errors: ['The answer must be an object like {"steps":[...]}'] };
      // The same door with no required field, so it adds none of its own fallback steps: what is left is the agent's.
      const open = { ...ctx.structure, fields: ctx.structure.fields.map((f) => ({ ...f, required: false })) };
      const kept = parseWizard(data, open, ctx.readerLang ?? "en").steps.length;
      const known = new Set(ctx.structure.fields.map((f) => f.fieldId));
      const errors: string[] = [];
      list.forEach((raw, i) => {
        if (!isObj(raw)) errors.push(`Step ${i + 1}: not an object`);
        else if (!Array.isArray(raw.fieldIds) || !raw.fieldIds.some((x) => typeof x === "string" && known.has(x))) errors.push(`Step ${i + 1}: "fieldIds" names no field of this form`);
      });
      return { accepted: kept > 0, dropped: list.length - kept, errors: capped(errors) };
    }
    case "recast": {
      const r = validateAndRepair(data, ctx.kinds);
      return { accepted: r.nodes.length > 0, dropped: r.dropped, errors: capped(r.reasons) };
    }
  }
}

// ---- page actions: what the agent may propose to click --------------------------------------------------------------

export type PageActionKind = "button" | "link" | "submit";

/** One thing on the page a person could click. Its label only: never a value typed into the page. */
export interface PageAction {
  /** `a0`, `a1`, ... in document order, stable within one listing. */
  actionId: string;
  label: string;
  kind: PageActionKind;
  /** Links only: where it leads, origin + path (no query, no fragment: they can hold a person's data). */
  href?: string;
}

export const MAX_ACTIONS = 60;
const ACTION_SELECTOR = "a[href], button, input[type=submit], input[type=button], input[type=image], [role=button], [role=link]";

function hiddenOrDisabled(el: Element, isError: (el: Element) => boolean): boolean {
  // A link in an error message (an error summary links each message to its field) is labelled with the message, which
  // can repeat what the person typed: it is never offered.
  for (let e: Element | null = el; e && tag(e) !== "body"; e = e.parentElement) if (isHidden(e) || isError(e)) return true;
  return el.hasAttribute("disabled") || attr(el, "aria-disabled").toLowerCase() === "true";
}

/** The visible words of a control: aria-label, its text, an input's own label attribute, a title, an image's alt. */
function labelOf(el: Element): string {
  const t = tag(el);
  const own = attr(el, "aria-label");
  // For input[type=submit|button] the value attribute IS the button's label as written in the page's markup.
  const inputLabel = t === "input" ? attr(el, "value") || attr(el, "alt") : "";
  const text = t === "input" ? "" : collapse(el.textContent ?? "");
  const img = el.querySelector("img[alt]")?.getAttribute("alt") ?? "";
  return cleanText(own || text || inputLabel || attr(el, "title") || img, 100) ?? "";
}

function kindOf(el: Element): PageActionKind | null {
  const t = tag(el);
  const type = attr(el, "type").toLowerCase();
  if (t === "a") return "link";
  if (t === "button") {
    if (type === "reset") return null; // clearing the person's answers is never offered
    const inForm = !!el.closest("form") || el.hasAttribute("form");
    return type === "button" || (!inForm && type !== "submit") ? "button" : "submit";
  }
  if (t === "input") return type === "submit" || type === "image" ? "submit" : "button";
  return attr(el, "role").toLowerCase() === "link" ? "link" : "button";
}

/**
 * The page's clickable controls, by label. `onElement` lets the content script keep each element (never sent).
 * Hidden, disabled and reset controls, controls with no words, script links and controls inside the page's error
 * messages are left out.
 */
export function extractActions(doc: Document, url: string, onElement?: (actionId: string, el: Element) => void): PageAction[] {
  const out: PageAction[] = [];
  const isError = errorElements(listForms(doc).length > 0);
  for (const el of Array.from(doc.querySelectorAll(ACTION_SELECTOR))) {
    if (out.length >= MAX_ACTIONS) break;
    if (hiddenOrDisabled(el, isError)) continue;
    const kind = kindOf(el);
    const label = labelOf(el);
    if (!kind || !label) continue;
    const action: PageAction = { actionId: `a${out.length}`, label, kind };
    if (tag(el) === "a") {
      const raw = attr(el, "href").trim();
      if (hasScriptUrl(raw)) continue;
      let abs = "";
      try { abs = new URL(raw, url).href; } catch { /* no usable address */ }
      const href = publicUrl(abs);
      if (href) action.href = href;
    }
    onElement?.(action.actionId, el);
    out.push(action);
  }
  return out;
}
