import { describe, expect, it } from "vitest";
import { HOST_NAME, buildManifest, validateExtensionId } from "../src/install.js";

describe("native messaging manifest", () => {
  it("pins allowed_origins to the one extension id", () => {
    const id = "a".repeat(32);
    const m = buildManifest("C:\\x\\host.cmd", id);
    expect(m).toMatchObject({ name: HOST_NAME, type: "stdio", allowed_origins: [`chrome-extension://${id}/`] });
  });
  it("rejects a malformed id", () => {
    expect(() => validateExtensionId("*")).toThrow();
    expect(() => validateExtensionId("A".repeat(32))).toThrow();
  });
});
