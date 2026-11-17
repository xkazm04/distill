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
  it("declares no standing host access", () => {
    expect(m.host_permissions).toBeUndefined();
    expect(m.content_scripts).toBeUndefined();
  });
  it("uses the documented port and native host names", () => {
    expect(HANDRAIL_PORT).toBe("handrail");
    expect(HANDRAIL_NATIVE_HOST).toBe("dev.distill.handrail");
  });
});
