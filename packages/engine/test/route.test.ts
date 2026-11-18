import { describe, expect, it } from "vitest";
import { route, type Task } from "../src/index.js";

describe("route", () => {
  it("never lets a values task leave the device, whatever is configured", () => {
    for (const task of ["suggestValue", "checkValue", "explainError", "draftReply"] as Task[]) {
      for (const cfg of ["prefer_in_cloud", "only_in_cloud", "prefer_on_device", "only_on_device", "garbage", undefined]) {
        const d = route(task, cfg);
        expect(d.mode).toBe("only_on_device");
        expect(d.promptClass).toBe("values");
      }
    }
    expect(route("suggestValue", "prefer_in_cloud").mode).toBe("only_on_device");
  });

  it("a reply draft carries the person's answers, so it is device-only with no cloud fallback", () => {
    for (const cfg of ["prefer_in_cloud", "only_in_cloud", "prefer_on_device", undefined]) {
      const d = route("draftReply", cfg);
      expect(d).toMatchObject({ task: "draftReply", promptClass: "values", mode: "only_on_device" });
      expect(d.reason).toMatch(/only on this device/);
    }
  });

  it("the reply wizard sees only the shared letter text, so it follows the configured mode", () => {
    expect(route("buildReplyWizard").promptClass).toBe("page");
    expect(route("buildReplyWizard", "prefer_in_cloud").mode).toBe("prefer_in_cloud");
    expect(route("buildReplyWizard", "nonsense").mode).toBe("prefer_on_device");
  });

  it("uses the configured mode for page and structure tasks, and falls back when it is invalid", () => {
    expect(route("recast", "prefer_in_cloud").mode).toBe("prefer_in_cloud");
    expect(route("buildWizard", "only_in_cloud").mode).toBe("only_in_cloud");
    expect(route("classifyPage", "only_on_device").mode).toBe("only_on_device");
    for (const bad of ["PREFER_ON_DEVICE", "cloud", "", undefined]) expect(route("simplifyBlocks", bad).mode).toBe("prefer_on_device");
  });

  it("classes tasks and explains in plain words", () => {
    expect(route("buildWizard").promptClass).toBe("structure");
    expect(route("explainField").promptClass).toBe("structure");
    expect(route("readLetter").promptClass).toBe("page");
    expect(route("recast").reason.length).toBeGreaterThan(10);
  });
});
