// Extension-side Handrail message shapes: envelope `{ id, type, payload }`, exactly as tools/handrail/PROTOCOL.md
// section 3 defines them. Payload types are the types.ts names.
import type { FormStructure, HandrailProposal, PageModel, ProposalVerdict, Wizard, WizardStep } from "@distill/engine";

export interface Envelope<T extends string = string, P = unknown> {
  id: string;
  type: T;
  payload: P;
}

/** Host -> extension. Every request is answered with a `tool.result` under the same id. */
export type HostToPanel =
  | Envelope<"page.read", Record<string, never>>
  | Envelope<"form.schema", Record<string, never>>
  | Envelope<"wizard.next", Record<string, never>>
  | Envelope<"proposal.create", HandrailProposal>
  // Not in PROTOCOL.md: the background worker's own note that the native host went away.
  | Envelope<"status", { connected: boolean; reason?: string }>;

export type ToolError = { code: string; message: string };
export type ToolResult =
  | { ok: true; result: PageModel | { structure: FormStructure; wizard: Wizard } | WizardStep | Record<string, never> }
  | { ok: false; error: ToolError };

/** Extension -> host. */
export type PanelToHost =
  | Envelope<"tool.result", ToolResult>
  | Envelope<"proposal.verdict", { proposalId: string; verdict: Exclude<ProposalVerdict, "pending"> }>;

/** What the panel needs from a Handrail connection. The extension implements it over a `chrome.runtime` port. */
export interface HandrailPort {
  onMessage(cb: (e: HostToPanel) => void): () => void;
  post(e: PanelToHost): void;
  disconnect(): void;
}

let counter = 0;
export const newId = (): string => `x${Date.now().toString(36)}${(counter++).toString(36)}`;
