import { describe, expect, it } from "vitest";
import { BRAND_LIGHT } from "./theme/brand";
import { applyBinding } from "./theme/apply";
import { HIGHLIGHT_FALLBACK, accentColor, applyHighlight } from "./dom";

const page = () => new DOMParser().parseFromString('<form><input id="a" style="outline: 1px dotted red"><input name="b"></form>', "text/html");

describe("filled-field highlight", () => {
  it("outlines in the colour it is given, 3px with a 2px offset, and restores the original on clear", () => {
    const doc = page();
    applyHighlight(doc, ["a", "b"], "#371C46");
    const a = doc.getElementById("a") as HTMLElement;
    const b = doc.getElementsByName("b")[0] as HTMLElement;
    for (const el of [a, b]) {
      expect(el.style.outline.toLowerCase().split(" ").sort()).toEqual(expect.arrayContaining(["3px", "solid"]));
      expect(el.style.outline.toLowerCase()).toMatch(/#371c46|rgb\(55, 28, 70\)/);
      expect(el.style.outlineOffset).toBe("2px");
    }
    applyHighlight(doc, []);
    expect(a.style.outline).toContain("dotted");
    expect(b.style.outline).toBe("");
  });

  it("falls back only when the colour is missing or unreadable, and never passes other CSS through", () => {
    for (const bad of [undefined, "", "not-a-colour", "red; background: url(x)", "rgba(0, 0, 0, 0.2)"]) {
      const doc = page();
      applyHighlight(doc, ["a"], bad);
      const out = (doc.getElementById("a") as HTMLElement).style.outline.toLowerCase();
      expect(out).toContain(HIGHLIGHT_FALLBACK);
      expect(out).not.toContain("url");
    }
  });

  it("reads the active theme's --accent at call time", () => {
    document.documentElement.removeAttribute("style");
    expect(accentColor()).toBe(HIGHLIGHT_FALLBACK);
    applyBinding(document.documentElement, BRAND_LIGHT);
    expect(accentColor().toLowerCase()).toBe(BRAND_LIGHT["--accent"].toLowerCase());
    document.documentElement.style.setProperty("--accent", "#ff62ad");
    expect(accentColor()).toBe("#ff62ad");
    document.documentElement.removeAttribute("style");
  });
});
