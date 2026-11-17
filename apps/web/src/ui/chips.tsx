import type { InferenceSource } from "@distill/engine";
import { isOnDeviceOnlyBuild, ON_DEVICE_ONLY_NOTE, toAiError } from "../ai";
import { isFirebaseConfigured } from "../firebase";
import { agentQueue, useAgentActive, useAgentQueue, type AgentQueue, type AiProvider } from "./agentQueue";
import type { LocalModel } from "./useLocalModel";

export interface AiMeta { source: InferenceSource; reason: string; ms: number }

const SOURCE_LABEL: Record<InferenceSource, string> = {
  on_device: "On this device",
  in_cloud: "In the cloud",
  agent: "Made by your agent",
};

/** Where an AI result ran (device: round mark, cloud: diamond, agent: square). The reason shows on hover and on
 *  keyboard focus. */
export function SourceChip({ meta }: { meta: AiMeta }) {
  const label = SOURCE_LABEL[meta.source];
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

const PROVIDERS: { value: AiProvider; label: string; hint: string }[] = [
  { value: "distill", label: "Distill", hint: "" },
  { value: "agent", label: "My agent", hint: "Claude Code or agy" },
];

/**
 * "Who does the AI work": Distill's own AI, or the person's agent over the helper program. Offered only while the
 * helper program is connected. Values tasks (suggest, check) stay on this device whatever is chosen.
 */
export function ProviderChoice({ queue = agentQueue }: { queue?: AgentQueue }) {
  const { connected, provider } = useAgentQueue(queue);
  if (!connected) return null;
  const distillHint = isOnDeviceOnlyBuild() ? "this device only" : "this device first, then the cloud";
  return (
    <fieldset className="ws-provider" data-testid="ai-provider">
      <legend>Who does the AI work</legend>
      {PROVIDERS.map((p) => (
        <label key={p.value} className="choice">
          <input type="radio" name="distill-ai-provider" value={p.value} checked={provider === p.value}
            onChange={() => queue.setProvider(p.value)} data-testid={`ai-provider-${p.value}`} />
          {p.label} <small className="muted">({p.value === "distill" ? distillHint : p.hint})</small>
        </label>
      ))}
      {provider === "agent" && (
        <p className="ws-model-note" data-testid="ai-provider-note">
          Your agent gets the page text to work on. Suggestions and checks of your own answers stay on this device.
        </p>
      )}
    </fieldset>
  );
}

/** The local model and where results are made: the sidebar's model card. Keeps the page roles (--bg, --fg) whatever
 *  ground it sits on, so the device, cloud and agent colours keep their contrast in every theme. */
export function ModelCard({ model }: { model: LocalModel }) {
  const agentOn = useAgentActive();
  const pct = model.state === "downloading" && model.progress !== null ? Math.round(model.progress * 100) : null;
  return (
    <section className="ws-model" aria-label="AI model" data-testid="model-state" data-state={model.state}>
      <p className="ws-model-status">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18h3" /></svg>
        <span role="status">{MODEL_TEXT[model.state]}{pct !== null ? ` ${pct}%` : ""}</span>
      </p>
      {model.state === "downloading" && (pct !== null
        ? <progress className="ws-model-bar" max={100} value={pct} aria-label="Download progress" />
        : <span className="sk ws-model-wait" aria-hidden="true" />)}
      {model.state === "downloadable" && (
        <button type="button" className="btn btn-primary btn-small" onClick={() => void model.download()}>Download the model</button>
      )}
      {isOnDeviceOnlyBuild() && !agentOn ? (
        <p className="ws-model-note" data-testid="device-only-build">{ON_DEVICE_ONLY_NOTE}</p>
      ) : (
        <ul className="ws-legend" aria-label="Where results are made">
          <li className="ws-legend-device"><i aria-hidden="true" />On this device</li>
          {!isOnDeviceOnlyBuild() && <li className="ws-legend-cloud"><i aria-hidden="true" />In the cloud</li>}
          {agentOn && <li className="ws-legend-agent"><i aria-hidden="true" />Made by your agent</li>}
          <li>Each result shows where it ran.</li>
        </ul>
      )}
      <ProviderChoice />
    </section>
  );
}

let toldDeveloper = false;

/** No AI in this copy. The person reads what that means for them; how to set it up is for developers (console, README). */
export function ConfigNotice() {
  const agentOn = useAgentActive();
  if (isFirebaseConfigured() || agentOn) return null; // with "My agent", the agent does the AI work
  if (!toldDeveloper) {
    toldDeveloper = true;
    console.info("[distill] Firebase is not configured (no VITE_FIREBASE_* values at build time), so AI features are off. See README.md.");
  }
  return (
    <p className="notice" role="status" data-testid="not-configured">
      AI features are off in this copy of Distill. You can still read the page and fill in the form yourself.
    </p>
  );
}
