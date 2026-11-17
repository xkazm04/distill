import { describe, expect, it } from "vitest";
import { BRAND_DARK, BRAND_LIGHT } from "./brand";
import {
  contrast, contrastOf, deriveTheme, floorFailures, fontFamilies, parseColor, pickFallback, readableColor, THEME_ALGORITHM,
} from "./derive";
import { COLOR_ROLES, ROLES, type PageThemeSeed, type ThemeBinding } from "./roles";

// Deterministic PRNG (mulberry32), so a failing seed can be replayed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hueOf = (css: string) => {
  const c = parseColor(css)!;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return NaN;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

function expectSound(b: ThemeBinding) {
  for (const role of ROLES) expect(typeof b[role] === "string" && b[role].length > 0, `${role} bound`).toBe(true);
  for (const role of COLOR_ROLES) expect(b[role], role).toMatch(/^#[0-9a-f]{6}$/);
  expect(floorFailures(b)).toEqual([]);
  const px = parseFloat(b["--radius"]);
  expect(b["--radius"]).toMatch(/^\d+(\.5)?px$/);
  expect(px).toBeGreaterThanOrEqual(0);
  expect(px).toBeLessThanOrEqual(16);
  for (const f of ["--font-body", "--font-display"] as const) expect(b[f]).not.toMatch(/[;{}()<>\\]/);
}

describe("parseColor", () => {
  it.each([
    ["#fff", [255, 255, 255, 1]],
    ["#0b4fd6", [11, 79, 214, 1]],
    ["#00000080", [0, 0, 0, 128 / 255]],
    ["rgb(10, 20, 30)", [10, 20, 30, 1]],
    ["rgba(10, 20, 30, 0.5)", [10, 20, 30, 0.5]],
    ["rgb(10 20 30 / 50%)", [10, 20, 30, 0.5]],
    ["rgb(100%, 0%, 0%)", [255, 0, 0, 1]],
    ["hsl(0, 100%, 50%)", [255, 0, 0, 1]],
    ["hsla(240, 100%, 50%, 0.25)", [0, 0, 255, 0.25]],
    ["hsl(120deg 100% 25%)", [0, 127.5, 0, 1]],
    ["Navy", [0, 0, 128, 1]],
    ["transparent", [0, 0, 0, 0]],
    ["color(srgb 1 0 0)", [255, 0, 0, 1]],
  ])("%s", (input, [r, g, b, a]) => {
    const c = parseColor(input)!;
    expect(c.r).toBeCloseTo(r!, 0);
    expect(c.g).toBeCloseTo(g!, 0);
    expect(c.b).toBeCloseTo(b!, 0);
    expect(c.a).toBeCloseTo(a!, 3);
  });

  it("reads oklch close to its sRGB value", () => {
    const c = parseColor("oklch(0.628 0.2577 29.23)")!; // CSS red
    expect(c.r).toBeGreaterThan(250);
    expect(c.g).toBeLessThan(6);
  });

  it.each(["", "url(x.png)", "linear-gradient(red, blue)", "rgb(a, b, c)", "#ggg", "chartreuse-ish", "var(--x)"])(
    "rejects %j", (s) => expect(parseColor(s)).toBeNull(),
  );

  it("treats alpha below 0.9 as unreadable", () => {
    expect(readableColor("rgba(0, 0, 0, 0.5)")).toBeNull();
    expect(readableColor("rgba(0, 0, 0, 0.95)")).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrast({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5);
    expect(contrastOf("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrastOf("#ffffff", "#ffffff")).toBe(1);
  });
});

describe("pickFallback", () => {
  it("chooses by the page background, then its scheme, then its text", () => {
    expect(pickFallback({ bg: "rgb(255, 255, 255)" }, "L", "D")).toBe("L");
    expect(pickFallback({ bg: "rgb(13, 17, 23)", scheme: "light" }, "L", "D")).toBe("D");
    expect(pickFallback({ scheme: "dark" }, "L", "D")).toBe("D");
    expect(pickFallback({ fg: "#eeeeee" }, "L", "D")).toBe("D");
    expect(pickFallback({}, "L", "D")).toBe("L");
  });
});

describe("deriveTheme", () => {
  it("keeps a readable page's own colours and lists nothing as adjusted", () => {
    const seed: PageThemeSeed = { bg: "rgb(255, 255, 255)", fg: "rgb(34, 34, 34)", link: "rgb(0, 102, 204)", scheme: "light" };
    const t = deriveTheme(seed, BRAND_LIGHT);
    expect(t.algorithm).toBe(THEME_ALGORITHM);
    expect(t.seed).toEqual(seed);
    expect(t.binding["--bg"]).toBe("#ffffff");
    expect(t.binding["--fg"]).toBe("#222222");
    expect(t.binding["--accent"]).toBe("#0066cc");
    expect(t.adjusted).toEqual([]);
    expectSound(t.binding);
  });

  it("moves an unreadable page colour along lightness, keeps its hue, and says so", () => {
    const t = deriveTheme({ bg: "#ffffff", fg: "#333333", link: "#ffd700" }, BRAND_LIGHT); // gold link on white
    expect(t.adjusted).toEqual(["--accent"]);
    expect(contrastOf(t.binding["--accent"], "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(Math.abs(hueOf(t.binding["--accent"]) - hueOf("#ffd700"))).toBeLessThan(12);
  });

  it("repairs white text on a white page", () => {
    const t = deriveTheme({ bg: "#ffffff", fg: "#ffffff", link: "#ffffff" }, BRAND_LIGHT);
    expect(t.adjusted).toEqual(expect.arrayContaining(["--fg", "--accent"]));
    expectSound(t.binding);
  });

  it("keeps each chip on its brand hue (device, cloud and agent stay distinguishable) on any background", () => {
    // The chips' hues come from the fallback brand binding, whatever the brand chooses; derivation may only move
    // lightness. Circular hue distance, so pink (~330) and red (~0) compare correctly.
    const dist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const bg of ["#ffffff", "#0d1117", "#6b8e23", "#7b2d8b", "#808080"]) {
      const fb = pickFallback({ bg }, BRAND_LIGHT, BRAND_DARK);
      const b = deriveTheme({ bg }, fb).binding;
      for (const role of ["--chip-device", "--chip-cloud", "--chip-agent"] as const) {
        expect(dist(hueOf(b[role]), hueOf(fb[role])), `${role} on ${bg}`).toBeLessThan(25);
        expect(contrastOf(b[role], b["--bg"]), `${role} contrast on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(dist(hueOf(b["--chip-device"]), hueOf(b["--chip-cloud"])), `chips apart on ${bg}`).toBeGreaterThan(60);
      expect(dist(hueOf(b["--chip-agent"]), hueOf(b["--chip-device"])), `agent apart from device on ${bg}`).toBeGreaterThan(60);
      expect(dist(hueOf(b["--chip-agent"]), hueOf(b["--chip-cloud"])), `agent apart from cloud on ${bg}`).toBeGreaterThan(60);
    }
  });

  it("puts the page's fonts first and the fallback stack after, without repeats", () => {
    const b = deriveTheme({ fontBody: '"Source Serif 4", Georgia, serif', fontDisplay: "Inter, system-ui, sans-serif" }, BRAND_LIGHT).binding;
    expect(b["--font-body"].startsWith('"Source Serif 4", Georgia, serif, ')).toBe(true);
    expect(b["--font-display"].startsWith("Inter, system-ui, sans-serif")).toBe(true);
    expect(b["--font-display"].match(/system-ui/g)).toHaveLength(1);
  });

  it("drops anything in a font list that is not a family name", () => {
    expect(fontFamilies('Arial; } body { color: red, url(x), "Ok Font", sans-serif')).toEqual(['"Ok Font"', "sans-serif"]);
    expect(deriveTheme({ fontBody: "x;}{" }, BRAND_LIGHT).binding["--font-body"]).toBe(BRAND_LIGHT["--font-body"]);
  });

  it("clamps the radius to 0-16px", () => {
    expect(deriveTheme({ radiusPx: 40 }, BRAND_LIGHT).binding["--radius"]).toBe("16px");
    expect(deriveTheme({ radiusPx: -3 }, BRAND_LIGHT).binding["--radius"]).toBe("0px");
    expect(deriveTheme({ radiusPx: 4.3 }, BRAND_LIGHT).binding["--radius"]).toBe("4.5px");
    expect(deriveTheme({ radiusPx: Number.NaN }, BRAND_LIGHT).binding["--radius"]).toBe(BRAND_LIGHT["--radius"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Property test: random pages, including hostile ones, always give a sound, deterministic theme.
// ---------------------------------------------------------------------------------------------------------------

const EDGE_SEEDS: PageThemeSeed[] = [
  {},
  { bg: "#ffffff", fg: "#ffffff", link: "#ffffff" },                    // white on white
  { bg: "#000000", fg: "#000000", link: "#000000" },                    // black on black
  { bg: "#00ff00", fg: "#ff00ff", link: "#ffff00" },                    // neon on neon
  { bg: "#39ff14", fg: "#ff073a", link: "#0ff0fc" },
  { bg: "#ff00ff", fg: "#00ffff", link: "#ff0000", scheme: "dark" },
  { bg: "#777777", fg: "#888888", link: "#7a7a7a" },                    // mid grey, the hardest background
  { bg: "rgb(118, 118, 118)", fg: "rgb(118, 118, 118)" },
  { bg: "rgba(255, 255, 255, 0.5)", fg: "rgba(0, 0, 0, 0.3)", link: "hsla(200, 80%, 40%, 0.2)" }, // translucent
  { bg: "transparent", fg: "transparent", link: "transparent" },
  { bg: "url(hero.jpg)", fg: "linear-gradient(red, blue)", link: "var(--brand)" },
  { fg: "#f0f0f0", scheme: "dark" },
  { bg: "#0d1117", link: "#0d1117" },
  { radiusPx: 1e9, fontBody: "", fontDisplay: "   " },
];

const HEX = "0123456789abcdef";
const NAMES = ["red", "lime", "yellow", "white", "black", "navy", "fuchsia", "aqua", "orange", "gray", "transparent", "notacolour"];

function randomColor(r: () => number): string | undefined {
  const byte = () => Math.floor(r() * 256);
  const a = () => (r() < 0.25 ? r().toFixed(2) : r() < 0.5 ? (0.9 + r() * 0.1).toFixed(2) : "1");
  switch (Math.floor(r() * 9)) {
    case 0: return undefined;
    case 1: return `#${Array.from({ length: 6 }, () => HEX[Math.floor(r() * 16)]).join("")}`;
    case 2: return `#${Array.from({ length: 3 }, () => HEX[Math.floor(r() * 16)]).join("")}`;
    case 3: return `rgb(${byte()}, ${byte()}, ${byte()})`;
    case 4: return `rgba(${byte()}, ${byte()}, ${byte()}, ${a()})`;
    case 5: return `hsl(${Math.floor(r() * 360)}, ${Math.floor(r() * 101)}%, ${Math.floor(r() * 101)}%)`;
    case 6: return `hsla(${Math.floor(r() * 360)}, 100%, ${Math.floor(r() * 101)}%, ${a()})`;
    case 7: return NAMES[Math.floor(r() * NAMES.length)];
    // neon: one saturated channel pattern, the classic garish page
    default: return `rgb(${r() < 0.5 ? 255 : 0}, ${r() < 0.5 ? 255 : 0}, ${r() < 0.5 ? 255 : Math.floor(r() * 80)})`;
  }
}

const FONTS = [undefined, "Georgia, serif", '"Helvetica Neue", Arial, sans-serif', "Inter, system-ui, sans-serif",
  "x; } body { color: red", "monospace", '"Noto Sans JP", sans-serif', ""];

function randomSeed(r: () => number): PageThemeSeed {
  const s: PageThemeSeed = {};
  const bg = randomColor(r), fg = randomColor(r), link = randomColor(r);
  if (bg !== undefined) s.bg = bg;
  if (fg !== undefined) s.fg = fg;
  if (link !== undefined) s.link = link;
  const fb = FONTS[Math.floor(r() * FONTS.length)], fd = FONTS[Math.floor(r() * FONTS.length)];
  if (fb !== undefined) s.fontBody = fb;
  if (fd !== undefined) s.fontDisplay = fd;
  if (r() < 0.7) s.radiusPx = r() < 0.1 ? Number.NaN : Math.round((r() * 80 - 20) * 10) / 10;
  if (r() < 0.5) s.scheme = r() < 0.5 ? "light" : "dark";
  return s;
}

describe("deriveTheme property: every role bound, every floor met, deterministic", () => {
  const r = rng(20261117);
  const seeds = [...EDGE_SEEDS, ...Array.from({ length: 600 }, () => randomSeed(r))];

  it(`holds for ${seeds.length} seeds against both fallbacks`, () => {
    expect(seeds.length).toBeGreaterThanOrEqual(500);
    for (const seed of seeds) {
      for (const fallback of [BRAND_LIGHT, BRAND_DARK, pickFallback(seed, BRAND_LIGHT, BRAND_DARK)]) {
        const t = deriveTheme(seed, fallback);
        try {
          expectSound(t.binding);
        } catch (e) {
          throw new Error(`seed ${JSON.stringify(seed)}: ${(e as Error).message}`);
        }
        expect(t.algorithm).toBe(1);
        expect(t.seed).toBe(seed);
        for (const role of t.adjusted) expect(ROLES).toContain(role);
        expect(deriveTheme(seed, fallback)).toEqual(t);
      }
    }
  });
});
