import { describe, expect, it, vi } from "vitest";
import { AccessError, TabHost } from "./host";

describe("TabHost", () => {
  it("keeps Chrome's own words when the page cannot be reached, for the access check", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      tabs: { sendMessage: vi.fn(async () => { throw new Error("Could not establish connection."); }) },
      scripting: { executeScript: vi.fn(async () => { throw new Error("Cannot access a chrome:// URL"); }) },
    };
    const err = await new TabHost(1, () => "").ping().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccessError);
    expect((err as AccessError).reason).toBe("Cannot access a chrome:// URL");
    expect((err as AccessError).message).toBe("Distill cannot read this page.");
  });

  it("injects the content script once when the page has none yet, then asks again", async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error("Could not establish connection."))
      .mockResolvedValue({ ok: true, data: { ok: true } });
    const executeScript = vi.fn(async () => []);
    (globalThis as { chrome?: unknown }).chrome = { tabs: { sendMessage }, scripting: { executeScript } };
    await new TabHost(9, () => "A page").locate({ fieldIds: ["a"] });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 9 }, files: ["content.js"] });
    expect(sendMessage).toHaveBeenLastCalledWith(9, expect.objectContaining({ type: "distill:locate", target: { fieldIds: ["a"] } }));
  });

  it("labels itself with the tab's current title", () => {
    let title = "";
    const host = new TabHost(1, () => title);
    expect(host.label()).toBe("This page");
    title = "Žádost o průkaz";
    expect(host.label()).toBe("Žádost o průkaz");
  });
});

describe("TabHost page actions", () => {
  it("lists actions through the content script", async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, data: [{ actionId: "a0", label: "Next", kind: "button" }] }));
    (globalThis as { chrome?: unknown }).chrome = { tabs: { sendMessage }, scripting: { executeScript: vi.fn() } };
    expect(await new TabHost(3, () => "").listActions()).toEqual([{ actionId: "a0", label: "Next", kind: "button" }]);
    expect(sendMessage).toHaveBeenCalledWith(3, { type: "distill:listActions" });
  });

  it("clicks once: no fresh content script and no second try when the page cannot be reached", async () => {
    const sendMessage = vi.fn(async () => { throw new Error("Could not establish connection. Receiving end does not exist."); });
    const executeScript = vi.fn(async () => []);
    (globalThis as { chrome?: unknown }).chrome = { tabs: { sendMessage }, scripting: { executeScript } };
    await expect(new TabHost(3, () => "").doAction("a0")).rejects.toThrow(/Receiving end/);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("a click that navigated away before it answered counts as done", async () => {
    const sendMessage = vi.fn(async () => { throw new Error("The message port closed before a response was received."); });
    (globalThis as { chrome?: unknown }).chrome = { tabs: { sendMessage }, scripting: { executeScript: vi.fn() } };
    await expect(new TabHost(3, () => "").doAction("a0")).resolves.toBeUndefined();
  });
});
