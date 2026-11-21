// Translate in place (#10), the frame side: when it starts, how it batches, what the door keeps, where it says it ran,
// and the words of the status line and the chip.
import { describe, expect, it } from "vitest";
import type { RunResult } from "@distill/web/ai";
import type { CleanReport, TextBlock } from "../../messages";
import { languagePart, statusLine } from "./status";
import { BATCH_BLOCKS, BATCH_CHARS, batches, overallSource, shortReason, sourceChip, translateBlocks, wantsTranslation, type TranslateState } from "./Translate";

const report = (lang: string): CleanReport => ({
  items: [], restored: [], lang, kind: "article", unlockedScroll: false, langFrom: "page", widened: 0, comfort: 0,
  calm: { media: 0, motion: 0 }, unstuck: 0,
});
const idle: TranslateState = { phase: "idle", showingSource: false };
const blocks = (n: number, len = 10): TextBlock[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, text: "x".repeat(len) }));
const ok = (data: unknown, source: RunResult<unknown>["source"] = "on_device"): RunResult<unknown> => ({ data, source, ms: 1, reason: "Runs on this device when it can." });
const echo = (source: RunResult<unknown>["source"] = "on_device") =>
  async (_p: string, batch: TextBlock[]) => ok({ blocks: batch.map((b) => ({ id: b.id, text: `EN ${b.text}` })) }, source);

describe("when Translate starts", () => {
  it("only when the page has a language and it is not the reader's", () => {
    expect(wantsTranslation(report("cs"), "en")).toBe(true);
    expect(wantsTranslation(report("cs-CZ"), "en")).toBe(true);
    expect(wantsTranslation(report("cs"), "cs")).toBe(false);
    expect(wantsTranslation(report("en-GB"), "en")).toBe(false);
    expect(wantsTranslation(report("und"), "en")).toBe(false);
  });
});

describe("batches", () => {
  it(`at most ${BATCH_BLOCKS} blocks or about ${BATCH_CHARS} characters a call, in document order`, () => {
    expect(batches(blocks(45)).map((b) => b.length)).toEqual([20, 20, 5]);
    const long = batches(blocks(5, 2500));
    expect(long.map((b) => b.length)).toEqual([2, 2, 1]);
    expect(long.flat().map((b) => b.id)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(batches([{ id: "t0", text: "y".repeat(9000) }])).toHaveLength(1); // one long block still goes, alone
  });
});

describe("translateBlocks", () => {
  it("puts each batch into the page as it arrives, through the door", async () => {
    const put: TextBlock[][] = [];
    const r = await translateBlocks(blocks(25), "cs", "en", echo(), async (b) => { put.push(b); return b.length; });
    expect(put.map((b) => b.length)).toEqual([20, 5]);
    expect(put[0]?.[0]).toEqual({ id: "t0", text: "EN xxxxxxxxxx" });
    expect(r).toMatchObject({ translated: 25, total: 25, dropped: 0, source: "on_device" });
  });

  it("the prompt names both languages and carries the batch's blocks only", async () => {
    const prompts: string[] = [];
    await translateBlocks(blocks(21), "cs", "en", async (p, b) => { prompts.push(p); return echo()(p, b); }, async (b) => b.length);
    expect(prompts[0]).toContain("from Czech into English");
    expect(prompts[0]).toContain("[t19]");
    expect(prompts[0]).not.toContain("[t20]");
    expect(prompts[1]).toContain("[t20]");
  });

  it("counts what the door refused, and never puts an unknown block", async () => {
    const put: TextBlock[] = [];
    const r = await translateBlocks(blocks(2), "cs", "en",
      async () => ok({ blocks: [{ id: "t0", text: "Fine" }, { id: "t7", text: "Made up" }, { id: "t1", text: "<b>Bold</b>" }] }),
      async (b) => { put.push(...b); return b.length; });
    expect(put).toEqual([{ id: "t0", text: "Fine" }, { id: "t1", text: "Bold" }]);
    expect(r.dropped).toBe(1);
  });

  it("a failed first call leaves the page as it was; a later failure keeps what is there", async () => {
    let put = 0;
    await expect(translateBlocks(blocks(3), "cs", "en", async () => { throw new Error("on-device model is not available"); }, async (b) => (put += b.length)))
      .rejects.toThrow();
    expect(put).toBe(0);
    let calls = 0;
    const r = await translateBlocks(blocks(30), "cs", "en", async (p, b) => { if (calls++) throw new Error("[503 Service Unavailable]"); return echo()(p, b); }, async (b) => b.length);
    expect(r.translated).toBe(20);
    expect(r.error).toBeDefined();
  });

  it("says on device only if every call ran there", async () => {
    let i = 0;
    const r = await translateBlocks(blocks(25), "cs", "en", (p, b) => echo(i++ ? "in_cloud" : "on_device")(p, b), async (b) => b.length);
    expect(r.source).toBe("in_cloud");
    expect(overallSource(["on_device", "on_device"])).toBe("on_device");
    expect(overallSource(["in_cloud", "in_cloud"])).toBe("in_cloud");
    expect(overallSource([])).toBeUndefined();
  });
});

describe("words", () => {
  it("the status line: Page in Czech, Translating..., Translated, Not translated: why", () => {
    expect(languagePart(report("cs"), idle, "en")).toBe("Page in Czech");
    expect(languagePart(report("cs"), idle, "cs")).toBeNull();
    expect(languagePart(report("und"), idle, "en")).toBeNull();
    expect(languagePart(report("cs-CZ"), { ...idle, phase: "translating", from: "cs" }, "en")).toBe("Translating from Czech...");
    expect(languagePart(report("cs"), { ...idle, phase: "done", from: "cs" }, "en")).toBe("Translated from Czech");
    expect(languagePart(report("cs"), { ...idle, phase: "failed", from: "cs", problem: "AI is off in this copy of Distill" }, "en"))
      .toBe("Not translated: AI is off in this copy of Distill");
    expect(statusLine({ ...report("de"), items: [] }, { ...idle, phase: "done", from: "de" })).toBe("Nothing to remove · Translated from German");
  });

  it("a failure in a few plain words, never the SDK's text", () => {
    expect(shortReason(Object.assign(new Error("AI: Inference mode is ONLY_ON_DEVICE, but an on-device model is not available. (AI/unsupported)"), { code: "unsupported" })))
      .toBe("the AI model on this device is not ready");
    expect(shortReason(new Error("[503 Service Unavailable] high demand"))).toBe("the AI is busy, try again later");
    expect(shortReason(new SyntaxError("Unexpected token"))).toBe("something went wrong with the AI");
  });

  it("the chip: No AI used until a translation is on the page, then where it ran", () => {
    expect(sourceChip(idle)).toMatchObject({ src: "none", text: "No AI used" });
    expect(sourceChip({ ...idle, phase: "translating", from: "cs" })).toMatchObject({ src: "none" });
    expect(sourceChip({ ...idle, phase: "failed", from: "cs" })).toMatchObject({ src: "none" });
    const device = sourceChip({ ...idle, phase: "done", from: "cs", source: "on_device", reason: "Runs on this device when it can." });
    expect(device).toMatchObject({ src: "on_device", text: "On this device" });
    expect(device.title).toMatch(/translation from Czech ran on this device/);
    const cloud = sourceChip({ ...idle, phase: "done", from: "cs", source: "in_cloud" });
    expect(cloud).toMatchObject({ src: "in_cloud", text: "In the cloud" });
    expect(cloud.title).toMatch(/page's text was sent, nothing of yours/);
  });
});
