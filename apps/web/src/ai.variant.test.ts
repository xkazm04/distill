// The public extension build (VITE_EXT_VARIANT=public) runs EVERY task on the device: each model is built
// ONLY_ON_DEVICE with no cloud params, and with no ready local model every task fails as device-only before a model
// object exists (the SDK would otherwise send an ONLY_ON_DEVICE prompt to the cloud when LanguageModel is absent).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Task } from "@distill/engine";

const ALL_TASKS = [
  "classifyPage", "simplifyBlocks", "recast", "readLetter", "buildReplyWizard",
  "buildWizard", "explainField", "suggestValue", "checkValue", "explainError", "draftReply", "translateBlocks",
  "findClaims", "gist", "askPage", "explainTerm", "translateErrors", "translateAnswer",
] as const satisfies readonly Task[];
/** Tasks the Sieve keeps in the cloud whatever is configured: this build refuses them in plain words. */
const CLOUD_ONLY = ["checkClaim"] as const satisfies readonly Task[];
// Compile-time proof the lists are complete: a Task missing from both makes this line fail to typecheck.
const _complete: Exclude<Task, (typeof ALL_TASKS)[number] | (typeof CLOUD_ONLY)[number]> extends never ? true : never = true;
void _complete;

const getGenerativeModel = vi.fn();
const remoteValue = vi.fn((_s: unknown, key: string) => (key === "inference_mode" ? "only_in_cloud" : "a-cloud-model"));
vi.mock("firebase/ai", () => ({ getGenerativeModel: (...a: unknown[]) => getGenerativeModel(...a) }));
vi.mock("./firebase", () => ({
  isFirebaseConfigured: () => true,
  getFirebase: async () => ({ ai: {} }),
  remoteValue: (s: unknown, key: string) => remoteValue(s, key),
}));

type Ai = typeof import("./ai");
let ai: Ai;
const setModel = (availability: string | null) => {
  if (availability === null) delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  else (globalThis as { LanguageModel?: unknown }).LanguageModel = { availability: async () => availability };
};

beforeAll(async () => {
  vi.stubEnv("VITE_EXT_VARIANT", "public");
  vi.resetModules();
  ai = await import("./ai");
});
afterAll(() => vi.unstubAllEnvs());

describe("the public build: on the device only, for every task", () => {
  afterEach(() => {
    getGenerativeModel.mockReset();
    remoteValue.mockClear();
    setModel(null);
    vi.restoreAllMocks();
  });

  it("knows it is the on-device-only build", () => {
    expect(ai.isOnDeviceOnlyBuild()).toBe(true);
  });

  it("builds every task's model ONLY_ON_DEVICE with no cloud params, even when Remote Config says cloud", async () => {
    setModel("available");
    getGenerativeModel.mockReturnValue({
      generateContent: async () => ({ response: { text: () => "{}", inferenceSource: "on_device" } }),
    });
    for (const task of ALL_TASKS) {
      await expect(ai.run(task, "text", {}), task).resolves.toMatchObject({ source: "on_device" });
    }
    expect(getGenerativeModel).toHaveBeenCalledTimes(ALL_TASKS.length);
    for (const [, params] of getGenerativeModel.mock.calls as [unknown, { mode: string; inCloudParams?: unknown }][]) {
      expect(params.mode).toBe("only_on_device");
      expect(params.inCloudParams).toBeUndefined();
    }
    expect(remoteValue).not.toHaveBeenCalled(); // no Remote Config is read: the defaults stand
  });

  it("says where it ran in the Sieve's on-device words", async () => {
    setModel("available");
    getGenerativeModel.mockReturnValue({ generateContent: async () => ({ response: { text: () => "{}" } }) });
    const r = await ai.run("simplifyBlocks", "page text", {});
    expect(r.source).toBe("on_device");
    expect(r.reason).toMatch(/only on this device/i);
  });

  it("with no LanguageModel, every task (page tasks too) fails as device-only and no model is built", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const task of ALL_TASKS) {
      const err = await ai.run(task, "text", null).then(() => null, (e: unknown) => e);
      expect(err, task).toBeInstanceOf(ai.AiError);
      expect((err as InstanceType<Ai["AiError"]>).kind, task).toBe("device-only");
    }
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it("with a model that is not ready yet, a task fails as device-only instead of starting a download", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const state of ["downloadable", "downloading", "unavailable"]) {
      setModel(state);
      const err = await ai.run("recast", "text", {}).then(() => null, (e: unknown) => e);
      expect((err as InstanceType<Ai["AiError"]>).kind, state).toBe("device-only");
    }
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it("refuses the web check (cloud only) in plain words, plain and grounded, and builds no model", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setModel("available");
    for (const task of CLOUD_ONLY) {
      for (const call of [() => ai.run(task, "claim", {}), () => ai.runGrounded(task, "claim")]) {
        const err = await call().then(() => null, (e: unknown) => e);
        expect(err, task).toBeInstanceOf(ai.AiError);
        expect((err as InstanceType<Ai["AiError"]>).kind).toBe("needs-cloud");
        expect((err as Error).message).toBe("Checking on the web needs the cloud; this version of Distill uses only the AI on this device.");
        expect((err as InstanceType<Ai["AiError"]>).retry).toBe(false);
      }
    }
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it("an SDK 'unsupported' error on a page task is the device-only case, in this build's words", () => {
    const err = ai.toAiError(Object.assign(new Error("x"), { code: "unsupported" }), true);
    expect(err.kind).toBe("device-only");
    expect(err.message).toMatch(/only the AI model on this device/);
    expect(err.retry).toBe(false);
  });
});
