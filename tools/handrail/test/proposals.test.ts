import { describe, expect, it } from "vitest";
import { MAX_PENDING, ProposalStore } from "../src/proposals.js";

const mk = (s: ProposalStore, id = "p1") => s.create({ proposalId: id, fieldId: "f1", value: "Jana", rationale: "Your passport says so" });

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
    expect(() => s.create({ proposalId: "x", fieldId: "", value: "v", rationale: "r" })).toThrow(/fieldId/);
    expect(() => s.create({ proposalId: "x", fieldId: "f", value: 3, rationale: "r" })).toThrow(/value/);
    expect(() => s.create({ proposalId: "x", fieldId: "f", value: "v", rationale: " " })).toThrow(/rationale/);
    for (let i = 0; i < MAX_PENDING; i++) mk(s, `p${i}`);
    expect(() => mk(s, "extra")).toThrow(/Too many/);
    s.resolve("p0", "rejected");
    expect(() => mk(s, "extra")).not.toThrow();
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
