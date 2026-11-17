// The one wrapper every AI call goes through. It asks the engine's Sieve (`route`) where the task may run, builds the
// Firebase AI Logic model for that decision, and reports where it ran (from the SDK response, not from a guess).
import { getGenerativeModel, type InferenceMode as SdkMode } from "firebase/ai";
import { engine, type InferenceSource, type LocalModelState, type RouteDecision, type Task } from "./ui/engine";
import { getFirebase, isFirebaseConfigured, remoteValue } from "./firebase";
import { agentQueue, AgentStop, type AgentStopKind } from "./ui/agentQueue";

export interface RunResult<T> {
  data: T;
  source: InferenceSource;
  ms: number;
  /** The Sieve's plain-words reason, shown on hover of the source chip. */
  reason: string;
}

/** The ONE place a person's-values task is pinned to the device. A `values` prompt never gets a cloud model. */
const VALUES_TASK_MODE = "only_on_device" as const;

/**
 * The public extension build (VITE_EXT_VARIANT=public) runs EVERY task on the device: no task gets a cloud model, so
 * the build needs no App Check and can be shared. The comparison is replaced at build time; in tests it reads the
 * stubbed env. The web app and the build-it-yourself extension ("own") are not this build.
 */
export function isOnDeviceOnlyBuild(): boolean {
  return import.meta.env.VITE_EXT_VARIANT === "public";
}

/** What the model card says in the on-device-only build. */
export const ON_DEVICE_ONLY_NOTE = "This version of Distill works only with the AI model on this device. Nothing is sent to the cloud.";

/** What went wrong, as a kind the surfaces can design for. The message is always plain words. */
export type AiFailure =
  | "busy" | "not-genuine" | "device-only" | "not-configured" | "other"
  | "agent-timeout" | "agent-cancelled" | "agent-stale" | "agent-gone";

/** Every sentence a person can see about a failed AI call. Raw SDK text never reaches the screen. */
export const AI_WORDS: Record<AiFailure, string> = {
  busy: "The AI is busy right now. Try again in a moment.",
  "not-genuine": "This app could not prove it is genuine to the AI service.",
  "device-only": isOnDeviceOnlyBuild()
    ? "This version of Distill uses only the AI model on this device, and it is not ready on this device."
    : "Suggestions and checks only run on this device, and this device has no model for them. Type your answers instead.",
  "not-configured": "AI features are off in this copy of Distill.",
  other: "Something went wrong with the AI.",
  "agent-timeout": "Your agent did not answer in time.",
  "agent-cancelled": "You stopped waiting for your agent.",
  "agent-stale": "The page changed while your agent was working on it.",
  "agent-gone": "The connection to your agent stopped before it answered.",
};

const AGENT_FAILURE: Record<AgentStopKind, AiFailure> = {
  timeout: "agent-timeout", cancelled: "agent-cancelled", stale: "agent-stale", gone: "agent-gone",
};

/** The source chip's reason for an answer made by the person's agent. */
export const AGENT_REASON = "Made by your own agent (Claude Code or agy) on this computer, from the page text. Distill checked it like its own AI's answers.";

/** A failed AI call in plain words. `retry` says whether trying again can help, so a surface offers "Try again". */
export class AiError extends Error {
  readonly retry: boolean;
  constructor(readonly kind: AiFailure) {
    super(AI_WORDS[kind]);
    this.name = "AiError";
    this.retry = kind === "busy" || kind === "other" || kind.startsWith("agent-");
  }
}

export class NotConfiguredError extends AiError {
  constructor() {
    super("not-configured");
  }
}

/** The status an SDK error carries: `customErrorData.status`, else the "[503 ...]" the SDK writes into the message. */
function statusOf(e: unknown, raw: string): number | undefined {
  const s = (e as { customErrorData?: { status?: unknown } } | null)?.customErrorData?.status;
  if (typeof s === "number") return s;
  const m = /\[(\d{3})\b/.exec(raw);
  return m ? Number(m[1]) : undefined;
}

/**
 * The ONE place a failure becomes words. `valuesTask` is true when the prompt carried a person's values, so a missing
 * local model is the device-only case (there is no cloud fallback by law), never a generic error.
 */
export function toAiError(e: unknown, valuesTask = false): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof AgentStop) return new AiError(AGENT_FAILURE[e.kind]);
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const code = (e as { code?: unknown } | null)?.code;
  const status = statusOf(e, raw);
  const noLocalModel = /on-device model is not available|LanguageModel API not available|ONLY_ON_DEVICE/i.test(raw);
  if (noLocalModel || (valuesTask && code === "unsupported")) return new AiError("device-only");
  if (code === "api-not-enabled") return new AiError("other"); // the project's set-up, not the app's identity
  if (status === 401 || status === 403 || /app ?check/i.test(raw)) return new AiError("not-genuine");
  if ((status !== undefined && (status === 429 || status >= 500)) || isTransient(e) || (e instanceof Error && e.name === "AbortError")) {
    return new AiError("busy");
  }
  return new AiError("other");
}

/** The words to show for any error from `run()`. Surfaces call this instead of reading `e.message`. */
export function aiWords(e: unknown): string {
  return toAiError(e).message;
}

/** What a task was made from: the dev fake AI reads it, and the agent's door checks an answer against it. */
export type RunContext = import("./dev/fake-ai").FakeContext & { readerLang?: string; kinds?: readonly string[] };

/** True when an AI result can be made here at all: Firebase is set up, the dev fake AI runs, or the agent does it. */
export function aiAvailable(agentActive = agentQueue.active()): boolean {
  return isFirebaseConfigured() || import.meta.env.DEV || agentActive;
}

/**
 * Run one task. `schema` is a JSON Schema: it constrains the on-device model (`responseConstraint`) and the cloud
 * model (`responseJsonSchema`). With `schema === null` the reply is plain text and `data` is that string.
 * Every failure leaves here as an `AiError` in plain words; the raw error goes to the console only.
 *
 * When the person chose "My agent" and the helper program is connected, a page or structure task with a door goes to
 * the agent's work queue instead (source "agent"). A values task never does: it stays on the device.
 */
export async function run<T = unknown>(task: Task, prompt: string, schema: object | null, devContext: RunContext = {}): Promise<RunResult<T>> {
  try {
    if (agentQueue.active() && engine.route(task).promptClass !== "values" && engine.agentCanDo(task)) {
      const started = performance.now();
      const out = await agentQueue.post(task, prompt, schema, devContext);
      if (out.kind === "answer") return { data: out.data as T, source: "agent", ms: Math.round(performance.now() - started), reason: AGENT_REASON };
      // The person pressed "Use Distill's AI instead": the usual way, below.
    }
    return await runRaw<T>(task, prompt, schema, devContext);
  } catch (e) {
    const err = toAiError(e, isOnDeviceOnlyBuild() || engine.route(task).promptClass === "values");
    if (err !== e) console.warn(`[distill] AI task "${task}" failed (${err.kind}):`, e);
    throw err;
  }
}

async function runRaw<T>(task: Task, prompt: string, schema: object | null, devContext: import("./dev/fake-ai").FakeContext): Promise<RunResult<T>> {
  const started = performance.now();

  if (import.meta.env.DEV && !isFirebaseConfigured()) {
    const fake = await import("./dev/fake-ai");
    await fake.fakeDelay(globalThis.location?.search);
    const r = fake.fakeRun(task, devContext, new URLSearchParams(globalThis.location?.search ?? "").get("aifail"));
    return { data: r as T, source: "on_device", ms: Math.round(performance.now() - started), reason: "Fake AI (dev only)" };
  }

  const services = await getFirebase();
  if (!services) throw new NotConfiguredError();

  // The on-device-only build asks the Sieve for its own only_on_device mode for every task (its words say so on hover).
  const onDeviceOnly = isOnDeviceOnlyBuild();
  const decision = await engine.route(task, onDeviceOnly ? VALUES_TASK_MODE : remoteValue(services, "inference_mode"));
  const isValues = decision.promptClass === "values";
  const pinned = isValues || onDeviceOnly;
  const mode = pinned ? VALUES_TASK_MODE : decision.mode;
  if (pinned && decision.mode !== VALUES_TASK_MODE) {
    throw new Error(`Sieve routed a device-only task to ${decision.mode}; refusing to send it anywhere but the device.`);
  }
  // ONLY_ON_DEVICE alone does not keep a prompt on the device: when the browser has no LanguageModel at all, the SDK
  // builds no on-device adapter and sends EVERY mode to the cloud (@firebase/ai 13.4.0 chromeAdapterFactory returns
  // undefined -> callCloudOrDevice -> inCloudCall). So the law is enforced here, before a model object exists.
  if (pinned && typeof LanguageModel === "undefined") throw new AiError("device-only");
  // The on-device-only build also refuses a model that is not ready yet: the SDK would start a download in the middle
  // of a task. The model card offers the download instead.
  if (onDeviceOnly && (await localModelState()) !== "available") throw new AiError("device-only");

  const model = getGenerativeModel(
    services.ai,
    {
      // The engine's mode strings are the SDK's InferenceMode strings, exactly.
      mode: mode as SdkMode,
      onDeviceParams: schema ? { promptOptions: { responseConstraint: schema } } : undefined,
      // A values task (and every task in the on-device-only build) has no cloud configuration at all, so there is
      // nothing to fall back to.
      inCloudParams: pinned
        ? undefined
        : {
            model: remoteValue(services, "cloud_model"),
            generationConfig: schema
              ? { responseMimeType: "application/json", responseJsonSchema: schema as { [k: string]: unknown } }
              : undefined,
          },
    },
    // The SDK's default is 180 s, which a person reads as a frozen screen. Measured 2026-11-17 on the live app: the
    // wizard answers in 3-8 s, and a "high demand" 500 left Wayfill on "Reading the form..." for over a minute.
    { timeout: CLOUD_TIMEOUT_MS },
  );

  const result = await withRetry(() => model.generateContent(prompt));
  const text = result.response.text();
  const data = (schema ? JSON.parse(stripFence(text)) : text) as T;
  return { data, source: sourceOf(result.response.inferenceSource, decision, mode), ms: Math.round(performance.now() - started), reason: decision.reason };
}

const CLOUD_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 1_500;

/** A transient cloud failure (overload, rate limit, timeout) earns ONE retry; anything else surfaces at once. */
export function isTransient(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /\[(429|500|502|503|504)\b|high demand|overloaded|timed? ?out|timeout|aborted/i.test(m);
}

export async function withRetry<R>(call: () => Promise<R>, delayMs = RETRY_DELAY_MS): Promise<R> {
  try {
    return await call();
  } catch (e) {
    if (!isTransient(e)) throw e;
    await new Promise((r) => setTimeout(r, delayMs));
    return call();
  }
}

function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

/** The SDK reports the source on the response. If an older runtime omits it, say only what the mode proves. */
function sourceOf(reported: string | undefined, decision: RouteDecision, mode: string): InferenceSource {
  if (reported === "on_device" || reported === "in_cloud") return reported;
  if (mode === VALUES_TASK_MODE) return "on_device";
  void decision;
  return "in_cloud"; // the cautious claim when the runtime did not say
}

// ---- local model state -------------------------------------------------------------------------------------------

export async function localModelState(): Promise<LocalModelState> {
  if (import.meta.env.DEV && !isFirebaseConfigured() && new URLSearchParams(location.search).has("model")) {
    return (new URLSearchParams(location.search).get("model") as LocalModelState) ?? "unavailable";
  }
  if (typeof LanguageModel === "undefined") return "unavailable";
  try {
    return await LanguageModel.availability();
  } catch {
    return "unavailable";
  }
}

/** Starts the model download (needs a user gesture). Resolves when the create call settles. */
export async function downloadLocalModel(onProgress: (fraction: number) => void): Promise<void> {
  if (typeof LanguageModel === "undefined") return;
  const session = await LanguageModel.create({
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => onProgress((e as Event & { loaded: number }).loaded));
    },
  });
  session.destroy();
}
