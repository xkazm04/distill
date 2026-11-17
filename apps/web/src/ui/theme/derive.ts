// Derive a complete role binding from what the extension read off the host page, so the side panel feels native to
// the site (its colours, fonts and corner radius) while every contrast floor in roles.ts still holds.
// Pure: no DOM access, so it runs in the side panel, in the content script and in tests.
//
// Colour work: CSS colours are parsed to sRGB; contrast is WCAG 2 relative luminance; a colour that misses a floor is
// moved along OKLCH lightness only (hue kept, chroma reduced just enough to stay in sRGB). Every output colour is a
// rounded `#rrggbb`, and every floor is checked on the rounded value, so what is checked is what is applied.
import { COLOR_ROLES, CONTRAST_FLOORS, ROLES, type ColorRole, type DerivedTheme, type PageThemeSeed, type Role, type ThemeBinding } from "./roles";

export const THEME_ALGORITHM = 1 as const;

/** Colours with alpha below this are unreadable: what shows through them is unknown. */
export const MIN_ALPHA = 0.9;
/** A small margin above each floor, so another WCAG implementation (0.03928 vs 0.04045) agrees with ours. */
const EPS = 0.01;
const MAX_RADIUS_PX = 16;
const MAX_PAGE_FAMILIES = 6;

export interface Rgb { r: number; g: number; b: number }
export interface Rgba extends Rgb { a: number }

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000", purple: "#800080", fuchsia: "#ff00ff",
  magenta: "#ff00ff", lime: "#00ff00", olive: "#808000", navy: "#000080", teal: "#008080", aqua: "#00ffff",
  cyan: "#00ffff", orange: "#ffa500", rebeccapurple: "#663399",
};

// ---------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A CSS number, a percentage of `pctOf`, or `none` (= 0). NaN when it is neither. */
function num(s: string | undefined, pctOf: number): number {
  if (s === undefined) return NaN;
  if (s === "none") return 0;
  if (s.endsWith("%")) return (parseFloat(s) / 100) * pctOf;
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s) ? parseFloat(s) : NaN;
}

function hue(s: string | undefined): number {
  if (s === undefined) return NaN;
  if (s === "none") return 0;
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/.exec(s);
  if (!m) return NaN;
  const v = parseFloat(m[1] as string);
  const unit = m[2] ?? "deg";
  const deg = unit === "turn" ? v * 360 : unit === "rad" ? (v * 180) / Math.PI : unit === "grad" ? v * 0.9 : v;
  return ((deg % 360) + 360) % 360;
}

function alpha(s: string | undefined): number {
  if (s === undefined) return 1;
  return clamp(num(s, 1), 0, 1);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
}

/** Parse a CSS colour: hex, rgb()/rgba(), hsl()/hsla(), oklch(), color(srgb ...), basic names, transparent. */
export function parseColor(input: string | undefined): Rgba | null {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s || s.length > 120) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const named = NAMED[s];
  if (named) s = named;

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1] as string;
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }

  const fn = /^(rgba?|hsla?|oklch|color)\(\s*([^()]*)\)$/.exec(s);
  if (!fn) return null;
  const name = fn[1] as string;
  const [main, slashAlpha] = (fn[2] as string).split("/").map((p) => p.trim());
  const parts = (main ?? "").split(/[\s,]+/).filter(Boolean);
  const a = alpha(slashAlpha ?? (name === "color" ? undefined : parts[3]));
  if (Number.isNaN(a)) return null;

  let rgb: Rgb;
  if (name === "rgb" || name === "rgba") {
    const [r, g, b] = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)];
    rgb = { r, g, b };
  } else if (name === "hsl" || name === "hsla") {
    const h = hue(parts[0]);
    const sat = num(parts[1]?.endsWith("%") ? parts[1] : `${parts[1]}%`, 1);
    const lig = num(parts[2]?.endsWith("%") ? parts[2] : `${parts[2]}%`, 1);
    if ([h, sat, lig].some(Number.isNaN)) return null;
    rgb = hslToRgb(h, clamp(sat, 0, 1), clamp(lig, 0, 1));
  } else if (name === "oklch") {
    const L = num(parts[0], 1);
    const C = num(parts[1], 0.4);
    const H = hue(parts[2]);
    if ([L, C, H].some(Number.isNaN)) return null;
    rgb = oklchToRgb(clamp(L, 0, 1), Math.max(0, C), H);
  } else {
    if (parts[0] !== "srgb") return null;
    rgb = { r: num(parts[1], 1) * 255, g: num(parts[2], 1) * 255, b: num(parts[3], 1) * 255 };
  }
  if ([rgb.r, rgb.g, rgb.b].some((v) => !Number.isFinite(v))) return null;
  return { r: clamp(rgb.r, 0, 255), g: clamp(rgb.g, 0, 255), b: clamp(rgb.b, 0, 255), a };
}

const round = (c: Rgb): Rgb => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) });

/** An opaque, rounded colour, or null when the input is missing, unparseable or too translucent to trust. */
export function readableColor(input: string | undefined): Rgb | null {
  const c = parseColor(input);
  return c && c.a >= MIN_ALPHA ? round(c) : null;
}

export function toHex(c: Rgb): string {
  const h = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// WCAG luminance and contrast
// ---------------------------------------------------------------------------------------------------------------

const toLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function luminance(c: Rgb): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Contrast of two CSS colour strings; 1 when either cannot be read. */
export function contrastOf(a: string, b: string): number {
  const ca = readableColor(a), cb = readableColor(b);
  return ca && cb ? contrast(ca, cb) : 1;
}

/** True when a colour reads as a dark surface (white text beats black text on it). */
export const isDarkColor = (c: Rgb) => contrast(c, WHITE) > contrast(c, BLACK);

// ---------------------------------------------------------------------------------------------------------------
// OKLCH lightness adjustment (Bjorn Ottosson's OKLab)
// ---------------------------------------------------------------------------------------------------------------

interface Oklch { L: number; C: number; H: number }

function rgbToOklch(c: Rgb): Oklch {
  const r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** OKLCH to linear sRGB (may be out of gamut). */
function oklchToLinear(L: number, C: number, H: number): [number, number, number] {
  const A = C * Math.cos((H * Math.PI) / 180), B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (v: [number, number, number]) => v.every((x) => x >= -1e-4 && x <= 1 + 1e-4);

function oklchToRgb(L: number, C: number, H: number): Rgb {
  const [r, g, b] = oklchToLinear(L, C, H).map((x) => clamp(toGamma(clamp(x, 0, 1)), 0, 1) * 255) as [number, number, number];
  return { r, g, b };
}

/** The colour at OKLCH lightness L with the same hue, keeping as much chroma as sRGB allows. */
function withLightness(c: Oklch, L: number): Rgb {
  if (inGamut(oklchToLinear(L, c.C, c.H))) return round(oklchToRgb(L, c.C, c.H));
  let lo = 0, hi = c.C;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(L, mid, c.H))) lo = mid; else hi = mid;
  }
  return round(oklchToRgb(L, lo, c.H));
}

const meets = (c: Rgb, against: Rgb[], min: number) => against.every((b) => contrast(c, b) >= min + EPS);

/**
 * `color` itself when it meets `min` against every colour in `against`; otherwise the nearest colour (by OKLCH
 * lightness, same hue) that does; null when no lightness of that hue can.
 */
export function ensureContrast(color: Rgb, against: Rgb[], min: number): { color: Rgb; changed: boolean } | null {
  if (meets(color, against, min)) return { color, changed: false };
  const start = rgbToOklch(color);
  let best: { color: Rgb; dist: number } | null = null;
  for (const dir of [-1, 1]) {
    for (let step = 1; step <= 200; step++) {
      const L = clamp(start.L + dir * step * 0.005, 0, 1);
      const cand = withLightness(start, L);
      if (meets(cand, against, min)) {
        const dist = Math.abs(L - start.L);
        if (!best || dist < best.dist) best = { color: cand, dist };
        break;
      }
      if (L === 0 || L === 1) break;
    }
  }
  return best && { color: best.color, changed: true };
}

/** sRGB mix: t = 0 gives a, t = 1 gives b. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return round({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

/** The furthest step from `from` toward `to` (largest t from `tMax` down to 0) that still satisfies `ok`. */
function furthest(from: Rgb, to: Rgb, tMax: number, ok: (c: Rgb) => boolean): Rgb {
  for (let t = tMax; t > 0.0001; t -= 0.01) {
    const c = mix(from, to, t);
    if (ok(c)) return c;
  }
  return from;
}

function bestOf(cands: Rgb[], against: Rgb[]): Rgb {
  const score = (c: Rgb) => Math.min(...against.map((b) => contrast(c, b)));
  return cands.reduce((a, b) => (score(b) > score(a) ? b : a));
}

// ---------------------------------------------------------------------------------------------------------------
// Fonts and radius
// ---------------------------------------------------------------------------------------------------------------

const FAMILY = /^(?:"[^"\\;{}()<>]{1,64}"|'[^'\\;{}()<>]{1,64}'|[\p{L}\p{N} _.-]{1,64})$/u;
const familyKey = (f: string) => f.replace(/^["']|["']$/g, "").trim().toLowerCase();

/** Families from a computed font-family list; anything that does not look like a plain family name is dropped. */
export function fontFamilies(stack: string | undefined): string[] {
  if (typeof stack !== "string" || stack.length > 600) return [];
  return stack.split(",").map((f) => f.trim()).filter((f) => FAMILY.test(f));
}

/** The page's families first (at most six), then every fallback family the page did not name. */
function fontStack(page: string | undefined, fallback: string): { value: string; fromPage: boolean } {
  const own = fontFamilies(page).slice(0, MAX_PAGE_FAMILIES);
  if (own.length === 0) return { value: fallback, fromPage: false };
  const seen = new Set(own.map(familyKey));
  const rest = fontFamilies(fallback).filter((f) => !seen.has(familyKey(f)));
  return { value: [...own, ...rest].join(", "), fromPage: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------------------------------------------

/** True when the page reads as dark: its background first, then its colour-scheme hint, then light text. */
export function seedIsDark(seed: PageThemeSeed): boolean {
  const bg = readableColor(seed.bg);
  if (bg) return isDarkColor(bg);
  if (seed.scheme) return seed.scheme === "dark";
  const fg = readableColor(seed.fg);
  return fg ? !isDarkColor(fg) : false;
}

/** Choose the fallback binding (the Distill brand, light or dark) that suits the page. */
export function pickFallback<T>(seed: PageThemeSeed, light: T, dark: T): T {
  return seedIsDark(seed) ? dark : light;
}

/** Every CONTRAST_FLOORS pair that a binding misses (empty when it is sound). */
export function floorFailures(b: ThemeBinding): { fg: ColorRole; bg: ColorRole; min: number; ratio: number }[] {
  return CONTRAST_FLOORS.map((f) => ({ ...f, ratio: contrastOf(b[f.fg], b[f.bg]) })).filter((f) => f.ratio < f.min);
}

/**
 * Derive a complete role binding from a host page's seed. Every role is bound; each contrast floor in
 * CONTRAST_FLOORS holds (adjust lightness, else fall back to `fallback`'s value for that role) and every adjusted
 * role is listed in `adjusted`.
 *
 * `adjusted` names a role when the PAGE's own value for it (text, link) missed its floor and was moved or replaced,
 * or when even the fallback's value could not be fitted to this page. Roles that start from the Distill brand (focus,
 * warnings, the device and cloud chips) and are fitted to the page's background are a design choice, not a repair,
 * and are not listed. `--bg` is the page's own and is never changed.
 */
export function deriveTheme(seed: PageThemeSeed, fallback: ThemeBinding): DerivedTheme {
  const adjusted = new Set<Role>();
  const fb = (role: ColorRole): Rgb => readableColor(fallback[role]) ?? BLACK;

  /**
   * Page value first, then the brand's value; each moved along lightness until it meets `min` on `against`. A page
   * value that has to move aims for `goal` (when reachable) rather than scraping the floor: it is already being
   * changed, so it may as well become comfortably readable and leave room for the surfaces built on it.
   */
  const settle = (role: ColorRole, page: Rgb | null, against: Rgb[], min: number, goal = min): Rgb => {
    if (page) {
      const r = meets(page, against, min) ? { color: page, changed: false } : (goal > min && ensureContrast(page, against, goal)) || ensureContrast(page, against, min);
      if (r) {
        if (r.changed) adjusted.add(role);
        return r.color;
      }
      adjusted.add(role);
    }
    const r = ensureContrast(fb(role), against, min);
    if (r) return r.color;
    adjusted.add(role);
    return bestOf([BLACK, WHITE], against);
  };

  const bg = readableColor(seed.bg) ?? fb("--bg");
  const dark = isDarkColor(bg);
  const fg = settle("--fg", readableColor(seed.fg), [bg], 4.5, 7); // 7:1 is WCAG AAA body text
  const fgOn = (min: number) => (surface: Rgb) => contrast(fg, surface) >= min + EPS;

  // Surfaces lean toward the text colour (card) or the accent (note) only as far as body text stays readable on them.
  const card = furthest(bg, fg, dark ? 0.08 : 0.05, fgOn(4.5));
  // Secondary text stays close to body text (at most 30% of the way to the background): the readers are often older.
  const muted = furthest(fg, bg, 0.3, (c) => contrast(c, bg) >= 4.5 + EPS);
  const line = furthest(fg, bg, 0.55, (c) => contrast(c, bg) >= 3 + EPS);
  const accent = settle("--accent", readableColor(seed.link), [bg], 3);
  const textOnAccent = bestOf([bg, fg], [accent]);
  const accentFg = contrast(textOnAccent, accent) >= 4.5 + EPS ? textOnAccent : bestOf([BLACK, WHITE], [accent]);
  const focus = settle("--focus", null, [bg], 3);
  const noteBg = furthest(bg, accent, 0.12, fgOn(4.5));
  const warnBg = fb("--warn-bg");
  const warnFg = settle("--warn-fg", null, [warnBg], 4.5);
  const chipDevice = settle("--chip-device", null, [bg], 4.5);
  const chipCloud = settle("--chip-cloud", null, [bg], 4.5);

  const body = fontStack(seed.fontBody, fallback["--font-body"]);
  const display = fontStack(seed.fontDisplay ?? seed.fontBody, fallback["--font-display"]);
  const r = seed.radiusPx;
  const radius = typeof r === "number" && Number.isFinite(r)
    ? `${Math.round(clamp(r, 0, MAX_RADIUS_PX) * 2) / 2}px`
    : fallback["--radius"];

  const binding: ThemeBinding = {
    "--bg": toHex(bg), "--card": toHex(card), "--fg": toHex(fg), "--muted": toHex(muted), "--line": toHex(line),
    "--accent": toHex(accent), "--accent-fg": toHex(accentFg), "--focus": toHex(focus),
    "--warn-bg": toHex(warnBg), "--warn-fg": toHex(warnFg), "--note-bg": toHex(noteBg),
    "--chip-device": toHex(chipDevice), "--chip-cloud": toHex(chipCloud),
    "--font-body": body.value, "--font-display": display.value, "--radius": radius,
  };

  // Construction guarantees every floor; this guard only matters if a future edit breaks that. It never ships a
  // binding that fails a floor: the fallback's colours replace the page's, and every colour role is reported.
  if (floorFailures(binding).length > 0) {
    for (const role of COLOR_ROLES) binding[role] = fallback[role];
    return { algorithm: THEME_ALGORITHM, seed, binding, adjusted: [...COLOR_ROLES] };
  }

  return { algorithm: THEME_ALGORITHM, seed, binding, adjusted: ROLES.filter((x) => adjusted.has(x)) };
}
