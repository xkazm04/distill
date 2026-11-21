import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/sha256.js";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("sha256 (for crypto.subtle on http pages)", () => {
  it("gives the same digest as SHA-256 itself, across block boundaries", () => {
    const text = "https://www.praslavice.cz/hlaseni-zavad\njmeno\ttext\tJméno a příjmení\n";
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const data = new TextEncoder().encode(text.repeat(40).slice(0, n));
      expect(hex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
});

describe("fingerprint without crypto.subtle (a content script on a plain http page)", () => {
  it("gives the same fingerprint as with it", async () => {
    const { fingerprint } = await import("../src/fingerprint.js");
    const fields = [{ fieldId: "jmeno", kind: "text", label: "Jméno" }] as Parameters<typeof fingerprint>[1];
    const withSubtle = await fingerprint("http://www.stahlavy.cz/hlaseni-zavad-1/", fields);
    const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, "subtle");
    Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
    try {
      expect(await fingerprint("http://www.stahlavy.cz/hlaseni-zavad-1/", fields)).toBe(withSubtle);
    } finally {
      if (subtle) Object.defineProperty(globalThis.crypto, "subtle", subtle);
      else delete (globalThis.crypto as { subtle?: unknown }).subtle;
    }
  });
});
