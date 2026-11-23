// Payload privacy for a form in your language (r4-04). A form's error message can repeat what the person typed, so
// translateErrors is a values task: whatever Remote Config says, whether the agent is connected, and whatever path is
// tried, run() never builds a cloud model for it, never posts it to the agent's queue, and with no on-device model it
// fails as device-only before any model object exists. The form's own words go through translateBlocks (page class,
// cloud-eligible): that prompt is built from words that never hold a value or an error (caption/formText.test.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { prompts, route } from "@distill/engine";

const getGenerativeModel = vi.fn();
const remoteValue = vi.fn((_s: unknown, key: string) => (key === "inference_mode" ? "only_in_cloud" : "a-cloud-model"));
vi.mock("firebase/ai", () => ({ getGenerativeModel: (...a: unknown[]) => getGenerativeModel(...a) }));
vi.mock("./firebase", () => ({
  isFirebaseConfigured: () => true,
  getFirebase: async () => ({ ai: {} }),
  remoteValue: (s: unknown, key: string) => remoteValue(s, key),
}));

const { run, runGrounded, AiError } = await import("./ai");
const { agentQueue } = await import("./ui/agentQueue");

const TYPED = "zqxvlenka@4711";
const ERRORS = [{ id: "e0", text: `Adresa ${TYPED} není platná` }];
const PROMPT = prompts.translateBlocks(ERRORS, "en", "cs");

const setModel = (on: boolean) => {
  if (on) (globalThis as { LanguageModel?: unknown }).LanguageModel = { availability: async () => "available" };
  else delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
};

describe("translateErrors: a form's error messages never leave the device", () => {
  afterEach(() => {
    getGenerativeModel.mockReset();
    remoteValue.mockClear();
    setModel(false);
    agentQueue.failAll("cancelled");
    agentQueue.setConnected(false);
    agentQueue.setProvider("distill");
    vi.restoreAllMocks();
  });

  it("routes only on device, whatever is configured; translateBlocks (the form's own words) is the page class", () => {
    for (const mode of ["only_in_cloud", "prefer_in_cloud", "prefer_on_device", "only_on_device"] as const) {
      expect(route("translateErrors", mode)).toMatchObject({ promptClass: "values", mode: "only_on_device" });
    }
    expect(route("translateBlocks", "only_in_cloud")).toMatchObject({ promptClass: "page" });
  });

  it("the prompt carries the error text (so it is a values prompt)", () => {
    expect(PROMPT).toContain(TYPED);
  });

  it("with no on-device model it fails as device-only and no model is built, even when Remote Config says cloud", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const err = await run("translateErrors", PROMPT, {}, { blocks: ERRORS }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as InstanceType<typeof AiError>).kind).toBe("device-only");
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it("with a model it is built ONLY_ON_DEVICE with no cloud params, and the errors go only to that model", async () => {
    setModel(true);
    const generateContent = vi.fn(async () => ({ response: { text: () => '{"blocks":[]}', inferenceSource: "on_device" } }));
    getGenerativeModel.mockReturnValue({ generateContent });
    await expect(run("translateErrors", PROMPT, {}, { blocks: ERRORS })).resolves.toMatchObject({ source: "on_device" });
    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
    const [, params] = getGenerativeModel.mock.calls[0] as [unknown, { mode: string; inCloudParams?: unknown }];
    expect(params.mode).toBe("only_on_device");
    expect(params.inCloudParams).toBeUndefined();
    expect(JSON.stringify(getGenerativeModel.mock.calls)).not.toContain(TYPED);
    expect(generateContent).toHaveBeenCalledWith(PROMPT);
  });

  it("is never posted to the agent's queue, even when the agent is chosen and connected", async () => {
    setModel(true);
    agentQueue.setProvider("agent");
    agentQueue.setConnected(true);
    getGenerativeModel.mockReturnValue({ generateContent: async () => ({ response: { text: () => '{"blocks":[]}', inferenceSource: "on_device" } }) });
    await expect(run("translateErrors", PROMPT, {}, { blocks: ERRORS })).resolves.toMatchObject({ source: "on_device" });
    expect(agentQueue.open()).toHaveLength(0);
  });

  it("the grounded (web search) run refuses it before anything is built", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setModel(true);
    await expect(runGrounded("translateErrors", PROMPT)).rejects.toBeTruthy();
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });
});
