import { describe, expect, it } from "vitest";
import { MAX_PENDING, ProposalStore } from "../src/proposals.js";

const mk = (s: ProposalStore, id = "p1") => s.create({ proposalId: id, fieldId: "f1", value: "Jana", rationale: "Your passport says so", fingerprint: "fpA" });

describe("proposal state machine", () => {
  it("starts pending and takes one final verdict", () => {
    const s = new ProposalStore();
    mk(s);
    expect(s.verdict("p1")).toBe("pending");
    expect(s.resolve("p1", "accepted")).toBe(true);
    expect(s.resolve("p1", "rejected")).toBe(false);
    expect(s.verdict("p1")).toBe("accepted");
  });
  it("ignores unknown ids and non-final verdicts", () => {
    const s = new ProposalStore();
    mk(s);
    expect(s.resolve("nope", "accepted")).toBe(false);
    expect(s.resolve("p1", "pending")).toBe(false);
    expect(s.resolve("p1", "maybe")).toBe(false);
    expect(s.verdict("p1")).toBe("pending");
  });
  it("validates input and caps pending proposals", () => {
    const s = new ProposalStore();
    const base = { proposalId: "x", fieldId: "f", value: "v", rationale: "r", fingerprint: "fpA" };
    expect(() => s.create({ ...base, fieldId: "" })).toThrow(/fieldId/);
    expect(() => s.create({ ...base, value: 3 })).toThrow(/value/);
    expect(() => s.create({ ...base, rationale: " " })).toThrow(/rationale/);
    expect(() => s.create({ ...base, fingerprint: undefined })).toThrow(/fingerprint/);
    expect(() => s.create({ ...base, fingerprint: "" })).toThrow(/fingerprint/);
    expect(() => s.create({ ...base, fingerprint: "f".repeat(200) })).toThrow(/fingerprint/);
    for (let i = 0; i < MAX_PENDING; i++) mk(s, `p${i}`);
    expect(() => mk(s, "extra")).toThrow(/Too many/);
    s.resolve("p0", "rejected");
    expect(() => mk(s, "extra")).not.toThrow();
  });
  it("withdraws a proposal the page never showed, so it does not count toward the cap", () => {
    const s = new ProposalStore();
    for (let i = 0; i < MAX_PENDING; i++) mk(s, `p${i}`);
    s.withdraw("p0");
    expect(s.verdict("p0")).toBeUndefined();
    expect(() => mk(s, "extra")).not.toThrow();
    s.resolve("p1", "accepted");
    s.withdraw("p1"); // a decided proposal stays: its verdict is history
    expect(s.verdict("p1")).toBe("accepted");
  });
  it("waitForVerdict resolves on a verdict or times out as pending", async () => {
    const s = new ProposalStore();
    mk(s);
    expect(await s.waitForVerdict("p1", 20)).toBe("pending");
    const w = s.waitForVerdict("p1", 1000);
    s.resolve("p1", "rejected");
    expect(await w).toBe("rejected");
  });
});
