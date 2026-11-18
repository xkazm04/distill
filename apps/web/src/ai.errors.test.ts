import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_WORDS, AiError, aiWords, run, toAiError } from "./ai";
import { fakeRun } from "./dev/fake-ai";
import type { Task } from "./ui/engine";

/** Errors shaped like the Firebase AI SDK's (code + customErrorData.status + "[NNN ...]" in the message). */
const sdk = (code: string, message: string, status?: number) =>
  Object.assign(new Error(message), { name: "FirebaseError", code, ...(status ? { customErrorData: { status } } : {}) });

const RAW = /\[|\]|https?:|Unexpected token|AI\//;

describe("toAiError: one place turns a failure into plain words", () => {
  it("overload, rate limit, 5xx and timeouts are 'busy' and can be tried again", () => {
    const cases = [
      sdk("fetch-error", "AI: Error fetching from https://x/m:generateContent: [500 Internal Server Error] This model is currently experiencing high demand.", 500),
      sdk("fetch-error", "[503 Service Unavailable]", 503),
      sdk("fetch-error", "[429 Too Many Requests]", 429),
      new Error("Error fetching from https://x: [502 Bad Gateway]"),
      Object.assign(new Error("Timeout has expired."), { name: "AbortError" }),
    ];
    for (const e of cases) {
      const a = toAiError(e);
      expect(a.kind).toBe("busy");
      expect(a.message).toBe("The AI is busy right now. Try again in a moment.");
      expect(a.retry).toBe(true);
    }
  });

  it("App Check and 401/403 say the app could not prove it is genuine, with no retry", () => {
    for (const e of [
      sdk("fetch-error", "[401 Unauthorized] Firebase App Check token is invalid.", 401),
      sdk("fetch-error", "[403 Forbidden] Requests from this referrer are blocked.", 403),
      new Error("AppCheck: ReCAPTCHA error."),
    ]) {
      const a = toAiError(e);
      expect(a.kind).toBe("not-genuine");
      expect(a.message).toBe("This app could not prove it is genuine to the AI service.");
      expect(a.retry).toBe(false);
    }
  });

  it("no local model for a values task is the device-only note, never a cloud hint", () => {
    const e = sdk("unsupported", "Inference mode is ONLY_ON_DEVICE, but an on-device model is not available.");
    expect(toAiError(e, true).kind).toBe("device-only");
    expect(toAiError(sdk("api-not-enabled", "Local LanguageModel API not available in this environment."), true).message).toBe(AI_WORDS["device-only"]);
    expect(toAiError(sdk("unsupported", "something else unsupported"), true).kind).toBe("device-only");
  });

  it("anything else, including an unreadable reply and a project set-up problem, is the general sentence", () => {
    for (const e of [new SyntaxError("Unexpected token 'S', \"Sure!\" is not valid JSON"), sdk("api-not-enabled", "The Firebase AI SDK requires ... [403]", 403), "a string", null]) {
      const a = toAiError(e);
      expect(a.kind).toBe("other");
      expect(a.message).toBe("Something went wrong with the AI.");
    }
  });

  it("an AiError passes through unchanged, and aiWords never returns raw text", () => {
    const a = new AiError("busy");
    expect(toAiError(a)).toBe(a);
    expect(aiWords(new Error("[500 Internal Server Error] https://x"))).not.toMatch(RAW);
  });
});

describe("run(): every failure leaves as an AiError, the raw error goes to the console only", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  const tryRun = async (task: Task, fail: string) => {
    window.history.replaceState({}, "", `/?aifail=${fail}`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const err = await run(task, "prompt", {}, {}).then(() => null, (e: unknown) => e);
    return { err: err as AiError, warn };
  };

  it("maps each designed failure of the dev fake through the same door as a real one", async () => {
    const cases: [Task, string, string][] = [
      ["recast", "busy", "busy"],
      ["simplifyBlocks", "genuine", "not-genuine"],
      ["suggestValue", "device", "device-only"],
      ["draftReply", "device", "device-only"],
      ["buildWizard", "other", "other"],
    ];
    for (const [task, fail, kind] of cases) {
      const { err, warn } = await tryRun(task, fail);
      expect(err, `${task}/${fail}`).toBeInstanceOf(AiError);
      expect(err.kind).toBe(kind);
      expect(err.message).not.toMatch(RAW);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[1])).toMatch(/\S/); // the raw error is logged
      vi.restoreAllMocks();
    }
  });

  it("a failure aimed at one task leaves the others alone", async () => {
    window.history.replaceState({}, "", "/?aifail=busy:recast");
    await expect(run("simplifyBlocks", "p", {}, { page: undefined })).resolves.toBeTruthy();
  });
});

describe("dev fake AI", () => {
  const page = {
    url: "https://x.example/", title: "T", lang: "cs", kind: "article" as const,
    blocks: [{ id: "b0", kind: "paragraph" as const, text: "One. Two." }],
  };
  it("answers simplify in schemas.simplify's shape, and 'empty' answers with nothing", () => {
    expect(fakeRun("simplifyBlocks", { page })).toEqual({ blocks: [{ id: "b0", text: "One." }] });
    expect(fakeRun("simplifyBlocks", { page }, "empty")).toEqual({ blocks: [] });
    expect(fakeRun("recast", { page }, "empty")).toEqual({ version: 1, nodes: [] });
  });
  it("covers the Envelope reply tasks so dev screens do not crash", () => {
    const wizard = fakeRun("buildReplyWizard", {}) as { steps: { stepId: string; question: string; explanation: string }[] };
    expect(wizard.steps.map((s) => s.stepId)).toEqual(["r0", "r1"]);
    for (const s of wizard.steps) expect(s.question && s.explanation).toBeTruthy();
    expect((fakeRun("draftReply", {}) as { reply: string }).reply).toMatch(/\S/);
    expect((fakeRun("readLetter", {}) as { summary: string; actions: unknown[] }).actions.length).toBeGreaterThan(0);
    for (const t of ["classifyPage", "explainField", "suggestValue", "checkValue", "explainError"] as Task[]) expect(fakeRun(t, {})).toBeDefined();
  });
});
