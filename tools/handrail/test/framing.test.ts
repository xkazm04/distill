import { describe, expect, it } from "vitest";
import { FrameDecoder, encodeMessage } from "../src/framing.js";

describe("native messaging framing", () => {
  it("prefixes a little-endian byte length", () => {
    const b = encodeMessage({ a: "é" });
    expect(b.readUInt32LE(0)).toBe(b.length - 4);
    expect(JSON.parse(b.subarray(4).toString("utf8"))).toEqual({ a: "é" });
  });
  it("decodes messages split at any byte and several per chunk", () => {
    const all = Buffer.concat([encodeMessage({ n: 1 }), encodeMessage({ n: 2, t: "žluťoučký" })]);
    const d = new FrameDecoder();
    const out: unknown[] = [];
    for (let i = 0; i < all.length; i++) out.push(...d.push(all.subarray(i, i + 1)));
    expect(out).toEqual([{ n: 1 }, { n: 2, t: "žluťoučký" }]);
    expect(new FrameDecoder().push(all)).toHaveLength(2);
  });
  it("refuses oversize frames both ways", () => {
    expect(() => encodeMessage({ x: "a".repeat(100) }, 50)).toThrow(/limit/);
    const head = Buffer.alloc(4);
    head.writeUInt32LE(2000, 0);
    expect(() => new FrameDecoder(1000).push(head)).toThrow(/limit/);
  });
});
