// Local mirror of the Handrail part of the wire contract (packages/engine/src/types.ts). It is mirrored, not imported,
// so the built host does not pull the engine source into its build; test/contract.test.ts fails if the two drift.
export type HandrailTool =
  | "distill_read" | "wayfill_schema" | "wayfill_propose" | "wayfill_next"
  | "distill_tasks" | "distill_answer" | "page_actions" | "page_action_propose";

export interface HandrailProposal {
  proposalId: string;
  fieldId: string;
  value: string;
  rationale: string;
}

/**
 * The `proposal.create` payload (PROTOCOL.md section 3): the proposal plus the fingerprint of the form the agent read.
 * Protocol-level, not in types.ts; test/contract.test.ts pins it to `HandrailProposal & { fingerprint: string }`.
 */
export type ProposalCreate = HandrailProposal & { fingerprint: string };

/**
 * The `action.propose` payload (PROTOCOL.md section 3): click one control from `page_actions`, bound to the page the
 * agent read by its pageToken. Protocol-level, not in types.ts.
 */
export interface ActionProposalCreate {
  proposalId: string;
  actionId: string;
  rationale: string;
  pageToken: string;
}

/** The `task.answer` payload: the agent's answer to one queued task, as JSON text. */
export interface TaskAnswer {
  taskId: string;
  json: string;
}

export type ProposalVerdict = "accepted" | "rejected" | "pending";

/** Host <-> extension envelope (native messaging). */
export interface Envelope<T = unknown> {
  id: string;
  type: string;
  payload: T;
}

/** MCP server -> host, over the channel: one JSON object per line. */
export type ChannelMessage =
  | { type: "hello"; token: string; v: 1 }
  | { id: string; type: "call"; tool: HandrailTool; args: Record<string, unknown> };

/** Host -> MCP server. */
export type ChannelReply =
  | { type: "hello.ok"; v: 1 }
  | { id: string; type: "result"; ok: true; result: unknown }
  | { id: string; type: "result"; ok: false; error: { code: string; message: string } };

export class HandrailError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
