// The service worker: no native connection without the person's OK, Handrail relayed once it is given, and a closed
// tab's kept answers removed. chrome.* is mocked; the worker registers its listeners when it is imported.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Fn = (...a: never[]) => unknown;
const listeners: { connect?: (p: unknown) => void; removed?: (tabId: number) => void } = {};
const session = new Map<string, unknown>();
const contains = vi.fn(async () => false);
const nativePort = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() } };
const connectNative = vi.fn(() => nativePort);

beforeAll(async () => {
  (globalThis as { chrome?: unknown }).chrome = {
    sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
    runtime: { onConnect: { addListener: (l: Fn) => { listeners.connect = l as never; } }, connectNative, lastError: undefined },
    tabs: { onRemoved: { addListener: (l: Fn) => { listeners.removed = l as never; } } },
    permissions: { contains },
    storage: {
      session: {
        get: async (k: null) => (k === null ? Object.fromEntries(session) : {}),
        remove: async (keys: string[]) => { keys.forEach((k) => session.delete(k)); },
      },
    },
  };
  await import("./background");
});

function panelPort() {
  const onMessage: Fn[] = [];
  return {
    name: "handrail",
    postMessage: vi.fn(),
    onMessage: { addListener: (l: Fn) => onMessage.push(l) },
    onDisconnect: { addListener: vi.fn() },
    send: (m: unknown) => onMessage.forEach((l) => l(m as never)),
  };
}

beforeEach(() => { connectNative.mockClear(); nativePort.postMessage.mockClear(); contains.mockReset().mockResolvedValue(false); });

describe("Handrail relay", () => {
  it("opens no native connection without the nativeMessaging permission, and says why", async () => {
    const panel = panelPort();
    listeners.connect!(panel);
    await vi.waitFor(() => expect(panel.postMessage).toHaveBeenCalled());
    expect(contains).toHaveBeenCalledWith({ permissions: ["nativeMessaging"] });
    expect(connectNative).not.toHaveBeenCalled();
    expect(panel.postMessage.mock.calls[0]![0]).toMatchObject({ type: "status", payload: { connected: false } });
  });

  it("connects once it is allowed, and passes on what the panel sent meanwhile", async () => {
    contains.mockResolvedValue(true);
    const panel = panelPort();
    listeners.connect!(panel);
    panel.send({ id: "1", type: "tool.result", payload: { ok: true, result: {} } });
    await vi.waitFor(() => expect(connectNative).toHaveBeenCalledWith("dev.distill.handrail"));
    expect(nativePort.postMessage).toHaveBeenCalledWith({ id: "1", type: "tool.result", payload: { ok: true, result: {} } });
  });
});

describe("chrome.tabs.onRemoved", () => {
  it("clears the closed tab's guides and answers, and nothing else", async () => {
    session.set("guide:5:fp", { stepIndex: 1, answers: { jmeno: "Jana" } });
    session.set("guide:5:labels:https://office.example", { stepIndex: 0, answers: { "jméno": "Jana" } });
    session.set("guide:6:fp", { stepIndex: 0, answers: {} });
    listeners.removed!(5);
    await vi.waitFor(() => expect([...session.keys()]).toEqual(["guide:6:fp"]));
  });
});
