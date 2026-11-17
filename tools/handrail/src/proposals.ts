import type { ActionProposalCreate, ProposalCreate, ProposalVerdict } from "./types.js";
import { HandrailError } from "./types.js";

export const MAX_PENDING = 20;
export const MAX_VALUE_CHARS = 2000;
export const MAX_RATIONALE_CHARS = 500;
export const MAX_FINGERPRINT_CHARS = 128;

interface Entry<P> {
  proposal: P;
  verdict: ProposalVerdict;
  waiters: Array<(v: ProposalVerdict) => void>;
}

/**
 * The verdict state machine shared by field proposals and action proposals: pending -> accepted | rejected, and
 * nothing else. A verdict is final; a second verdict for the same proposal is ignored (the person's first answer
 * stands). The book only records what the person said; it never writes a field or clicks anything.
 */
class VerdictBook<P extends { proposalId: string }> {
  protected readonly entries = new Map<string, Entry<P>>();

  protected add(proposal: P): P {
    if (this.pendingCount() >= MAX_PENDING) throw new HandrailError("too_many_pending", "Too many proposals are waiting for the person. Wait for them to answer.");
    if (this.entries.has(proposal.proposalId)) throw new HandrailError("bad_request", "duplicate proposalId");
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

  /** The page refused the proposal or never acknowledged it: it was never on screen, so it leaves the book. */
  withdraw(proposalId: string): void {
    const e = this.entries.get(proposalId);
    if (e && e.verdict === "pending") this.entries.delete(proposalId);
  }

  verdict(proposalId: string): ProposalVerdict | undefined {
    return this.entries.get(proposalId)?.verdict;
  }

  pendingCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.verdict === "pending") n++;
    return n;
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

const checkRationale = (r: unknown): string => {
  if (typeof r !== "string" || r.trim() === "") throw new HandrailError("bad_request", "rationale must be a non-empty string, so the person can see why");
  if (r.length > MAX_RATIONALE_CHARS) throw new HandrailError("bad_request", `rationale is longer than ${MAX_RATIONALE_CHARS} characters`);
  return r;
};

/** Field proposals (wayfill_propose). */
export class ProposalStore extends VerdictBook<ProposalCreate> {
  create(input: { proposalId: string; fieldId: unknown; value: unknown; rationale: unknown; fingerprint: unknown }): ProposalCreate {
    if (typeof input.fingerprint !== "string" || input.fingerprint.trim() === "" || input.fingerprint.length > MAX_FINGERPRINT_CHARS) {
      throw new HandrailError("bad_request", "fingerprint must be the structure.fingerprint from wayfill_schema, so the proposal is bound to the form you read");
    }
    if (typeof input.fieldId !== "string" || input.fieldId.trim() === "") throw new HandrailError("bad_request", "fieldId must be a non-empty string");
    if (typeof input.value !== "string") throw new HandrailError("bad_request", "value must be a string");
    const rationale = checkRationale(input.rationale);
    if (input.value.length > MAX_VALUE_CHARS) throw new HandrailError("bad_request", `value is longer than ${MAX_VALUE_CHARS} characters`);
    return this.add({ proposalId: input.proposalId, fieldId: input.fieldId, value: input.value, rationale, fingerprint: input.fingerprint });
  }

  list(): Array<{ proposalId: string; fieldId: string; verdict: ProposalVerdict }> {
    return [...this.entries.values()].map((e) => ({ proposalId: e.proposal.proposalId, fieldId: e.proposal.fieldId, verdict: e.verdict }));
  }
}

/** Action proposals (page_action_propose): "Your agent wants to click ...". */
export class ActionProposalStore extends VerdictBook<ActionProposalCreate> {
  create(input: { proposalId: string; actionId: unknown; rationale: unknown; pageToken: unknown }): ActionProposalCreate {
    if (typeof input.pageToken !== "string" || input.pageToken.trim() === "" || input.pageToken.length > MAX_FINGERPRINT_CHARS) {
      throw new HandrailError("bad_request", "pageToken must be the pageToken from page_actions, so the proposal is bound to the page you read");
    }
    if (typeof input.actionId !== "string" || input.actionId.trim() === "" || input.actionId.length > 32) {
      throw new HandrailError("bad_request", "actionId must be an actionId from page_actions");
    }
    const rationale = checkRationale(input.rationale);
    return this.add({ proposalId: input.proposalId, actionId: input.actionId, rationale, pageToken: input.pageToken });
  }

  list(): Array<{ proposalId: string; actionId: string; verdict: ProposalVerdict }> {
    return [...this.entries.values()].map((e) => ({ proposalId: e.proposal.proposalId, actionId: e.proposal.actionId, verdict: e.verdict }));
  }
}
