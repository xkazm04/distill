import type { InferenceMode, PromptClass, RouteDecision, Task } from "./types.js";

const CLASS_OF: Record<Task, PromptClass> = {
  classifyPage: "page",
  simplifyBlocks: "page",
  recast: "page",
  readLetter: "page",
  buildReplyWizard: "page",
  translateBlocks: "page",
  findClaims: "page",
  checkClaim: "page",
  gist: "page",
  askPage: "values",
  explainTerm: "values",
  translateErrors: "values",
  buildWizard: "structure",
  explainField: "structure",
  suggestValue: "values",
  checkValue: "values",
  explainError: "values",
  draftReply: "values",
  // The person's own typed answer, put into the form's language. It runs on Chrome's on-device Translator API, never on
  // the cloud-capable SDK (apps/web/src/translator.ts); the class pins it to the device all the same.
  translateAnswer: "values",
};

const MODES: readonly InferenceMode[] = ["prefer_on_device", "only_on_device", "only_in_cloud", "prefer_in_cloud"];

const REASONS: Record<InferenceMode, string> = {
  prefer_on_device: "Runs on this device when it can, and uses the cloud only if the device cannot do it.",
  only_on_device: "Runs only on this device. Nothing is sent to the cloud.",
  only_in_cloud: "Runs in the cloud. The text of the page, not your own details, is sent.",
  prefer_in_cloud: "Runs in the cloud when it can, and on this device if the cloud is not available.",
};

export const isInferenceMode = (v: unknown): v is InferenceMode => typeof v === "string" && (MODES as readonly string[]).includes(v);

/** Sieve: where a task may run. A `values` task is only_on_device whatever is configured. */
export function route(task: Task, configuredMode?: string): RouteDecision {
  const promptClass = CLASS_OF[task];
  if (promptClass === "values") {
    return {
      task,
      promptClass,
      mode: "only_on_device",
      reason: "This uses your own details, so it runs only on this device and is never sent to the cloud.",
    };
  }
  // A web check needs Google Search, which only the cloud model has: it is never on the device, whatever is configured
  // (the on-device-only build refuses it before routing; see apps/web/src/ai.ts).
  if (task === "checkClaim") {
    return { task, promptClass, mode: "only_in_cloud", reason: "Checked on the web in the cloud: only this sentence, the page's title and its address are sent (and the day the page was published, when it says)." };
  }
  const mode: InferenceMode = isInferenceMode(configuredMode) ? configuredMode : "prefer_on_device";
  return { task, promptClass, mode, reason: REASONS[mode] };
}
