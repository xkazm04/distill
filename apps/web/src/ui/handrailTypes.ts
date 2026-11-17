// Extension-side Handrail message shapes: envelope `{ id, type, payload }`, exactly as tools/handrail/PROTOCOL.md
// section 3 defines them. Payload types are the types.ts names.
import type { AgentVerdict, FormStructure, HandrailProposal, PageAction, PageModel, ProposalVerdict, Task, Wizard, WizardStep } from "@distill/engine";

export interface Envelope<T extends string = string, P = unknown> {
  id: string;
  type: T;
  payload: P;
}

/**
 * The `proposal.create` payload: the proposal plus the fingerprint of the form the agent read (`structure.fingerprint`
 * from `wayfill_schema`). The panel refuses it with `stale_form` when the form open now has another fingerprint.
 */
export type ProposalCreate = HandrailProposal & { fingerprint: string };

/** The `action.propose` payload: click one control from `page_actions`, bound to the page read by its pageToken. */
export interface ActionPropose {
  proposalId: string;
  actionId: string;
  rationale: string;
  pageToken: string;
}

/** One task of the agent's work queue, as distill_tasks returns it. */
export interface WireTask { taskId: string; task: Task; prompt: string; schema: object | null; pageToken: string }

/** Host -> extension. Every request is answered with a `tool.result` under the same id. */
export type HostToPanel =
  | Envelope<"page.read", Record<string, never>>
  | Envelope<"form.schema", Record<string, never>>
  | Envelope<"wizard.next", Record<string, never>>
  | Envelope<"proposal.create", ProposalCreate>
  | Envelope<"tasks.list", { waitSeconds?: number }>
  | Envelope<"task.answer", { taskId: string; json: string }>
  | Envelope<"page.actions", Record<string, never>>
  | Envelope<"action.propose", ActionPropose>
  // Not in PROTOCOL.md: the background worker's own note that the native host went away.
  | Envelope<"status", { connected: boolean; reason?: string }>;

export type ToolError = { code: string; message: string };
export type ToolResult =
  | {
      ok: true;
      result:
        | (PageModel & { pageToken: string })
        | { structure: FormStructure; wizard: Wizard }
        | WizardStep
        | { tasks: WireTask[] }
        | AgentVerdict
        | { pageToken: string; actions: PageAction[] }
        | Record<string, never>;
    }
  | { ok: false; error: ToolError };

/** Extension -> host. */
export type PanelToHost =
  | Envelope<"tool.result", ToolResult>
  | Envelope<"proposal.verdict", { proposalId: string; verdict: Exclude<ProposalVerdict, "pending"> }>
  | Envelope<"action.verdict", { proposalId: string; verdict: Exclude<ProposalVerdict, "pending"> }>;

/** What the panel needs from a Handrail connection. The extension implements it over a `chrome.runtime` port. */
export interface HandrailPort {
  onMessage(cb: (e: HostToPanel) => void): () => void;
  post(e: PanelToHost): void;
  disconnect(): void;
}

let counter = 0;
export const newId = (): string => `x${Date.now().toString(36)}${(counter++).toString(36)}`;
