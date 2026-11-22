// The offscreen document (docs/caption.md, risk 1): where the caption runs an AI task when the page it sits in forbids
// the on-device model in frames (`Permissions-Policy: language-model=()`, or a policy that does not name Distill). The
// caption frame asks the service worker over a port; the worker opens the offscreen document when it is first needed,
// relays the task to it and closes it once no caption holds a port. The task runs there through the same run() as in
// the frame, so the answer carries the same `source` and `reason` and the chip stays true. Nothing here leaves the
// browser: page text goes from the frame to the worker to the offscreen document, all of them Distill's own.
import { route, type InferenceSource, type Task } from "@distill/engine";
import type { AiFailure, RunContext, RunResult } from "@distill/web/ai";

/** The caption frame's port to the service worker, held while the frame may need the offscreen document. */
export const OFFSCREEN_PORT = "distill:offscreen";
export const OFFSCREEN_URL = "offscreen.html";
/** What Chrome shows for the document (chrome://extensions): it runs Distill's on-device AI. */
export const OFFSCREEN_JUSTIFICATION =
  "Runs Distill's on-device AI model for the caption on a site whose policy blocks the model inside frames.";

/** E2E ONLY: the stand-in model's switch (Translate.tsx). An offscreen document cannot read chrome.storage.session, so
 *  an e2e build passes it along with the task; every other build never sets it. */
export interface OffscreenFake { fail?: string; source?: InferenceSource; delayMs?: number }

/** One task, as the frame asks for it (the port carries an id so answers find their question). */
export interface OffscreenAsk {
  id: number;
  task: Task;
  prompt: string;
  schema: object | null;
  context: RunContext;
  fake?: OffscreenFake;
}

export type OffscreenReply =
  | { ok: true; result: RunResult<unknown> }
  /** `refused`: a task the offscreen document never runs (a person's values). */
  | { ok: false; kind: AiFailure; refused?: "values" };

export type OffscreenAnswer = OffscreenReply & { id: number };

/** Service worker -> the offscreen document (chrome.runtime.sendMessage). */
export interface OffscreenRun { type: "distill:offscreen:run"; ask: Omit<OffscreenAsk, "id"> }

export function isOffscreenRun(m: unknown): m is OffscreenRun {
  const x = m as Partial<OffscreenRun> | null;
  return !!x && x.type === "distill:offscreen:run" && !!x.ask && typeof x.ask.task === "string" && typeof x.ask.prompt === "string";
}

export interface AnswerDeps {
  run: (task: Task, prompt: string, schema: object | null, context: RunContext) => Promise<RunResult<unknown>>;
  /** E2E only: the stand-in model, when the ask carries its switch. */
  fake?: (ask: Omit<OffscreenAsk, "id">) => Promise<RunResult<unknown>>;
  kindOf: (e: unknown) => AiFailure;
}

/**
 * The offscreen document's one door. A `values`-class task (a person's own answers) is refused before anything runs:
 * the caption sends only page text this way, and a person's values have their own device-only path in the panel.
 */
export async function answer(ask: Omit<OffscreenAsk, "id">, deps: AnswerDeps): Promise<OffscreenReply> {
  // Only page and structure tasks; anything else (a values task, a task this build does not know) is refused.
  const promptClass = route(ask.task).promptClass as string | undefined;
  if (promptClass !== "page" && promptClass !== "structure") return { ok: false, kind: "other", refused: "values" };
  try {
    const result = ask.fake && deps.fake ? await deps.fake(ask) : await deps.run(ask.task, ask.prompt, ask.schema, ask.context);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, kind: deps.kindOf(e) };
  }
}
