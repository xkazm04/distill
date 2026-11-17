import { randomUUID } from "node:crypto";
import { ProposalStore } from "./proposals.js";
import type { Envelope, HandrailProposal } from "./types.js";
import { HandrailError } from "./types.js";

export const EXTENSION_TIMEOUT_MS = 30_000;
export const MAX_WAIT_SECONDS = 120;

/**
 * The host's brain, independent of stdin/stdout and of the channel so tests can fake both ends. `send` writes one
 * envelope to the extension; `receive` takes one envelope from it. Handrail never writes a page field: the only thing
 * it sends toward the page is a proposal, and the only thing it takes back is the person's verdict.
 */
export class Host {
  readonly proposals = new ProposalStore();
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
      default:
        throw new HandrailError("unknown_tool", `unknown tool ${tool}`);
    }
  };

  private async propose(args: Record<string, unknown>): Promise<unknown> {
    const proposal: HandrailProposal = this.proposals.create({
      proposalId: randomUUID(), fieldId: args["fieldId"], value: args["value"], rationale: args["rationale"],
    });
    const waitRaw = args["waitSeconds"];
    const wait = typeof waitRaw === "number" && Number.isFinite(waitRaw) ? Math.min(Math.max(waitRaw, 0), MAX_WAIT_SECONDS) : 0;
    // The ack says the page has the proposal on screen; the verdict arrives later as its own envelope.
    await this.ask("proposal.create", proposal);
    const verdict = await this.proposals.waitForVerdict(proposal.proposalId, wait * 1000);
    return { proposalId: proposal.proposalId, verdict };
  }

  private ask(type: string, payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new HandrailError("extension_timeout", "The Distill page did not answer in time."));
      }, this.timeoutMs);
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
