// Explain this word (r4-05), the frame side: from the page with no model, through the one door with the model on this
// device, and never anywhere else (no model, a blocked frame, an answer not from this device, the offscreen document).
import { beforeEach, describe, expect, it, vi } from "vitest";

const runTask = vi.fn();
const state = { fake: null as object | null, blocked: false, ai: true, model: "available" };
vi.mock("./runTask", () => ({
  runTask: (...a: unknown[]) => runTask(...a),
  e2eFake: async () => state.fake,
  canRunTask: async () => state.ai,
}));
vi.mock("../../offscreen/client", () => ({ deviceModelBlocked: () => state.blocked }));
vi.mock("@distill/web/ai", async (importOriginal) => ({ ...(await importOriginal<object>()), localModelState: async () => state.model }));
vi.mock("./send", () => ({ send: vi.fn(), tabId: 7 }));

const { explainAnswer, EXPLAIN_BLOCKER_WORDS } = await import("./Explain");
const ASK = { term: "daňové přiznání", sentence: "Daňové přiznání se podává do 1. dubna." };

describe("explainAnswer", () => {
  beforeEach(() => { runTask.mockReset(); Object.assign(state, { fake: null, blocked: false, ai: true, model: "available" }); });

  it("an abbreviation the page spelled out is answered from the page, with no model run", async () => {
    await expect(explainAnswer({ ...ASK, term: "OSVČ", spelled: "osoba samostatně výdělečně činná" })).resolves.toEqual({ text: "osoba samostatně výdělečně činná", source: "page" });
    expect(runTask).not.toHaveBeenCalled();
  });

  it("runs explainTerm on this device and passes the answer through the door", async () => {
    runTask.mockResolvedValue({ data: { text: "A yearly statement of income. Third sentence. Fourth." }, source: "on_device", ms: 5, reason: "" });
    await expect(explainAnswer(ASK)).resolves.toEqual({ text: "A yearly statement of income. Third sentence.", source: "on_device" });
    const [task, prompt, schema, ctx] = runTask.mock.calls[0] as [string, string, object, object];
    expect(task).toBe("explainTerm");
    expect(prompt).toContain("<term>\ndaňové přiznání\n</term>");
    expect(schema).toEqual({ type: "object", properties: { text: { type: "string" } }, required: ["text"] });
    expect(ctx).toEqual({ term: "daňové přiznání", sentence: ASK.sentence });
  });

  it("an answer with markup or a link is refused, an empty one says the model does not know", async () => {
    runTask.mockResolvedValue({ data: { text: "See <a href=x>this</a>" }, source: "on_device", ms: 5, reason: "" });
    await expect(explainAnswer(ASK)).resolves.toMatchObject({ source: "refused", text: expect.stringMatching(/could not be used/) });
    runTask.mockResolvedValue({ data: { text: "" }, source: "on_device", ms: 5, reason: "" });
    await expect(explainAnswer(ASK)).resolves.toMatchObject({ source: "refused", text: expect.stringMatching(/does not know/) });
  });

  it("an answer not from this device is never shown as one", async () => {
    runTask.mockResolvedValue({ data: { text: "A tax return." }, source: "in_cloud", ms: 5, reason: "" });
    await expect(explainAnswer(ASK)).resolves.toMatchObject({ source: "refused" });
    runTask.mockResolvedValue({ data: { text: "A tax return." }, source: "on_device", ms: 5, reason: "", via: "offscreen" });
    await expect(explainAnswer(ASK)).resolves.toMatchObject({ source: "refused" });
  });

  it("with no model, a model not downloaded, or a blocked frame: says why and runs nothing", async () => {
    for (const [s, why] of [
      [{ ai: false }, "no-ai"], [{ model: "downloadable" }, "not-downloaded"], [{ model: "unavailable" }, "no-model"], [{ blocked: true }, "blocked"],
    ] as const) {
      Object.assign(state, { fake: null, blocked: false, ai: true, model: "available" }, s);
      await expect(explainAnswer(ASK), why).resolves.toEqual({ text: EXPLAIN_BLOCKER_WORDS[why], source: "refused" });
    }
    expect(runTask).not.toHaveBeenCalled();
  });

  it("a failed run says so in plain words", async () => {
    runTask.mockRejectedValue(new Error("busy"));
    await expect(explainAnswer(ASK)).resolves.toMatchObject({ source: "refused", text: expect.stringMatching(/^Not explained: /) });
  });

  it("an empty or too long selection is not run", async () => {
    await expect(explainAnswer({ ...ASK, term: "  " })).resolves.toMatchObject({ source: "refused" });
    await expect(explainAnswer({ ...ASK, term: "x".repeat(81) })).resolves.toMatchObject({ source: "refused" });
    expect(runTask).not.toHaveBeenCalled();
  });

  it("every reason says the words are not sent anywhere else", () => {
    for (const words of Object.values(EXPLAIN_BLOCKER_WORDS)) expect(words).toMatch(/never sent|not sent/);
  });
});
