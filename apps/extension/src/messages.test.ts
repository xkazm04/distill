import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HANDRAIL_NATIVE_HOST, HANDRAIL_PORT } from "./messages";

describe("extension manifest", () => {
  const m = JSON.parse(readFileSync(resolve(process.cwd(), "public/manifest.json"), "utf8"));
  it("is MV3 with a side panel and a module worker", () => {
    expect(m.manifest_version).toBe(3);
    expect(m.side_panel.default_path).toBe("sidepanel.html");
    expect(m.background.service_worker).toBe("background.js");
  });
  it("declares no standing host access: every site is asked for when it is needed", () => {
    expect(m.host_permissions).toBeUndefined();
    expect(m.content_scripts).toBeUndefined();
    expect(m.optional_host_permissions).toEqual(["<all_urls>"]);
  });
  it("asks for nativeMessaging (Handrail) only when it is needed", () => {
    expect(m.permissions).toEqual(["sidePanel", "activeTab", "scripting", "storage"]);
    expect(m.optional_permissions).toEqual(["nativeMessaging"]);
  });
  it("has a store-sized description (132 characters at most)", () => {
    expect(m.description.length).toBeLessThanOrEqual(132);
  });
  it("carries a public key only, for a stable extension id", () => {
    expect(m.key).toMatch(/^MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA[A-Za-z0-9+/]+={0,2}$/); // RSA-2048 SubjectPublicKeyInfo
    expect(JSON.stringify(m)).not.toMatch(/PRIVATE KEY/);
  });
  it("uses the documented port and native host names", () => {
    expect(HANDRAIL_PORT).toBe("handrail");
    expect(HANDRAIL_NATIVE_HOST).toBe("dev.distill.handrail");
  });
});
