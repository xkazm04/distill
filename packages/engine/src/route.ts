import type { InferenceMode, PromptClass, RouteDecision, Task } from "./types.js";

const CLASS_OF: Record<Task, PromptClass> = {
  classifyPage: "page",
  simplifyBlocks: "page",
  recast: "page",
  readLetter: "page",
  buildReplyWizard: "page",
  buildWizard: "structure",
  explainField: "structure",
  suggestValue: "values",
  checkValue: "values",
  draftReply: "values",
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
  const mode: InferenceMode = isInferenceMode(configuredMode) ? configuredMode : "prefer_on_device";
  return { task, promptClass, mode, reason: REASONS[mode] };
}
