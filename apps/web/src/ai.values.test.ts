// The values law at the router: a values task never reaches the SDK when the browser has no on-device model, because
// the SDK would then send even an ONLY_ON_DEVICE prompt to the cloud (it builds no adapter without LanguageModel).
import { afterEach, describe, expect, it, vi } from "vitest";

const getGenerativeModel = vi.fn();
vi.mock("firebase/ai", () => ({ getGenerativeModel: (...a: unknown[]) => getGenerativeModel(...a) }));
vi.mock("./firebase", () => ({
  isFirebaseConfigured: () => true,
  getFirebase: async () => ({ ai: {} }),
  remoteValue: (_s: unknown, key: string) => (key === "inference_mode" ? "prefer_on_device" : "gemini-3.5-flash-lite"),
}));

const { run, AiError } = await import("./ai");

describe("values tasks with no on-device model", () => {
  afterEach(() => {
    getGenerativeModel.mockReset();
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    vi.restoreAllMocks();
  });

  it("refuse as device-only and never build a model, so nothing can reach the cloud", async () => {
    expect(typeof (globalThis as { LanguageModel?: unknown }).LanguageModel).toBe("undefined");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const task of ["suggestValue", "checkValue", "draftReply"] as const) {
      const err = await run(task, "my values", null).then(() => null, (e: unknown) => e);
      expect(err, task).toBeInstanceOf(AiError);
      expect((err as InstanceType<typeof AiError>).kind).toBe("device-only");
    }
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it("a page task is unaffected: it still builds its model (cloud-eligible by law)", async () => {
    getGenerativeModel.mockReturnValue({
      generateContent: async () => ({ response: { text: () => "{}", inferenceSource: "in_cloud" } }),
    });
    await expect(run("simplifyBlocks", "page text", {})).resolves.toMatchObject({ source: "in_cloud" });
    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
  });

  it("with a LanguageModel present, a values task is built ONLY_ON_DEVICE with no cloud params", async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = { availability: async () => "available" };
    getGenerativeModel.mockReturnValue({
      generateContent: async () => ({ response: { text: () => "x", inferenceSource: "on_device" } }),
    });
    await expect(run("suggestValue", "my values", null)).resolves.toMatchObject({ source: "on_device" });
    const [, params] = getGenerativeModel.mock.calls[0] as [unknown, { mode: string; inCloudParams?: unknown }];
    expect(params.mode).toBe("only_on_device");
    expect(params.inCloudParams).toBeUndefined();
  });
});
