import { beforeEach, describe, expect, it } from "vitest";
import { forgetTab, tabGuideStore } from "./guideStore";

/** chrome.storage.session, in memory (as the real one is). */
function fakeSession() {
  const data = new Map<string, unknown>();
  return {
    data,
    area: {
      async get(keys?: string | string[] | null) {
        if (keys === null || keys === undefined) return Object.fromEntries(data);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]));
      },
      async set(items: Record<string, unknown>) { for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v)); },
      async remove(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k); },
    } as unknown as chrome.storage.StorageArea,
  };
}

let s: ReturnType<typeof fakeSession>;
beforeEach(() => { s = fakeSession(); });

describe("tabGuideStore (the extension)", () => {
  it("round-trips a guide under guide:<tabId>:<fingerprint> in chrome.storage.session", async () => {
    const store = tabGuideStore(7, () => s.area);
    expect(await store.load("fp")).toBeNull();
    await store.save("fp", { stepIndex: 2, answers: { jmeno: "Jana" } });
    expect([...s.data.keys()]).toEqual(["guide:7:fp"]);
    expect(await store.load("fp")).toEqual({ stepIndex: 2, answers: { jmeno: "Jana" } });
    expect(await tabGuideStore(8, () => s.area).load("fp")).toBeNull(); // another tab keeps its own
    await store.clear("fp");
    expect(await store.load("fp")).toBeNull();
  });

  it("keeps nothing and never throws when storage is unavailable", async () => {
    const broken = () => { throw new Error("no storage"); };
    const store = tabGuideStore(7, broken as never);
    await expect(store.save("fp", { stepIndex: 1, answers: {} })).resolves.toBeUndefined();
    await expect(store.load("fp")).resolves.toBeNull();
  });
});

describe("forgetTab (chrome.tabs.onRemoved)", () => {
  it("removes every guide and every answer by label of the closed tab, and only of that tab", async () => {
    const a = tabGuideStore(7, () => s.area);
    const b = tabGuideStore(70, () => s.area);
    await a.save("fp", { stepIndex: 1, answers: { jmeno: "Jana" } });
    await a.save("labels:https://office.example", { stepIndex: 0, answers: { "jméno": "Jana" } });
    await b.save("fp", { stepIndex: 3, answers: {} });
    await s.area.set({ look: "page" });
    await forgetTab(7, () => s.area);
    expect([...s.data.keys()].sort()).toEqual(["guide:70:fp", "look"]);
  });
});
