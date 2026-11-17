import { describe, expect, it } from "vitest";
import { route, type Task } from "../src/index.js";

describe("route", () => {
  it("never lets a values task leave the device, whatever is configured", () => {
    for (const task of ["suggestValue", "checkValue"] as Task[]) {
      for (const cfg of ["prefer_in_cloud", "only_in_cloud", "prefer_on_device", "garbage", undefined]) {
        const d = route(task, cfg);
        expect(d.mode).toBe("only_on_device");
        expect(d.promptClass).toBe("values");
      }
    }
    expect(route("suggestValue", "prefer_in_cloud").mode).toBe("only_on_device");
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
