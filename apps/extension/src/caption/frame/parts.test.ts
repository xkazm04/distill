// r5-02 More in parts: which part opens, the tab keys, the per-site choice as stored. r5-08: where a let-go sheet settles.
import { describe, expect, it } from "vitest";
import { defaultPart, nextTab, parseChoices, pickPart, PARTS, type Part } from "./parts";
import { snap } from "./More";

describe("defaultPart", () => {
  const none = { claims: 0, article: false, actions: 0, formOrLetter: false };
  it("opens on Check when claims were found on an article", () => {
    expect(defaultPart({ ...none, article: true, claims: 6 })).toBe("check");
  });
  it("opens on Do on a form or a letter with things to do", () => {
    expect(defaultPart({ ...none, formOrLetter: true, actions: 4 })).toBe("do");
    expect(defaultPart({ ...none, formOrLetter: true, actions: 0 })).toBe("page");
  });
  it("opens on This page otherwise, also when a non-article has claims or a product page has things to do", () => {
    expect(defaultPart(none)).toBe("page");
    expect(defaultPart({ ...none, claims: 3 })).toBe("page");
    expect(defaultPart({ ...none, actions: 2 })).toBe("page");
  });
});

describe("pickPart", () => {
  const all: Part[] = [...PARTS];
  it("takes the person's last choice on this site when that part has something", () => {
    expect(pickPart(all, "check", "settings")).toBe("settings");
  });
  it("falls back to the default when the remembered part is empty here", () => {
    expect(pickPart(["page", "settings", "removed"], "page", "check")).toBe("page");
  });
  it("falls back to the first part with something when the default is empty", () => {
    expect(pickPart(["settings", "removed"], "page", null)).toBe("settings");
    expect(pickPart([], "page", null)).toBe("removed");
  });
});

describe("nextTab", () => {
  const filled: Part[] = ["page", "check", "settings", "removed"];
  it("moves with the arrows and wraps", () => {
    expect(nextTab(filled, "page", "ArrowRight")).toBe("check");
    expect(nextTab(filled, "removed", "ArrowRight")).toBe("page");
    expect(nextTab(filled, "page", "ArrowLeft")).toBe("removed");
  });
  it("goes to the ends with Home and End, skipping parts with nothing in them", () => {
    expect(nextTab(filled, "check", "Home")).toBe("page");
    expect(nextTab(filled, "check", "End")).toBe("removed");
  });
  it("ignores other keys", () => {
    expect(nextTab(filled, "check", "a")).toBeNull();
    expect(nextTab(filled, "check", "Enter")).toBeNull();
  });
});

describe("parseChoices", () => {
  it("keeps well-formed origins and known parts only", () => {
    expect(parseChoices({ "https://www.aktualne.cz": "check", "http://x.test": "do", "https://a.test/path": "page", "file://": "page", "https://b.test": "nope" }))
      .toEqual({ "https://www.aktualne.cz": "check", "http://x.test": "do" });
    expect(parseChoices(null)).toEqual({});
    expect(parseChoices("check")).toEqual({});
  });
});

describe("snap", () => {
  it("settles a let-go sheet at full, half or closed", () => {
    expect(snap(0.9)).toBe("full");
    expect(snap(0.72)).toBe("full");
    expect(snap(0.5)).toBe("half");
    expect(snap(0.3)).toBe("half");
    expect(snap(0.2)).toBe("closed");
  });
});
