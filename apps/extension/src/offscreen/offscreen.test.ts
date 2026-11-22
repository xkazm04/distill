// The offscreen document (docs/caption.md, risk 1): the frame knows when the page forbids the on-device model, the
// document's one door refuses a person's values, and the worker opens the document on demand and closes it when the
// last caption is gone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@distill/engine";
import type { RunResult } from "@distill/web/ai";
import { deviceModelBlocked } from "./client";
import { answer, OFFSCREEN_PORT, type OffscreenAsk } from "./protocol";

const policy = (features: string[], allowed: boolean) =>
  ({ featurePolicy: { features: () => features, allowsFeature: (f: string) => allowed && features.includes(f) } }) as unknown as Document;

describe("deviceModelBlocked", () => {
  it("true when the page's policy denies language-model to this frame", () => {
    expect(deviceModelBlocked(policy(["language-model", "camera"], false))).toBe(true);
  });
  it("false when the policy allows it, when the browser does not know the feature, or cannot say", () => {
    expect(deviceModelBlocked(policy(["language-model"], true))).toBe(false);
    expect(deviceModelBlocked(policy(["camera"], false))).toBe(false);
    expect(deviceModelBlocked({} as Document)).toBe(false);
  });
});

const ok = (source: RunResult<unknown>["source"] = "on_device"): RunResult<unknown> => ({ data: { blocks: [] }, source, ms: 3, reason: "Runs on this device when it can." });
const ask = (task: Task, extra: Partial<OffscreenAsk> = {}): Omit<OffscreenAsk, "id"> => ({ task, prompt: "p", schema: null, context: {}, ...extra });

describe("the offscreen document's door", () => {
  it("runs a page task and answers with the run's own source and reason", async () => {
    const run = vi.fn(async () => ok("in_cloud"));
    const r = await answer(ask("translateBlocks"), { run, kindOf: () => "other" });
    expect(run).toHaveBeenCalledWith("translateBlocks", "p", null, {});
    expect(r).toEqual({ ok: true, result: ok("in_cloud") });
  });

  it("refuses every values task before anything runs", async () => {
    for (const task of ["suggestValue", "checkValue", "explainError", "draftReply", "noSuchTask"] as Task[]) {
      const run = vi.fn(async () => ok());
      const fake = vi.fn(async () => ok());
      expect(await answer(ask(task, { fake: {} }), { run, fake, kindOf: () => "other" })).toEqual({ ok: false, kind: "other", refused: "values" });
      expect(run).not.toHaveBeenCalled();
      expect(fake).not.toHaveBeenCalled();
    }
  });

  it("a failed run answers its kind; the stand-in model runs only when the ask carries its switch", async () => {
    const run = vi.fn(async () => { throw new Error("boom"); });
    expect(await answer(ask("translateBlocks"), { run, kindOf: () => "busy" })).toEqual({ ok: false, kind: "busy" });
    const fake = vi.fn(async () => ok());
    await answer(ask("translateBlocks", { fake: { source: "on_device" } }), { run, fake, kindOf: () => "other" });
    expect(fake).toHaveBeenCalledTimes(1);
  });
});

describe("the service worker opens and closes it", () => {
  type Fn = (...a: never[]) => unknown;
  let contexts = 0;
  const created = vi.fn();
  const closed = vi.fn();
  const sent: unknown[] = [];

  beforeEach(() => {
    contexts = 0;
    created.mockClear();
    closed.mockClear();
    sent.length = 0;
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: "ext",
        getURL: (p: string) => `chrome-extension://ext/${p}`,
        ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
        getContexts: async () => Array.from({ length: contexts }, () => ({})),
        sendMessage: async (m: unknown) => { sent.push(m); return { ok: true, result: ok() }; },
      },
      offscreen: {
        Reason: { WORKERS: "WORKERS" },
        createDocument: async (o: unknown) => { created(o); contexts = 1; },
        closeDocument: async () => { closed(); contexts = 0; },
      },
    };
  });

  function port(url = "chrome-extension://ext/caption.html?tabId=3") {
    const on: { message?: Fn; disconnect?: Fn } = {};
    const posted: unknown[] = [];
    return {
      posted, on,
      name: OFFSCREEN_PORT,
      sender: { id: "ext", url },
      postMessage: (m: unknown) => posted.push(m),
      disconnect: vi.fn(),
      onMessage: { addListener: (l: Fn) => { on.message = l; } },
      onDisconnect: { addListener: (l: Fn) => { on.disconnect = l; } },
    };
  }

  it("opens the document on the first ask, relays the task, and closes it when the last caption goes", async () => {
    const { offscreenPort } = await import("./host");
    const a = port();
    const b = port();
    expect(offscreenPort(a as unknown as chrome.runtime.Port)).toBe(true);
    expect(offscreenPort(b as unknown as chrome.runtime.Port)).toBe(true);
    expect(created).not.toHaveBeenCalled(); // a port alone opens nothing
    (a.on.message as (m: OffscreenAsk) => void)({ id: 1, ...ask("translateBlocks") });
    await vi.waitFor(() => expect(a.posted).toHaveLength(1));
    expect(a.posted[0]).toEqual({ id: 1, ok: true, result: ok() });
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0]?.[0]).toMatchObject({ url: "offscreen.html", reasons: ["WORKERS"] });
    expect(sent[0]).toEqual({ type: "distill:offscreen:run", ask: ask("translateBlocks") });
    (a.on.disconnect as () => void)();
    await new Promise((r) => setTimeout(r, 10));
    expect(closed).not.toHaveBeenCalled(); // another caption still holds a port
    (b.on.disconnect as () => void)();
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  });

  it("never takes a port a content script opened, and leaves other ports to the rest of the worker", async () => {
    const { offscreenPort } = await import("./host");
    const page = port("https://www.example.cz/clanek");
    expect(offscreenPort(page as unknown as chrome.runtime.Port)).toBe(true);
    expect(page.disconnect).toHaveBeenCalled();
    expect(page.on.message).toBeUndefined();
    expect(offscreenPort({ ...port(), name: "handrail" } as unknown as chrome.runtime.Port)).toBe(false);
  });
});
