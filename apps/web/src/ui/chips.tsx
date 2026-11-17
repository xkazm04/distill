import type { InferenceSource } from "@distill/engine";
import { toAiError } from "../ai";
import { isFirebaseConfigured } from "../firebase";
import type { LocalModel } from "./useLocalModel";

export interface AiMeta { source: InferenceSource; reason: string; ms: number }

/** Where an AI result ran. The reason shows on hover and on keyboard focus. */
export function SourceChip({ meta }: { meta: AiMeta }) {
  const label = meta.source === "on_device" ? "On this device" : "In the cloud";
  return (
    <span className={`chip chip-${meta.source}`} tabIndex={0} title={meta.reason} aria-label={`${label}. ${meta.reason}`} data-testid="source-chip">
      {label}
      <span className="chip-tip" role="tooltip">{meta.reason} ({(meta.ms / 1000).toFixed(1)} s)</span>
    </span>
  );
}

/**
 * A failed AI call, in the router's plain words (never the raw error), with "Try again" when trying again can help.
 * `after` says what the person sees instead, for example "Showing the page as written."
 */
export function AiProblem({ error, after, onRetry }: { error: unknown; after?: string; onRetry?: () => void }) {
  const ai = toAiError(error);
  return (
    <p className="notice notice-warn" role="alert" data-testid="ai-problem" data-kind={ai.kind}>
      {ai.message}{after ? ` ${after}` : ""}
      {ai.retry && onRetry && (
        <>{" "}<button type="button" className="btn btn-small" onClick={onRetry} data-testid="ai-retry">Try again</button></>
      )}
    </p>
  );
}

const MODEL_TEXT: Record<string, string> = {
  checking: "Checking the model on this device",
  unavailable: "No model on this device",
  downloadable: "Model on this device: ready to download",
  downloading: "Model on this device: downloading",
  available: "Model on this device: ready",
};

export function ModelStatus({ model }: { model: LocalModel }) {
  return (
    <span className="model-status" data-testid="model-state" data-state={model.state}>
      <span className={`chip chip-model-${model.state}`}>{MODEL_TEXT[model.state]}
        {model.state === "downloading" && model.progress !== null ? ` ${Math.round(model.progress * 100)}%` : ""}
      </span>
      {model.state === "downloadable" && (
        <button type="button" className="btn btn-small" onClick={() => void model.download()}>Download the model</button>
      )}
    </span>
  );
}

export function ConfigNotice() {
  if (isFirebaseConfigured()) return null;
  return (
    <p className="notice" role="status" data-testid="not-configured">
      Firebase is not configured, so the AI features are off. You can still read the page and fill in the form by hand.
      The owner sets this up in the <code>.env</code> file.
    </p>
  );
}
