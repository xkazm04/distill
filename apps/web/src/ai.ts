// The one wrapper every AI call goes through. It asks the engine's Sieve (`route`) where the task may run, builds the
// Firebase AI Logic model for that decision, and reports where it ran (from the SDK response, not from a guess).
import { getGenerativeModel, type InferenceMode as SdkMode } from "firebase/ai";
import { engine, type InferenceSource, type LocalModelState, type RouteDecision, type Task } from "./ui/engine";
import { getFirebase, isFirebaseConfigured, remoteValue } from "./firebase";

export interface RunResult<T> {
  data: T;
  source: InferenceSource;
  ms: number;
  /** The Sieve's plain-words reason, shown on hover of the source chip. */
  reason: string;
}

export class NotConfiguredError extends Error {
  constructor() {
    super("Firebase is not configured, so AI features are off.");
    this.name = "NotConfiguredError";
  }
}

/** The ONE place a person's-values task is pinned to the device. A `values` prompt never gets a cloud model. */
const VALUES_TASK_MODE = "only_on_device" as const;

/**
 * Run one task. `schema` is a JSON Schema: it constrains the on-device model (`responseConstraint`) and the cloud
 * model (`responseJsonSchema`). With `schema === null` the reply is plain text and `data` is that string.
 */
export async function run<T = unknown>(task: Task, prompt: string, schema: object | null, devContext: import("./dev/fake-ai").FakeContext = {}): Promise<RunResult<T>> {
  const started = performance.now();

  if (import.meta.env.DEV && !isFirebaseConfigured()) {
    const fake = await import("./dev/fake-ai");
    const r = fake.fakeRun(task, devContext);
    return { data: r as T, source: "on_device", ms: Math.round(performance.now() - started), reason: "Fake AI (dev only)" };
  }

  const services = await getFirebase();
  if (!services) throw new NotConfiguredError();

  const decision = await engine.route(task, remoteValue(services, "inference_mode"));
  const isValues = decision.promptClass === "values";
  const mode = isValues ? VALUES_TASK_MODE : decision.mode;
  if (isValues && decision.mode !== VALUES_TASK_MODE) {
    throw new Error(`Sieve routed a values task to ${decision.mode}; refusing to send values anywhere but the device.`);
  }

  const model = getGenerativeModel(services.ai, {
    // The engine's mode strings are the SDK's InferenceMode strings, exactly.
    mode: mode as SdkMode,
    onDeviceParams: schema ? { promptOptions: { responseConstraint: schema } } : undefined,
    // A values task has no cloud configuration at all, so there is nothing to fall back to.
    inCloudParams: isValues
      ? undefined
      : {
          model: remoteValue(services, "cloud_model"),
          generationConfig: schema
            ? { responseMimeType: "application/json", responseJsonSchema: schema as { [k: string]: unknown } }
            : undefined,
        },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const data = (schema ? JSON.parse(stripFence(text)) : text) as T;
  return { data, source: sourceOf(result.response.inferenceSource, decision, mode), ms: Math.round(performance.now() - started), reason: decision.reason };
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
