import type { HandrailProposal, ProposalVerdict } from "./types.js";
import { HandrailError } from "./types.js";

export const MAX_PENDING = 20;
export const MAX_VALUE_CHARS = 2000;
export const MAX_RATIONALE_CHARS = 500;

interface Entry {
  proposal: HandrailProposal;
  verdict: ProposalVerdict;
  waiters: Array<(v: ProposalVerdict) => void>;
}

/**
 * The proposal state machine: pending -> accepted | rejected, and nothing else. A verdict is final; a second verdict
 * for the same proposal is ignored (the person's first answer stands). The store only records what the person said;
 * it never writes a field, and there is no code path here that could.
 */
export class ProposalStore {
  private readonly entries = new Map<string, Entry>();

  create(input: { proposalId: string; fieldId: unknown; value: unknown; rationale: unknown }): HandrailProposal {
    if (typeof input.fieldId !== "string" || input.fieldId.trim() === "") throw new HandrailError("bad_request", "fieldId must be a non-empty string");
    if (typeof input.value !== "string") throw new HandrailError("bad_request", "value must be a string");
    if (typeof input.rationale !== "string" || input.rationale.trim() === "") throw new HandrailError("bad_request", "rationale must be a non-empty string, so the person can see why");
    if (input.value.length > MAX_VALUE_CHARS) throw new HandrailError("bad_request", `value is longer than ${MAX_VALUE_CHARS} characters`);
    if (input.rationale.length > MAX_RATIONALE_CHARS) throw new HandrailError("bad_request", `rationale is longer than ${MAX_RATIONALE_CHARS} characters`);
    if (this.pendingCount() >= MAX_PENDING) throw new HandrailError("too_many_pending", "Too many proposals are waiting for the person. Wait for them to answer.");
    if (this.entries.has(input.proposalId)) throw new HandrailError("bad_request", "duplicate proposalId");
    const proposal: HandrailProposal = { proposalId: input.proposalId, fieldId: input.fieldId, value: input.value, rationale: input.rationale };
    this.entries.set(proposal.proposalId, { proposal, verdict: "pending", waiters: [] });
    return proposal;
  }

  /** Record the person's verdict. Returns false when unknown, already decided, or not a final verdict. */
  resolve(proposalId: string, verdict: unknown): boolean {
    const e = this.entries.get(proposalId);
    if (!e || e.verdict !== "pending") return false;
    if (verdict !== "accepted" && verdict !== "rejected") return false;
    e.verdict = verdict;
    for (const w of e.waiters.splice(0)) w(verdict);
    return true;
  }

  verdict(proposalId: string): ProposalVerdict | undefined {
    return this.entries.get(proposalId)?.verdict;
  }

  pendingCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.verdict === "pending") n++;
    return n;
  }

  list(): Array<{ proposalId: string; fieldId: string; verdict: ProposalVerdict }> {
    return [...this.entries.values()].map((e) => ({ proposalId: e.proposal.proposalId, fieldId: e.proposal.fieldId, verdict: e.verdict }));
  }

  /** Resolves with the verdict, or "pending" when `ms` passes first. */
  waitForVerdict(proposalId: string, ms: number): Promise<ProposalVerdict> {
    const e = this.entries.get(proposalId);
    if (!e) return Promise.reject(new HandrailError("unknown_proposal", "no such proposal"));
    if (e.verdict !== "pending" || ms <= 0) return Promise.resolve(e.verdict);
    return new Promise((resolve) => {
      const done = (v: ProposalVerdict) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => {
        const i = e.waiters.indexOf(done);
        if (i >= 0) e.waiters.splice(i, 1);
        resolve("pending");
      }, ms);
      e.waiters.push(done);
    });
  }
}
