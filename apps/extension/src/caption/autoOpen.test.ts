// r2-08: the service worker opens the caption by itself on a remembered site (chrome mocked): only once the load is
// complete, only with the permission actually held, only the top frame, and never twice at once. A permission taken
// back in Chrome's settings drops the site.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SITES_KEY } from "./sites";

const local = new Map<string, unknown>();
const contains = vi.fn(async (_p: { origins: string[] }) => true);
const executeScript = vi.fn(async (_i: unknown) => [] as unknown[]);
const sendMessage = vi.fn(async (_t: number, _m: unknown, _o: unknown): Promise<unknown> => ({ ok: true, data: { open: true } }));

(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: async (k: string) => (local.has(k) ? { [k]: local.get(k) } : {}),
      set: async (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) local.set(k, v); },
      remove: async (k: string) => { local.delete(k); },
    },
  },
  permissions: { contains },
  scripting: { executeScript },
  tabs: { sendMessage },
};
const { onTabUpdated, onPermissionsRemoved } = await import("./autoOpen");

const SITE = "https://www.idnes.cz";
beforeEach(() => {
  local.clear();
  local.set(SITES_KEY, { [SITE]: { since: 1, asked: true, prefs: { shown: [] } } });
  contains.mockReset().mockResolvedValue(true);
  executeScript.mockClear();
  sendMessage.mockReset().mockResolvedValue({ ok: true, data: { open: true } });
});

describe("opening by itself", () => {
  it("puts the content script in the top frame and asks it to open, marked automatic", async () => {
    expect(await onTabUpdated(7, "complete", `${SITE}/zpravy/clanek`)).toBe(true);
    expect(contains).toHaveBeenCalledWith({ origins: [`${SITE}/*`] });
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["content.js"] });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: "distill:caption:open", tabId: 7, auto: true }, { frameId: 0 });
  });

  it("does nothing before the load is complete, on a site not remembered, or without a URL (no permission)", async () => {
    expect(await onTabUpdated(7, "loading", `${SITE}/`)).toBe(false);
    expect(await onTabUpdated(7, "complete", "https://www.seznam.cz/")).toBe(false);
    expect(await onTabUpdated(7, "complete", undefined)).toBe(false);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("respects the permission actually granted: none, no open", async () => {
    contains.mockResolvedValue(false);
    expect(await onTabUpdated(7, "complete", `${SITE}/`)).toBe(false);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("does not start a second open while one is under way in the same tab", async () => {
    let answer!: (v: unknown) => void;
    sendMessage.mockImplementationOnce(() => new Promise((ok) => { answer = ok; }));
    const first = onTabUpdated(7, "complete", `${SITE}/`);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(await onTabUpdated(7, "complete", `${SITE}/`)).toBe(false);
    answer({ ok: true, data: { open: true } });
    expect(await first).toBe(true);
    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it("reports closed when the page refused (the person closed Distill on this document)", async () => {
    sendMessage.mockResolvedValue({ ok: true, data: { open: false } });
    expect(await onTabUpdated(7, "complete", `${SITE}/`)).toBe(false);
  });
});

describe("permission taken back", () => {
  it("drops the site, so the next load does not open", async () => {
    await onPermissionsRemoved([`${SITE}/*`]);
    expect(local.has(SITES_KEY)).toBe(false);
    expect(await onTabUpdated(7, "complete", `${SITE}/`)).toBe(false);
  });

  it("keeps the sites another removal did not cover", async () => {
    await onPermissionsRemoved(["https://other.cz/*"]);
    expect(Object.keys(local.get(SITES_KEY) as object)).toEqual([SITE]);
    await onPermissionsRemoved(undefined);
    expect(local.has(SITES_KEY)).toBe(true);
  });
});
