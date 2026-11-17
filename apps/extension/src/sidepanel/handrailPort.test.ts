// nativeMessaging is optional: the panel opens no Handrail connection until the person allowed it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectHandrail, helperAllowed, requestHelper } from "./handrailPort";

const port = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() } };
const connect = vi.fn(() => port);
const request = vi.fn(async () => true);
const contains = vi.fn(async () => false);

beforeEach(() => {
  connect.mockClear(); port.postMessage.mockClear(); port.onMessage.addListener.mockClear();
  request.mockReset().mockResolvedValue(true);
  contains.mockReset().mockResolvedValue(false);
  (globalThis as { chrome?: unknown }).chrome = { runtime: { connect }, permissions: { request, contains } };
});

describe("the helper program's connection", () => {
  it("does not connect, or send, before connect()", () => {
    const p = connectHandrail();
    p.post({ id: "1", type: "tool.result", payload: { ok: true, result: {} } });
    expect(connect).not.toHaveBeenCalled();
    p.connect();
    expect(connect).toHaveBeenCalledWith({ name: "handrail" });
  });

  it("Connect your helper program requests nativeMessaging first, and connects only after a yes", async () => {
    const p = connectHandrail();
    expect(await requestHelper(p)).toBe(true);
    expect(request).toHaveBeenCalledWith({ permissions: ["nativeMessaging"] });
    expect(request.mock.invocationCallOrder[0]!).toBeLessThan(connect.mock.invocationCallOrder[0]!);
  });

  it("a no leaves it unconnected", async () => {
    request.mockResolvedValue(false);
    expect(await requestHelper(connectHandrail())).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });

  it("keeps the last status for a view that subscribes late (the helper is missing)", () => {
    const p = connectHandrail();
    p.connect();
    const fromWorker = port.onMessage.addListener.mock.calls.at(-1)![0] as (m: unknown) => void;
    const missing = { id: "s1", type: "status", payload: { connected: false, reason: "Specified native messaging host not found." } };
    fromWorker(missing); // before anyone listens
    const late = vi.fn();
    p.onMessage(late);
    expect(late).toHaveBeenCalledWith(missing);
    fromWorker({ id: "r1", type: "page.read", payload: {} });
    const later = vi.fn();
    p.onMessage(later);
    expect(later).toHaveBeenCalledTimes(1); // only the status is replayed, never a request
    expect(later).toHaveBeenCalledWith(missing);
  });

  it("helperAllowed asks Chrome whether the permission is held", async () => {
    expect(await helperAllowed()).toBe(false);
    expect(contains).toHaveBeenCalledWith({ permissions: ["nativeMessaging"] });
  });
});
