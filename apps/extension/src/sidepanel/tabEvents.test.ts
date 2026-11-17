import { describe, expect, it } from "vitest";
import { pinnedTabId, shouldReread, tabUpdatedListener } from "./tabEvents";

describe("shouldReread (chrome.tabs.onUpdated)", () => {
  it("ignores a load that finishes in another tab", () => {
    expect(shouldReread(8, { status: "complete" }, 7)).toBe(false);
  });

  it("re-reads once when the panel's own tab finishes loading", () => {
    const events = [{ status: "loading" }, {}, { status: "complete" }];
    expect(events.filter((info) => shouldReread(7, info, 7))).toHaveLength(1);
  });

  it("takes any finished load while no tab is shown yet", () => {
    expect(shouldReread(8, { status: "complete" }, null)).toBe(true);
    expect(shouldReread(8, { status: "complete" }, undefined)).toBe(true);
  });
});

describe("tabUpdatedListener", () => {
  it("does not re-read for another tab's load, and follows the tab the panel shows now", () => {
    let shown: number | null = 7;
    let rereads = 0;
    const listener = tabUpdatedListener(() => shown, () => { rereads++; });
    listener(8, { status: "complete" }); // a background tab finished loading
    listener(7, { status: "loading" });
    expect(rereads).toBe(0);
    listener(7, { status: "complete" });
    expect(rereads).toBe(1);
    shown = 8; // the person switched tabs
    listener(7, { status: "complete" });
    listener(8, { status: "complete" });
    expect(rereads).toBe(2);
  });
});

describe("pinnedTabId (sidepanel.html?tabId=<n>)", () => {
  it("pins the panel to a tab id, and ignores anything else", () => {
    expect(pinnedTabId("?tabId=42")).toBe(42);
    expect(pinnedTabId("")).toBeUndefined();
    expect(pinnedTabId("?tabId=abc")).toBeUndefined();
    expect(pinnedTabId("?tabId=-1")).toBeUndefined();
  });
});
