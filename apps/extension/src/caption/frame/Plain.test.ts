// Plain words in place (r2-04), the frame side: what the door keeps, how a run batches and counts, and the words of the
// status line and the chip.
import { describe, expect, it } from "vitest";
import type { RunResult } from "@distill/web/ai";
import type { TextBlock } from "../../messages";
import { lostWhy, plainChip, plainPart, plainRun, withPlain, type PlainState } from "./Plain";
import { sourceChip } from "./Translate";

const ok = (data: unknown, source: RunResult<unknown>["source"] = "on_device"): RunResult<unknown> => ({ data, source, ms: 1, reason: "Runs on this device when it can." });
const BLOCKS: TextBlock[] = [
  { id: "t1", text: "Poplatek ve výši 900 Kč je splatný do 31. března 2027 na účet obce Lhota." },
  { id: "t2", text: "Osvobozeny jsou děti do 3 let a osoby, které se v obci nezdržují déle než 6 měsíců." },
  { id: "p0", text: "The fee can also be paid at the post office with the slip every household receives." },
];
const base: PlainState = { phase: "on", available: true, shown: 3, total: 3, lostFacts: 0, lostKinds: [], dropped: 0, source: "on_device", reason: "Runs on this device when it can." };

describe("plainRun", () => {
  it("puts what passes the door, counts a rewrite that lost a fact, and says where it ran", async () => {
    const put: TextBlock[][] = [];
    const prompts: string[] = [];
    const r = await plainRun(BLOCKS, "cs", async (p, batch) => {
      prompts.push(p);
      return ok({ blocks: batch.map((b) => ({ id: b.id, text: b.id === "t2" ? "Děti nic neplatí." : `Jednoduše: ${b.text}` })) });
    }, async (b) => { put.push(b); return b.length; });
    expect(prompts[0]).toContain("in Czech");
    expect(put.flat().map((b) => b.id)).toEqual(["t1", "p0"]);
    expect(r).toMatchObject({ applied: 2, total: 3, lostFacts: 1, lostKinds: ["number"], dropped: 0, source: "on_device" });
  });

  it("throws when the first call fails (nothing changes); a later failure keeps what is there", async () => {
    await expect(plainRun(BLOCKS, "cs", async () => { throw new Error("busy"); }, async () => 0)).rejects.toThrow("busy");
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `t${i}`, text: `Blok číslo ${i} má dost slov na to, aby se přepsal.` }));
    let calls = 0;
    const r = await plainRun(many, "cs", async (_p, batch) => {
      if (calls++) throw new Error("busy");
      return ok({ blocks: batch.map((b) => ({ id: b.id, text: `Jednoduše: ${b.text}` })) }); // a block sent back unchanged is not put (r4-03)
    }, async (b) => b.length);
    expect(r.applied).toBe(20);
    expect(r.error).toBeInstanceOf(Error);
  });

  it("an HTML or unknown answer is dropped and counted, never put", async () => {
    const r = await plainRun(BLOCKS.slice(0, 1), "cs", async () => ok({ blocks: [{ id: "x9", text: "Nic." }] }), async () => { throw new Error("never put"); });
    expect(r).toMatchObject({ applied: 0, dropped: 1, lostFacts: 0 });
  });
});

describe("the strip's words", () => {
  it("names why rewrites were kept as written", () => {
    expect(lostWhy(["number", "number"])).toBe("a number would have changed");
    expect(lostWhy(["amount"])).toBe("an amount would have changed");
    expect(lostWhy(["date"])).toBe("a date would have changed");
    expect(lostWhy(["name"])).toBe("a name would have been lost");
    expect(lostWhy(["name", "date"])).toBe("a number, date or name would have changed");
  });

  it("the status line speaks of Plain first while it matters", () => {
    expect(plainPart({ ...base, phase: "idle" })).toBeNull();
    expect(plainPart({ ...base, phase: "off" })).toBeNull();
    expect(plainPart({ ...base, phase: "working" })).toBe("Rewriting in plain words...");
    expect(plainPart(base)).toBe("Plain words");
    expect(plainPart({ ...base, lostFacts: 2, lostKinds: ["number", "number"] })).toBe("Plain words · 2 parts kept as written: a number would have changed");
    expect(plainPart({ ...base, lostFacts: 1, lostKinds: ["amount"] })).toBe("Plain words · 1 part kept as written: an amount would have changed");
    expect(plainPart({ ...base, phase: "failed", problem: "the AI model on this device is not ready" })).toBe("Not rewritten: the AI model on this device is not ready");
    expect(withPlain("Removed 6 distractions", base)).toBe("Plain words · Removed 6 distractions");
    expect(withPlain("Removed 6 distractions", { ...base, phase: "off" })).toBe("Removed 6 distractions");
  });

  it("the chip says where the plain words ran, and where the translation ran when one shows", () => {
    const none = sourceChip({ phase: "idle", showingSource: false });
    expect(plainChip(none, { ...base, phase: "idle" }).text).toBe("No AI used");
    const chip = plainChip(none, base);
    expect(chip).toMatchObject({ src: "on_device", text: "On this device" });
    expect(chip.title).toMatch(/^The plain words ran on this device\. .* Clean used no AI\.$/);
    expect(chip.data).toMatchObject({ "data-plain": "on", "data-plain-blocks": "3/3" });
    const cloud = plainChip(none, { ...base, source: "in_cloud" });
    expect(cloud.title).toContain("ran in the cloud (the page's text was sent, nothing of yours)");
    // A translation in the cloud and plain words on the device: the chip says In the cloud, the title says both.
    const tr = sourceChip({ phase: "done", showingSource: false, from: "cs", to: "en", source: "in_cloud", translated: 3, total: 3 });
    const both = plainChip(tr, base, "in_cloud");
    expect(both).toMatchObject({ src: "in_cloud", text: "In the cloud" });
    expect(both.title).toMatch(/plain words ran on this device.*translation from Czech ran in the cloud/);
    // As written: the translation's chip again, with Plain's phase.
    const off = plainChip(tr, { ...base, phase: "off" }, "in_cloud");
    expect(off.text).toBe("In the cloud");
    expect(off.title).not.toContain("plain words");
    expect(off.data["data-plain"]).toBe("off");
  });
});
