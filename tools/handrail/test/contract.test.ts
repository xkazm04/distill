import { describe, expect, it } from "vitest";
import type * as Engine from "../../../packages/engine/src/types.js";
import type * as Local from "../src/types.js";

// Compile-time: the local mirror and the wire contract must be mutually assignable. `npm run typecheck` fails on drift.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const tool: Same<Local.HandrailTool, Engine.HandrailTool> = true;
const proposal: Same<Local.HandrailProposal, Engine.HandrailProposal> = true;
const verdict: Same<Local.ProposalVerdict, Engine.ProposalVerdict> = true;
// The proposal.create payload is protocol-level: the wire proposal plus the fingerprint of the form the agent read.
const create: Same<Local.ProposalCreate, Engine.HandrailProposal & { fingerprint: string }> = true;

describe("wire contract mirror", () => {
  it("matches packages/engine/src/types.ts", () => {
    expect([tool, proposal, verdict, create]).toEqual([true, true, true, true]);
  });
});
