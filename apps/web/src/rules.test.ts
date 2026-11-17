import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertNoValues } from "./ui/data";

const rules = readFileSync(resolve(process.cwd(), "../../firestore.rules"), "utf8");

describe("firestore.rules", () => {
  it("keeps values out of formGuides and limits fields", () => {
    expect(rules).toContain("!('values' in request.resource.data)");
    expect(rules).toContain("hasOnly(['structure', 'wizard', 'updatedAt'])");
    expect(rules).toContain("allow read, write: if false");
  });
  it("lets a user touch only their own documents", () => {
    expect(rules).toContain("request.auth.uid == uid");
  });
});

describe("assertNoValues", () => {
  it("refuses a values key and accepts a guide", () => {
    expect(() => assertNoValues({ structure: { fields: [] }, values: { a: "1" } })).toThrow();
    expect(() => assertNoValues({ structure: { fields: [{ options: [{ value: "x", label: "x" }] }] } })).not.toThrow();
  });
});
