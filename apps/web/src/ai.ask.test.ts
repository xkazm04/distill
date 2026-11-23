// Payload privacy for "ask this page" (r3-08) and "explain this word" (r4-05): the person's question is a typed value,
// and which words they chose to have explained says something about them. Whatever Remote Config says, whether the
// agent is connected, and whatever path is tried, run() never builds a cloud model for askPage or explainTerm, never
// posts them to the agent's queue, and with no on-device model they fail as device-only before any model object exists.
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentCanDo, prompts, route } from "@distill/engine";

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

const QUESTION = "Does my landlord Zqxvlenka owe me the deposit 870619?";
const BLOCKS = [{ id: "m0", text: "A deposit is returned within thirty days of the end of the lease." }];
const TERM = "Zqxvlenka insolvence";
const SENTENCE = "Kdo je v Zqxvlenka insolvence, nemusí platit zálohy.";

/** Each values task of the strip: its prompt, the secret it carries, the context the stand-in reads, an empty answer. */
const CASES = [
  { task: "askPage", prompt: prompts.askPage(QUESTION, BLOCKS, "en"), secret: QUESTION, ctx: { blocks: BLOCKS, question: QUESTION }, empty: '{"answer":"","blockId":"","sentence":""}' },
  { task: "explainTerm", prompt: prompts.explainTerm(TERM, SENTENCE, "en"), secret: TERM, ctx: { term: TERM, sentence: SENTENCE }, empty: '{"text":""}' },
] as const;

const setModel = (on: boolean) => {
  if (on) (globalThis as { LanguageModel?: unknown }).LanguageModel = { availability: async () => "available" };
  else delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
};

describe.each(CASES)("$task: never leaves the device", ({ task, prompt: PROMPT, secret, ctx, empty }) => {
  afterEach(() => {
    getGenerativeModel.mockReset();
    remoteValue.mockClear();
    setModel(false);
    agentQueue.failAll("cancelled");
    agentQueue.setConnected(false);
    agentQueue.setProvider("distill");
    vi.restoreAllMocks();
  });

  it("the prompt carries what the person typed or chose (so it is a values prompt)", () => {
    expect(PROMPT).toContain(secret);
  });

  it("the Sieve keeps it on the device whatever Remote Config says, and no agent may do it", () => {
    expect(route(task, "only_in_cloud").mode).toBe("only_on_device");
    expect(agentCanDo(task)).toBe(false);
  });

  it("with no on-device model it fails as device-only and no model is built, even when Remote Config says cloud", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const err = await run(task, PROMPT, {}, ctx).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as InstanceType<typeof AiError>).kind).toBe("device-only");
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it("with a model it is built ONLY_ON_DEVICE with no cloud params, and the question goes only to that model", async () => {
    setModel(true);
    const generateContent = vi.fn(async () => ({ response: { text: () => empty, inferenceSource: "on_device" } }));
    getGenerativeModel.mockReturnValue({ generateContent });
    await expect(run(task, PROMPT, {})).resolves.toMatchObject({ source: "on_device" });
    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
    const [, params] = getGenerativeModel.mock.calls[0] as [unknown, { mode: string; inCloudParams?: unknown }];
    expect(params.mode).toBe("only_on_device");
    expect(params.inCloudParams).toBeUndefined();
    expect(JSON.stringify(getGenerativeModel.mock.calls)).not.toContain("Zqxvlenka");
    expect(generateContent).toHaveBeenCalledWith(PROMPT);
  });

  it("says on this device even when the SDK does not report a source", async () => {
    setModel(true);
    getGenerativeModel.mockReturnValue({ generateContent: async () => ({ response: { text: () => "{}" } }) });
    const r = await run(task, PROMPT, {});
    expect(r.source).toBe("on_device");
    expect(r.reason).toMatch(/only on this device/i);
  });

  it("is never posted to the agent's queue, even when the agent is chosen and connected", async () => {
    setModel(true);
    agentQueue.setProvider("agent");
    agentQueue.setConnected(true);
    getGenerativeModel.mockReturnValue({ generateContent: async () => ({ response: { text: () => "{}", inferenceSource: "on_device" } }) });
    await expect(run(task, PROMPT, {}, ctx)).resolves.toMatchObject({ source: "on_device" });
    expect(agentQueue.open()).toHaveLength(0);
  });

  it("the grounded (web search) run refuses it before anything is built", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setModel(true);
    await expect(runGrounded(task, PROMPT)).rejects.toBeTruthy();
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });
});
