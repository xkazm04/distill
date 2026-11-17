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
