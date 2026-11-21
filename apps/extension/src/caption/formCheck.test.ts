import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256 } from "./formCheck";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("sha256 (the stand-in for crypto.subtle on http pages)", () => {
  it("gives the same digest as SHA-256 itself, across block boundaries", () => {
    const text = "https://www.praslavice.cz/hlaseni-zavad\njmeno\ttext\tJméno a příjmení\n";
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const data = new TextEncoder().encode(text.repeat(40).slice(0, n));
      expect(hex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
});
