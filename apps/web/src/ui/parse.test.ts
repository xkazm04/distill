import { describe, expect, it } from "vitest";
import { parseSimplified } from "./FocusView";
import { parseHash } from "../App";
import { looksLikeUrl, textToHtml } from "./dom";

const blocks = [{ id: "b0", kind: "paragraph" as const, text: "a" }, { id: "b1", kind: "paragraph" as const, text: "b" }];

describe("parseSimplified", () => {
  it("reads an id-keyed object and ignores unknown ids", () => {
    expect(parseSimplified({ b0: "x", zzz: "y" }, blocks)).toEqual({ b0: "x" });
  });
  it("reads a list of {id,text}", () => {
    expect(parseSimplified([{ id: "b1", text: "z" }], blocks)).toEqual({ b1: "z" });
  });
});

describe("routes and paste", () => {
  it("parses hash routes", () => {
    expect(parseHash("#/demo/form/wayfill")).toEqual({ kind: "demo", id: "form", tab: "wayfill" });
    expect(parseHash("")).toEqual({ kind: "home" });
    expect(parseHash("#/pdf/wayfill")).toEqual({ kind: "pdf", tab: "wayfill" });
  });
  it("detects urls and escapes pasted text", () => {
    expect(looksLikeUrl("https://example.com/a")).toBe(true);
    expect(textToHtml("<b>hi</b>")).toContain("&lt;b&gt;");
  });
});
