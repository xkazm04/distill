// Round 2, card 2: the grounded run (the web check). The cloud model gets the Google Search tool; the sources come
// from the response's grounding metadata, never from the model's text; only a cloud-only page task may come here.
import { afterEach, describe, expect, it, vi } from "vitest";

const getGenerativeModel = vi.fn();
vi.mock("firebase/ai", () => ({ getGenerativeModel: (...a: unknown[]) => getGenerativeModel(...a) }));
vi.mock("./firebase", () => ({
  isFirebaseConfigured: () => true,
  getFirebase: async () => ({ ai: {} }),
  remoteValue: (_s: unknown, key: string) => (key === "inference_mode" ? "prefer_on_device" : "a-cloud-model"),
}));

const { runGrounded, groundingOf, lenientJson, AiError } = await import("./ai");

const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZ1";
function respond(text: string, extra: object = {}) {
  getGenerativeModel.mockReturnValue({
    generateContent: async () => ({
      response: {
        text: () => text,
        inferenceSource: "in_cloud",
        candidates: [{
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: redirect, title: "reuters.com" } },
              { web: { uri: "https://example.org/b", domain: "example.org" } },
              { maps: { uri: "https://maps.example" } },
              { web: { title: "no uri" } },
            ],
            webSearchQueries: ["prague population 2026"],
            searchEntryPoint: { renderedContent: "<div>chip</div>" },
          },
        }],
        ...extra,
      },
    }),
  });
}

describe("runGrounded", () => {
  afterEach(() => { getGenerativeModel.mockReset(); vi.restoreAllMocks(); });

  it("builds the cloud model with the Google Search tool and no response schema", async () => {
    respond('{"verdict":"supported","reason":"Yes."}');
    await runGrounded("checkClaim", "prompt");
    const [, params, opts] = getGenerativeModel.mock.calls[0] as [unknown, { mode: string; inCloudParams: { model: string; tools: unknown[]; generationConfig?: unknown }; onDeviceParams?: unknown }, { timeout: number }];
    expect(params.mode).toBe("only_in_cloud");
    expect(params.inCloudParams.model).toBe("a-cloud-model");
    expect(params.inCloudParams.tools).toEqual([{ googleSearch: {} }]);
    expect(params.inCloudParams.generationConfig).toBeUndefined();
    expect(params.onDeviceParams).toBeUndefined();
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it("returns the data, where it ran, the Sieve's reason, and the sources from the grounding metadata", async () => {
    respond('```json\n{"verdict":"disputed","reason":"No.","sources":["https://made-up.example"]}\n```');
    const r = await runGrounded("checkClaim", "prompt");
    expect(r.data).toEqual({ verdict: "disputed", reason: "No.", sources: ["https://made-up.example"] });
    expect(r.source).toBe("in_cloud");
    expect(r.reason).toMatch(/only this sentence, the page's title and its address/);
    expect(r.grounding).toEqual([{ url: redirect, title: "reuters.com" }, { url: "https://example.org/b", title: "example.org" }]);
    expect(r.queries).toEqual(["prague population 2026"]);
  });

  it("hands unparseable text on as text, for the door to refuse", async () => {
    respond("Sure! The claim looks right to me.");
    expect((await runGrounded("checkClaim", "prompt")).data).toBe("Sure! The claim looks right to me.");
  });

  it("refuses any task that is not cloud-only (a page task on device first, a values task) before a model exists", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const task of ["suggestValue", "draftReply", "simplifyBlocks", "translateBlocks"] as const) {
      const err = await runGrounded(task, "my values").then(() => null, (e: unknown) => e);
      expect(err, task).toBeInstanceOf(AiError);
    }
    expect(getGenerativeModel).not.toHaveBeenCalled();
  });

  it("a failed call leaves in plain words (App Check, overload)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    getGenerativeModel.mockReturnValue({
      generateContent: async () => { throw Object.assign(new Error("[401 Unauthorized] Firebase App Check token is invalid."), { code: "fetch-error" }); },
    });
    const err = await runGrounded("checkClaim", "p").then(() => null, (e: unknown) => e);
    expect((err as InstanceType<typeof AiError>).kind).toBe("not-genuine");
  });
});

describe("grounding helpers", () => {
  it("groundingOf survives a response with no candidates or metadata", () => {
    expect(groundingOf({})).toEqual({ grounding: [], queries: [] });
    expect(groundingOf({ candidates: [{}] })).toEqual({ grounding: [], queries: [] });
  });
  it("lenientJson reads fenced or wrapped JSON and leaves other text alone", () => {
    expect(lenientJson('{"a":1}')).toEqual({ a: 1 });
    expect(lenientJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(lenientJson('Answer: {"a":1}.')).toEqual({ a: 1 });
    expect(lenientJson("no json")).toBe("no json");
  });
});
