// r5-03 the first line: the sentence, the chips (each opening its part of More), and what fits in the room.
import { describe, expect, it } from "vitest";
import type { ClutterItem } from "@distill/engine";
import type { CleanReport } from "../../messages";
import { chips, fit, sentence, type LineInput } from "./lineParts";

const item = (id: string, kind: ClutterItem["kind"] = "ad"): ClutterItem => ({ id, kind, label: `${kind} ${id}` } as ClutterItem);
const report = (over: Partial<CleanReport> = {}): CleanReport => ({
  items: [item("1"), item("2"), item("3")], restored: [], lang: "en", kind: "article", unlockedScroll: false, langFrom: "page",
  widened: 0, comfort: 0, calm: { media: 0, motion: 0 }, unstuck: 0, tables: 0, ...over,
});
const input = (over: Partial<LineInput> = {}): LineInput => ({
  report: report(), translate: { phase: "idle", showingSource: false }, plain: { phase: "idle" }, claims: 0, actions: 0, byline: null,
  reader: "en", now: new Date("2026-11-23T12:00:00Z"), ...over,
});

describe("sentence", () => {
  it("says the page was cleaned, and in which language it now reads", () => {
    expect(sentence(input())).toEqual({ long: "Page cleaned", short: "Cleaned" });
    expect(sentence(input({ report: report({ lang: "cs" }), translate: { phase: "done", from: "cs", to: "en", showingSource: false } })))
      .toEqual({ long: "Cleaned · in English", short: "In English" });
    expect(sentence(input({ report: report({ lang: "cs" }) })).long).toBe("Cleaned · page in Czech");
  });
  it("puts plain words first, then a translation in progress or failed", () => {
    expect(sentence(input({ plain: { phase: "on" } })).long).toBe("Showing plain words");
    expect(sentence(input({ report: report({ lang: "cs" }), translate: { phase: "translating", from: "cs", showingSource: false } })).long).toBe("Translating from Czech...");
    expect(sentence(input({ report: report({ lang: "cs" }), translate: { phase: "failed", from: "cs", showingSource: false } })).short).toBe("Not translated");
  });
  it("says when the cookie banner was all there was", () => {
    expect(sentence(input({ report: report({ items: [item("c", "cookie")], consent: "rejected" }) })).long).toBe("Cookies rejected · nothing else to remove");
    expect(sentence(input({ report: report({ items: [] }) })).long).toBe("Nothing to remove");
  });
  it("says it is still cleaning, or what went wrong", () => {
    expect(sentence(input({ report: null })).long).toBe("Cleaning the page...");
    expect(sentence(input({ report: null, problem: "The page did not answer." })).long).toBe("The page did not answer.");
  });
});

describe("chips", () => {
  it("gives each other fact a chip with its number and the part it opens", () => {
    const c = chips(input({
      report: report({ restored: ["1"], consent: "rejected", calm: { media: 3, motion: 0 } }), claims: 6, actions: 4,
      byline: { from: "data", published: "2023-01-10", updated: "2026-11-20" } as LineInput["byline"],
    }));
    expect(c.map((x) => [x.text, x.part])).toEqual([
      ["2 removed", "removed"], ["6 claims", "check"], ["4 to do", "do"], ["published 3 years ago", "page"],
      ["cookies rejected", "settings"], ["paused 3 videos", "settings"],
    ]);
    expect(c[0]?.title).toContain("1 shown again");
  });
  it("shows no date chip when the page was not updated well after it was published", () => {
    expect(chips(input({ byline: { from: "data", published: "2026-11-01", updated: "2026-11-03" } as LineInput["byline"] })).map((x) => x.id)).toEqual(["removed"]);
  });
  it("does not repeat the cookie banner when the sentence already says it", () => {
    expect(chips(input({ report: report({ items: [item("c", "cookie")], consent: "rejected" }) }))).toEqual([]);
  });
  it("has no chips while cleaning or after a problem", () => {
    expect(chips(input({ report: null }))).toEqual([]);
  });
});

describe("fit", () => {
  const w = { long: 120, short: 60, chips: [80, 70, 90], plus: 30, gap: 6 };
  it("keeps the long sentence and every chip when they fit", () => {
    expect(fit(500, w)).toEqual({ short: false, shown: 3 });
  });
  it("on a phone, shortens the sentence first, then folds chips from the end into a +n chip, never cutting one", () => {
    expect(fit(320, w, true)).toEqual({ short: true, shown: 3 });
    // short 60, two chips 86 + 76, the +1 chip 36: 258 px
    expect(fit(260, w, true)).toEqual({ short: true, shown: 2 });
    expect(fit(250, w, true)).toEqual({ short: true, shown: 1 });
    expect(fit(100, w, true)).toEqual({ short: true, shown: 0 });
  });
  it("on a wide strip, folds the last chips first and keeps the long sentence while one chip fits beside it", () => {
    // long 120, two chips 86 + 76, the +1 chip 36: 318 px
    expect(fit(320, w)).toEqual({ short: false, shown: 2 });
    expect(fit(250, w)).toEqual({ short: false, shown: 1 });
    // not even one chip beside the long sentence: the short one, with what fits
    expect(fit(240, w)).toEqual({ short: true, shown: 1 });
  });
});
