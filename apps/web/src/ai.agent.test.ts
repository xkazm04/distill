// "Your agent is the AI": run() posts page and structure tasks to the agent's queue when the person chose "My agent"
// and the helper program is connected; the answer passes the task's door; a values task is never posted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormStructure, PageModel } from "@distill/engine";

const getGenerativeModel = vi.fn();
vi.mock("firebase/ai", () => ({ getGenerativeModel: (...a: unknown[]) => getGenerativeModel(...a) }));
vi.mock("./firebase", () => ({
  isFirebaseConfigured: () => true,
  getFirebase: async () => ({ ai: {} }),
  remoteValue: (_s: unknown, key: string) => (key === "inference_mode" ? "prefer_on_device" : "gemini-3.5-flash-lite"),
}));

const { run, AiError, AGENT_REASON, aiAvailable } = await import("./ai");
const { agentQueue, AgentQueue, AnswerRefused, PROVIDER_KEY, readProvider, AGENT_TIMEOUT_MS } = await import("./ui/agentQueue");
const { engine } = await import("./ui/engine");

const PAGE: PageModel = {
  url: "https://office.example/info", title: "Info", lang: "cs", kind: "article",
  blocks: [{ id: "b0", kind: "paragraph", text: "Žádost se podává do 30 dnů." }, { id: "b1", kind: "paragraph", text: "Poplatek je 100 Kč." }],
};
const FORM: FormStructure = {
  fingerprint: "fpA", url: PAGE.url, lang: "cs", title: "Form",
  fields: [{ fieldId: "name", kind: "text", label: "Jméno", required: true }, { fieldId: "email", kind: "email", label: "E-mail", required: false }],
};

/** Waits until the queue holds `n` tasks (run() computes the pageToken before it posts). */
async function posted(n = 1) {
  for (let i = 0; i < 200 && agentQueue.open().length < n; i++) await new Promise((r) => setTimeout(r, 1));
  return agentQueue.open();
}

beforeEach(async () => {
  agentQueue.setProvider("agent");
  agentQueue.setConnected(true);
  const token = await engine.pageToken(PAGE);
  agentQueue.currentToken = async () => token;
});
afterEach(() => {
  agentQueue.failAll("cancelled");
  agentQueue.setConnected(false);
  agentQueue.setProvider("distill");
  agentQueue.currentToken = null;
  getGenerativeModel.mockReset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the queue round trip, per task", () => {
  it("simplify: posted with its prompt, schema and pageToken; the agent's answer comes back as source agent", async () => {
    const r = run("simplifyBlocks", "PROMPT", engine.schemas.simplify, { page: PAGE });
    const [t] = await posted();
    expect(t).toMatchObject({ task: "simplifyBlocks", prompt: "PROMPT", schema: engine.schemas.simplify, pageToken: await engine.pageToken(PAGE) });
    expect(typeof t?.postedAt).toBe("string");
    // A first answer with nothing usable is refused with reasons; the agent retries.
    expect(await agentQueue.answer(t!.taskId, JSON.stringify({ blocks: [{ id: "b9", text: "x" }] }))).toMatchObject({ accepted: false, dropped: 1 });
    expect(await agentQueue.answer(t!.taskId, "not json")).toMatchObject({ accepted: false });
    expect(await agentQueue.answer(t!.taskId, JSON.stringify({ blocks: [{ id: "b0", text: "Apply within 30 days." }, { id: "b7", text: "?" }] })))
      .toEqual({ accepted: true, dropped: 1, errors: [expect.stringMatching(/b7/)] });
    const out = await r;
    expect(out.source).toBe("agent");
    expect(out.reason).toBe(AGENT_REASON);
    expect(out.data).toEqual({ blocks: [{ id: "b0", text: "Apply within 30 days." }, { id: "b7", text: "?" }] });
    expect(agentQueue.open()).toEqual([]);
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it("buildWizard: the structure task, its door is parseWizard", async () => {
    const r = run("buildWizard", "WIZARD PROMPT", engine.schemas.wizard, { structure: FORM, readerLang: "en" });
    const [t] = await posted();
    expect(t?.task).toBe("buildWizard");
    expect(await agentQueue.answer(t!.taskId, JSON.stringify({ steps: [{ fieldIds: ["nope"], question: "?" }] }))).toMatchObject({ accepted: false });
    const v = await agentQueue.answer(t!.taskId, JSON.stringify({ steps: [{ stepId: "s1", fieldIds: ["name"], question: "Your first name?", explanation: "As in your passport." }] }));
    expect(v).toEqual({ accepted: true, dropped: 0, errors: [] });
    const out = await r;
    expect(out.source).toBe("agent");
    expect(engine.parseWizard(out.data, FORM, "en").steps[0]?.question).toBe("Your first name?");
  });

  it("recast: its door is validateAndRepair, with the kinds switched on", async () => {
    const r = run("recast", "RECAST PROMPT", engine.schemas.recast, { page: PAGE, kinds: ["summary"] });
    const [t] = await posted();
    expect(await agentQueue.answer(t!.taskId, JSON.stringify({ nodes: [{ kind: "steps", items: ["a"], sourceBlockIds: [] }] }))).toMatchObject({ accepted: false, dropped: 1 });
    expect(await agentQueue.answer(t!.taskId, JSON.stringify({ version: 1, nodes: [{ kind: "summary", text: "Apply in 30 days.", sourceBlockIds: ["b0"] }] }))).toMatchObject({ accepted: true, dropped: 0 });
    expect((await r).source).toBe("agent");
  });
});

describe("the agent's answer is bound to the page", () => {
  it("refuses an answer when the page changed, and the view hears it in plain words", async () => {
    const r = run("simplifyBlocks", "PROMPT", engine.schemas.simplify, { page: PAGE });
    const [t] = await posted();
    agentQueue.currentToken = async () => "another page";
    const refused = await agentQueue.answer(t!.taskId, JSON.stringify({ blocks: [{ id: "b0", text: "x" }] })).then(() => null, (e: unknown) => e);
    expect(refused).toBeInstanceOf(AnswerRefused);
    expect((refused as InstanceType<typeof AnswerRefused>).code).toBe("stale_page");
    const err = await r.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as InstanceType<typeof AiError>).kind).toBe("agent-stale");
    expect((err as InstanceType<typeof AiError>).retry).toBe(true);
    // The task is gone: a second answer is for an unknown task.
    await expect(agentQueue.answer(t!.taskId, "{}")).rejects.toMatchObject({ code: "unknown_task" });
  });
});

describe("values law: a values task is never queued", () => {
  it("run() keeps suggestValue, checkValue and draftReply on the device even with My agent chosen", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const task of ["suggestValue", "checkValue", "draftReply"] as const) {
      const err = await run(task, "MY OWN VALUES", null).then(() => null, (e: unknown) => e);
      expect((err as InstanceType<typeof AiError>).kind, task).toBe("device-only"); // no LanguageModel in the test
    }
    expect(agentQueue.open()).toEqual([]);
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it("the queue itself refuses a values task (and any task without a door)", async () => {
    for (const task of ["suggestValue", "checkValue", "draftReply", "classifyPage"] as const) {
      await expect(agentQueue.post(task, "MY OWN VALUES", null, {}), task).rejects.toThrow(/never given to an agent/);
    }
    expect(agentQueue.open()).toEqual([]);
  });
});

describe("the waiting state ends in plain words", () => {
  it("180 s with no answer is a timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = run("simplifyBlocks", "PROMPT", engine.schemas.simplify, { page: PAGE }).then(() => null, (e: unknown) => e);
    // The pageToken is a real sha-256 (not a timer): wait for the post with setImmediate, which is not faked.
    for (let i = 0; i < 500 && agentQueue.open().length === 0; i++) await new Promise((ok) => setImmediate(ok));
    expect(agentQueue.open()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(AGENT_TIMEOUT_MS);
    const err = (await r) as InstanceType<typeof AiError>;
    expect(AGENT_TIMEOUT_MS).toBe(180_000);
    expect(err.kind).toBe("agent-timeout");
    expect(err.message).toBe("Your agent did not answer in time.");
    expect(agentQueue.open()).toEqual([]);
  });

  it("Cancel stops waiting; the helper program going away ends every task", async () => {
    const a = run("simplifyBlocks", "P", engine.schemas.simplify, { page: PAGE }).then(() => null, (e: unknown) => e);
    const [t] = await posted();
    agentQueue.cancel(t!.taskId);
    expect(((await a) as InstanceType<typeof AiError>).kind).toBe("agent-cancelled");
    const b = run("recast", "P", engine.schemas.recast, { page: PAGE }).then(() => null, (e: unknown) => e);
    await posted();
    agentQueue.setConnected(false);
    expect(((await b) as InstanceType<typeof AiError>).kind).toBe("agent-gone");
  });

  it('"Use Distill\'s AI instead" runs the task the usual way', async () => {
    getGenerativeModel.mockReturnValue({ generateContent: async () => ({ response: { text: () => '{"blocks":[]}', inferenceSource: "in_cloud" } }) });
    const r = run("simplifyBlocks", "P", engine.schemas.simplify, { page: PAGE });
    const [t] = await posted();
    agentQueue.useDistill(t!.taskId);
    expect((await r).source).toBe("in_cloud");
    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
  });
});

describe("who does the AI work", () => {
  it("Distill unless the person chose My agent AND the helper program is connected", async () => {
    getGenerativeModel.mockReturnValue({ generateContent: async () => ({ response: { text: () => "{}", inferenceSource: "on_device" } }) });
    agentQueue.setProvider("distill");
    await expect(run("simplifyBlocks", "P", {}, { page: PAGE })).resolves.toMatchObject({ source: "on_device" });
    agentQueue.setProvider("agent");
    agentQueue.setConnected(false);
    await expect(run("simplifyBlocks", "P", {}, { page: PAGE })).resolves.toMatchObject({ source: "on_device" });
    expect(agentQueue.open()).toEqual([]);
  });

  it("the choice is kept per viewer, on this device, under distill.aiProvider", () => {
    expect(PROVIDER_KEY).toBe("distill.aiProvider");
    agentQueue.setProvider("agent");
    expect(localStorage.getItem(PROVIDER_KEY)).toBe("agent");
    expect(readProvider()).toBe("agent");
    agentQueue.setProvider("distill");
    expect(localStorage.getItem(PROVIDER_KEY)).toBeNull();
    expect(readProvider()).toBe("distill");
  });

  it("an agent makes AI available even where Firebase is not set up", () => {
    expect(aiAvailable(true)).toBe(true);
  });
});

describe("distill_tasks long poll", () => {
  it("answers at once when a task waits, else when one is posted, else empty after the wait", async () => {
    const q = new AgentQueue();
    q.setProvider("agent");
    q.setConnected(true);
    expect(await q.take(20)).toEqual([]);
    const seen: string[] = [];
    const poll = q.take(5000, (fresh) => seen.push(...fresh.map((t) => t.task)));
    const answer = q.post("simplifyBlocks", "P", null, { page: PAGE });
    const tasks = await poll;
    expect(tasks.map((t) => t.task)).toEqual(["simplifyBlocks"]);
    expect(seen).toEqual(["simplifyBlocks"]);
    // Still unanswered: handed out again (an agent that restarts finds its work), but not "new" any more.
    expect((await q.take(0, (fresh) => seen.push(...fresh.map((t) => t.task)))).map((t) => t.taskId)).toEqual([tasks[0]?.taskId]);
    expect(seen).toEqual(["simplifyBlocks"]);
    q.failAll("cancelled");
    await expect(answer).rejects.toMatchObject({ kind: "cancelled" });
  });
});
