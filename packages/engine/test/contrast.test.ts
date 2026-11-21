import { describe, expect, it } from "vitest";
import { composite, contrastRatio, cssColor, parseColor, readableOn, type Rgba } from "../src/index.js";

const rgb = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a });
const hueOf = (c: Rgba) => {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return null;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

describe("parseColor", () => {
  it("reads what getComputedStyle gives, in every syntax a browser uses", () => {
    expect(parseColor("rgb(28, 30, 31)")).toEqual(rgb(28, 30, 31));
    expect(parseColor("rgba(0, 0, 0, 0)")).toEqual(rgb(0, 0, 0, 0));
    expect(parseColor("rgb(10 20 30 / 50%)")).toEqual(rgb(10, 20, 30, 0.5));
    expect(parseColor("color(srgb 1 0.5 0 / 0.25)")).toEqual(rgb(255, 127.5, 0, 0.25));
    expect(parseColor("#fff")).toEqual(rgb(255, 255, 255));
    expect(parseColor("#00000080")?.a).toBeCloseTo(0.5, 2);
    expect(parseColor("transparent")?.a).toBe(0);
  });

  it("gives up on what it cannot read, so the caller leaves that colour alone", () => {
    for (const s of ["oklch(0.7 0.1 200)", "lab(50 20 30)", "currentcolor", "", "rgb(a, b, c)", "#12"]) expect(parseColor(s)).toBeNull();
  });
});

describe("contrast", () => {
  it("is WCAG 2's ratio: black on white is 21, grey #767676 on white just passes AA", () => {
    expect(contrastRatio(rgb(0, 0, 0), rgb(255, 255, 255))).toBeCloseTo(21, 5);
    expect(contrastRatio(rgb(118, 118, 118), rgb(255, 255, 255))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(rgb(119, 119, 119), rgb(255, 255, 255))).toBeLessThan(4.5);
  });

  it("paints translucent text over its background first", () => {
    expect(composite(rgb(0, 0, 0, 0.5), rgb(255, 255, 255))).toEqual(rgb(127.5, 127.5, 127.5));
    expect(contrastRatio(rgb(0, 0, 0, 0.5), rgb(255, 255, 255))).toBeCloseTo(contrastRatio(rgb(127.5, 127.5, 127.5), rgb(255, 255, 255)), 5);
  });
});

describe("readableOn", () => {
  it("leaves text that already reads alone", () => {
    expect(readableOn(rgb(28, 30, 31), rgb(255, 255, 255))).toBeNull();
    expect(readableOn(rgb(240, 240, 240), rgb(20, 20, 20))).toBeNull();
  });

  it("darkens light grey on white only as far as AA needs", () => {
    const out = readableOn(rgb(170, 170, 170), rgb(255, 255, 255));
    expect(out).not.toBeNull();
    const ratio = contrastRatio(out as Rgba, rgb(255, 255, 255));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.8); // no darker than it must be
  });

  it("keeps the hue: a pale blue link stays blue, only darker", () => {
    const pale = rgb(120, 160, 230);
    const out = readableOn(pale, rgb(255, 255, 255)) as Rgba;
    expect(contrastRatio(out, rgb(255, 255, 255))).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs((hueOf(out) ?? 0) - (hueOf(pale) ?? 0))).toBeLessThan(3);
    expect(out.b).toBeGreaterThan(out.r);
  });

  it("lightens on a dark page", () => {
    const out = readableOn(rgb(90, 90, 110), rgb(30, 30, 30)) as Rgba;
    expect(contrastRatio(out, rgb(30, 30, 30))).toBeGreaterThanOrEqual(4.5);
    expect(out.r).toBeGreaterThan(90);
  });

  it("uses large text's lower bar when asked, and falls back to black or white when no shade of the hue passes", () => {
    expect(readableOn(rgb(150, 150, 150), rgb(255, 255, 255), 3)).not.toBeNull();
    expect(readableOn(rgb(140, 140, 140), rgb(255, 255, 255), 3)).toBeNull();
    // Mid grey background: 6:1 is out of reach even for black (5.3:1), so black is the best there is.
    expect(readableOn(rgb(100, 100, 100), rgb(128, 128, 128), 6)).toEqual(rgb(0, 0, 0));
  });

  it("writes CSS", () => {
    expect(cssColor(rgb(1.4, 2.6, 3))).toBe("rgb(1 3 3)");
    expect(cssColor(rgb(0, 0, 0, 0.5))).toBe("rgb(0 0 0 / 0.5)");
  });
});
