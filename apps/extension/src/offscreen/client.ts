// The caption frame's side of the offscreen document (protocol.ts): whether the page forbids the on-device model in
// this frame, and run() through the offscreen document when it does.
import type { LocalModelState, Task } from "@distill/engine";
import { AiError, type RunContext, type RunResult } from "@distill/web/ai";
import { OFFSCREEN_PORT, type OffscreenAnswer, type OffscreenAsk, type OffscreenFake, type OffscreenStateAnswer, type OffscreenStateAsk } from "./protocol";

interface PolicyDoc { featurePolicy?: { allowsFeature(f: string): boolean; features(): string[] } }

/**
 * True when the page this frame sits in forbids the on-device model here: it sends `Permissions-Policy:
 * language-model=()`, or a policy that names only its own origin. The frame cannot tell from LanguageModel itself: there
 * it says "unavailable" (measured in Chromium 2026-11-22), and the SDK would then send a page task to the cloud though
 * the device could run it. A browser that does not know the feature is not blocked by it.
 */
export function deviceModelBlocked(doc: Document = document): boolean {
  const fp = (doc as Document & PolicyDoc).featurePolicy;
  if (!fp || typeof fp.allowsFeature !== "function") return false;
  try {
    if (typeof fp.features === "function" && !fp.features().includes("language-model")) return false;
    return !fp.allowsFeature("language-model");
  } catch {
    return false;
  }
}

let port: chrome.runtime.Port | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: (r: RunResult<unknown>) => void; fail: (e: unknown) => void }>();
const states = new Map<number, { ok: (s: LocalModelState) => void; fail: (e: unknown) => void }>();

/** The port to the service worker, held while this frame lives: the worker closes the offscreen document once no
 *  caption holds one. */
function connect(): chrome.runtime.Port {
  if (port) return port;
  const p = chrome.runtime.connect({ name: OFFSCREEN_PORT });
  p.onMessage.addListener((a: OffscreenAnswer | OffscreenStateAnswer) => {
    const s = states.get(a.id);
    if (s) {
      states.delete(a.id);
      if (a.ok && "modelState" in a) s.ok(a.modelState);
      else s.fail(new AiError(a.ok ? "other" : a.kind));
      return;
    }
    if ("modelState" in a) return;
    const w = waiting.get(a.id);
    if (!w) return;
    waiting.delete(a.id);
    if (a.ok) w.ok(a.result);
    else w.fail(new AiError(a.kind));
  });
  p.onDisconnect.addListener(() => {
    if (port === p) port = null;
    // The worker went away mid-task (it was stopped or updated): those tasks failed; the next one connects again.
    for (const [id, w] of waiting) { waiting.delete(id); w.fail(new AiError("other")); }
    for (const [id, s] of states) { states.delete(id); s.fail(new AiError("other")); }
  });
  port = p;
  return p;
}

/** run() in the offscreen document: the same task, prompt and schema; the answer's source and reason are the run's. */
export function runOffscreen<T>(task: Task, prompt: string, schema: object | null, context: RunContext, fake?: OffscreenFake): Promise<RunResult<T>> {
  return new Promise<RunResult<T>>((ok, fail) => {
    const id = nextId++;
    waiting.set(id, { ok: ok as (r: RunResult<unknown>) => void, fail });
    const ask: OffscreenAsk = { id, task, prompt, schema, context, ...(fake ? { fake } : {}) };
    try {
      connect().postMessage(ask);
    } catch (e) {
      waiting.delete(id);
      fail(e);
    }
  });
}

/** The on-device model's state, read in the offscreen document (More's model line on a site that blocks the model in
 *  frames: there the frame's own LanguageModel says "unavailable" whatever the device can do). */
export function offscreenModelState(): Promise<LocalModelState> {
  return new Promise<LocalModelState>((ok, fail) => {
    const id = nextId++;
    states.set(id, { ok, fail });
    const ask: OffscreenStateAsk = { id, state: true };
    try {
      connect().postMessage(ask);
    } catch (e) {
      states.delete(id);
      fail(e);
    }
  });
}
