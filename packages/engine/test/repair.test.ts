import { describe, expect, it } from "vitest";
import { validateAndRepair } from "../src/index.js";

const ok = { kind: "summary", text: "Pay by 3 May.", sourceBlockIds: ["b1"] };

describe("validateAndRepair", () => {
  it("keeps valid nodes of every kind", () => {
    const r = validateAndRepair({
      version: 1,
      nodes: [
        ok,
        { kind: "keyFacts", facts: [{ label: "Amount", value: "500 CZK" }], sourceBlockIds: ["b2"] },
        { kind: "steps", items: ["Sign", "Send"], sourceBlockIds: [] },
        { kind: "checklist", items: ["ID card"], sourceBlockIds: ["b3"] },
        { kind: "comparison", columns: ["Plan", "Price"], rows: [["A", "1"], ["B", "2"]], sourceBlockIds: ["b4"] },
        { kind: "timeline", events: [{ when: "3 May", what: "Deadline" }], sourceBlockIds: ["b5"] },
        { kind: "callout", text: "Careful", tone: "warning", sourceBlockIds: ["b6"] },
      ],
    });
    expect(r.dropped).toBe(0);
    expect(r.nodes).toHaveLength(7);
    expect(r.nodes[6]?.tone).toBe("warning");
  });

  it("drops an unknown kind and counts it with a reason", () => {
    const r = validateAndRepair({ version: 1, nodes: [ok, { kind: "carousel", text: "x", sourceBlockIds: [] }] });
    expect(r.nodes).toHaveLength(1);
    expect(r.dropped).toBe(1);
    expect(r.reasons[0]).toMatch(/carousel/);
  });

  it("drops a kind that is turned off", () => {
    const r = validateAndRepair({ nodes: [ok] }, ["steps"]);
    expect(r.nodes).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });

  it("strips HTML from every string", () => {
    const r = validateAndRepair({
      nodes: [{ kind: "summary", title: "<b>Hi</b>", text: "Pay <script>alert(1)</script>now &lt;img src=x onerror=1&gt;", sourceBlockIds: ["b1"] }],
    });
    expect(r.nodes[0]?.title).toBe("Hi");
    expect(r.nodes[0]?.text).toBe("Pay now");
    expect(JSON.stringify(r.nodes)).not.toMatch(/[<>]/);
  });

  it("rejects javascript: anywhere, even disguised", () => {
    const bad = ["javascript:alert(1)", "  JaVa\tScRiPt:alert(1)", "java​script:x"];
    for (const s of bad) {
      const r = validateAndRepair({ nodes: [{ kind: "checklist", items: ["fine", s], sourceBlockIds: [] }, ok] });
      expect(r.nodes).toHaveLength(1);
      expect(r.dropped).toBe(1);
    }
    const viaKey = validateAndRepair({ nodes: [{ ...ok, "javascript:x": 1 }] });
    expect(viaKey.dropped).toBe(1);
  });

  it("enforces caps: 12 nodes, 20 items and rows, 400 chars, strings only", () => {
    const many = Array.from({ length: 15 }, () => ok);
    const r = validateAndRepair({ nodes: many });
    expect(r.nodes).toHaveLength(12);
    expect(r.dropped).toBe(3);

    const big = validateAndRepair({
      nodes: [
        { kind: "steps", items: Array.from({ length: 30 }, (_, i) => `step ${i}`), sourceBlockIds: [] },
        { kind: "comparison", columns: ["a", "b"], rows: Array.from({ length: 30 }, () => ["1", "2"]), sourceBlockIds: [] },
        { kind: "summary", text: "x".repeat(1000), sourceBlockIds: [] },
        { kind: "checklist", items: [1, null, "real", { a: 1 }], sourceBlockIds: [] },
      ],
    });
    expect(big.nodes[0]?.items).toHaveLength(20);
    expect(big.nodes[1]?.rows).toHaveLength(20);
    expect(big.nodes[2]?.text?.length).toBe(400);
    expect(big.nodes[3]?.items).toEqual(["real"]);
  });

  it("drops nodes missing their required fields", () => {
    const r = validateAndRepair({
      nodes: [
        { kind: "summary", sourceBlockIds: [] },
        { kind: "keyFacts", facts: [{ label: "x" }], sourceBlockIds: [] },
        { kind: "comparison", columns: ["only"], rows: [["a"]], sourceBlockIds: [] },
        { kind: "timeline", events: [], sourceBlockIds: [] },
        "nope",
        null,
      ],
    });
    expect(r.nodes).toHaveLength(0);
    expect(r.dropped).toBe(6);
  });

  it("returns 0 nodes, dropped 1 for a fully invalid spec", () => {
    for (const bad of [null, undefined, 42, "text", {}, { nodes: "x" }, { version: 1 }]) {
      const r = validateAndRepair(bad);
      expect(r.nodes).toEqual([]);
      expect(r.dropped).toBe(1);
      expect(r.reasons.length).toBe(1);
    }
  });

  it("drops invalid source block ids but keeps the node", () => {
    const r = validateAndRepair({ nodes: [{ ...ok, sourceBlockIds: ["b1", "<x>", 3, "b1", "b22"] }] });
    expect(r.nodes[0]?.sourceBlockIds).toEqual(["b1", "b22"]);
  });
});
