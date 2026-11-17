import { randomUUID } from "node:crypto";
import { ActionProposalStore, ProposalStore } from "./proposals.js";
import type { ActionProposalCreate, Envelope, ProposalCreate, TaskAnswer } from "./types.js";
import { HandrailError } from "./types.js";

export const EXTENSION_TIMEOUT_MS = 30_000;
export const MAX_WAIT_SECONDS = 120;
/** distill_tasks waits up to waitSeconds in the page; the host gives the page this much longer to answer. */
export const TASKS_GRACE_MS = 10_000;
/** An answer travels host -> extension, where Chrome caps a message at 1 MiB. */
export const MAX_ANSWER_CHARS = 500_000;

const seconds = (raw: unknown): number => (typeof raw === "number" && Number.isFinite(raw) ? Math.min(Math.max(raw, 0), MAX_WAIT_SECONDS) : 0);

/**
 * The host's brain, independent of stdin/stdout and of the channel so tests can fake both ends. `send` writes one
 * envelope to the extension; `receive` takes one envelope from it. Handrail never writes a page field: the only thing
 * it sends toward the page is a proposal, and the only thing it takes back is the person's verdict.
 */
export class Host {
  readonly proposals = new ProposalStore();
  readonly actions = new ActionProposalStore();
  private readonly waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly send: (e: Envelope) => void, private readonly timeoutMs = EXTENSION_TIMEOUT_MS) {}

  /** Entry point for calls arriving from handrail-mcp over the channel. */
  readonly handleCall = async (tool: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (tool) {
      case "distill_read":
        return this.ask("page.read", {});
      case "wayfill_schema": {
        const r = (await this.ask("form.schema", {})) as Record<string, unknown>;
        return { ...r, proposals: this.proposals.list() };
      }
      case "wayfill_next":
        return this.ask("wizard.next", {});
      case "wayfill_propose":
        return this.propose(args);
      case "distill_tasks": {
        // A long poll: the page answers as soon as a task waits, or with no tasks after waitSeconds.
        const wait = seconds(args["waitSeconds"]);
        return this.ask("tasks.list", { waitSeconds: wait }, wait * 1000 + TASKS_GRACE_MS);
      }
      case "distill_answer":
        return this.ask("task.answer", this.answerOf(args));
      case "page_actions": {
        const r = (await this.ask("page.actions", {})) as Record<string, unknown>;
        return { ...r, proposals: this.actions.list() };
      }
      case "page_action_propose":
        return this.proposeAction(args);
      default:
        throw new HandrailError("unknown_tool", `unknown tool ${tool}`);
    }
  };

  private async propose(args: Record<string, unknown>): Promise<unknown> {
    const proposal: ProposalCreate = this.proposals.create({
      proposalId: randomUUID(), fieldId: args["fieldId"], value: args["value"], rationale: args["rationale"], fingerprint: args["fingerprint"],
    });
    const wait = seconds(args["waitSeconds"]);
    // The ack says the page has the proposal on screen; the verdict arrives later as its own envelope. A refusal
    // (stale_form: the page changed) or no answer means it was never shown, so it does not count toward MAX_PENDING.
    try {
      await this.ask("proposal.create", proposal);
    } catch (e) {
      this.proposals.withdraw(proposal.proposalId);
      throw e;
    }
    const verdict = await this.proposals.waitForVerdict(proposal.proposalId, wait * 1000);
    return { proposalId: proposal.proposalId, verdict };
  }

  /** The agent's answer as JSON text: a string is passed as written, an object or array is serialised. */
  private answerOf(args: Record<string, unknown>): TaskAnswer {
    const taskId = args["taskId"];
    if (typeof taskId !== "string" || taskId.trim() === "" || taskId.length > 128) throw new HandrailError("bad_request", "taskId must be a taskId from distill_tasks");
    const raw = args["json"];
    if (raw === undefined) throw new HandrailError("bad_request", "json must be your answer, matching the task's schema");
    const json = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (json.length > MAX_ANSWER_CHARS) throw new HandrailError("bad_request", `json is longer than ${MAX_ANSWER_CHARS} characters`);
    return { taskId, json };
  }

  private async proposeAction(args: Record<string, unknown>): Promise<unknown> {
    const proposal: ActionProposalCreate = this.actions.create({
      proposalId: randomUUID(), actionId: args["actionId"], rationale: args["rationale"], pageToken: args["pageToken"],
    });
    try {
      await this.ask("action.propose", proposal);
    } catch (e) {
      this.actions.withdraw(proposal.proposalId);
      throw e;
    }
    const verdict = await this.actions.waitForVerdict(proposal.proposalId, seconds(args["waitSeconds"]) * 1000);
    return { proposalId: proposal.proposalId, verdict };
  }

  private ask(type: string, payload: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new HandrailError("extension_timeout", "The Distill page did not answer in time."));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      this.send({ id, type, payload });
    });
  }

  /** One envelope from the extension. */
  receive(env: Envelope): void {
    if (!env || typeof env.type !== "string") return;
    if (env.type === "proposal.verdict") {
      const p = env.payload as { proposalId?: unknown; verdict?: unknown } | undefined;
      if (p && typeof p.proposalId === "string") this.proposals.resolve(p.proposalId, p.verdict);
      return;
    }
    if (env.type === "action.verdict") {
      const p = env.payload as { proposalId?: unknown; verdict?: unknown } | undefined;
      if (p && typeof p.proposalId === "string") this.actions.resolve(p.proposalId, p.verdict);
      return;
    }
    if (env.type === "tool.result") {
      const w = this.waiting.get(env.id);
      if (!w) return;
      this.waiting.delete(env.id);
      clearTimeout(w.timer);
      const p = env.payload as { ok?: boolean; result?: unknown; error?: { code?: string; message?: string } } | undefined;
      if (p && p.ok) w.resolve(p.result);
      else w.reject(new HandrailError(p?.error?.code ?? "extension_error", p?.error?.message ?? "The Distill page reported an error."));
    }
  }

  /** The extension went away: fail everything in flight. */
  shutdown(): void {
    for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new HandrailError("closed", "The Distill page disconnected.")); }
    this.waiting.clear();
  }
}
