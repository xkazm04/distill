import { describe, expect, it } from "vitest";
import { applyBinding } from "./apply";
import { BRAND_DARK, BRAND_LIGHT } from "./brand";
import { COLOR_ROLES, CONTRAST_FLOORS, ROLES, type ThemeBinding } from "./roles";

/** WCAG 2.x relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const STATES: [string, ThemeBinding][] = [["BRAND_LIGHT", BRAND_LIGHT], ["BRAND_DARK", BRAND_DARK]];

describe("contrast()", () => {
  it("matches the WCAG reference points", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe.each(STATES)("%s", (_name, binding) => {
  it("binds every role in ROLES, and nothing else", () => {
    for (const role of ROLES) expect(binding[role], role).toBeTruthy();
    expect(Object.keys(binding).sort()).toEqual([...ROLES].sort());
  });

  it("binds every colour role to an opaque #rrggbb colour", () => {
    for (const role of COLOR_ROLES) expect(binding[role], role).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(CONTRAST_FLOORS.map((f) => [`${f.fg} on ${f.bg} >= ${f.min}`, f] as const))("%s", (_l, f) => {
    const c = contrast(binding[f.fg], binding[f.bg]);
    expect(c, `${f.fg} ${binding[f.fg]} on ${f.bg} ${binding[f.bg]} is ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(f.min);
  });

  it("names the self-hosted fonts first and keeps a system fallback", () => {
    expect(binding["--font-body"]).toMatch(/^"Atkinson Hyperlegible Next Variable"/);
    expect(binding["--font-display"]).toMatch(/^"Fredoka Variable"/);
    for (const f of [binding["--font-body"], binding["--font-display"]]) expect(f).toMatch(/sans-serif$/);
  });
});

describe("applyBinding", () => {
  it("sets every role as a custom property on the element", () => {
    const el = document.createElement("div");
    applyBinding(el, BRAND_DARK);
    for (const role of ROLES) expect(el.style.getPropertyValue(role).trim()).toBe(BRAND_DARK[role]);
    applyBinding(el, BRAND_LIGHT);
    expect(el.style.getPropertyValue("--bg").trim()).toBe(BRAND_LIGHT["--bg"]);
  });
});
