// Colour contrast for reading (spark universal-core #6, "Comfortable to read"): parse the colours a browser computes,
// WCAG 2 contrast, and the nearest colour of the same hue that passes. Pure: no DOM, no network.

/** sRGB 0-255 per channel, alpha 0-1. */
export interface Rgba { r: number; g: number; b: number; a: number }

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function channel(s: string): number {
  const t = s.trim();
  return t.endsWith("%") ? clamp((parseFloat(t) / 100) * 255, 0, 255) : clamp(parseFloat(t), 0, 255);
}
function alphaOf(s: string | undefined): number {
  if (s === undefined) return 1;
  const t = s.trim();
  const n = t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 1;
}

/**
 * A colour as getComputedStyle gives it: `rgb()`/`rgba()` (comma or space syntax), `color(srgb r g b / a)`, `#hex` and
 * `transparent`. Anything else (lab(), oklch(), a keyword) is null: the caller leaves that colour alone.
 */
export function parseColor(input: string | null | undefined): Rgba | null {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const body = m[1] as string;
    const [main, slashAlpha] = body.split("/");
    const parts = (main as string).split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3 || parts.slice(0, 3).some((p) => !Number.isFinite(parseFloat(p)))) return null;
    return { r: channel(parts[0] as string), g: channel(parts[1] as string), b: channel(parts[2] as string), a: alphaOf(slashAlpha ?? parts[3]) };
  }
  m = /^color\(srgb\s+([^)]*)\)$/.exec(s);
  if (m) {
    const [main, slashAlpha] = (m[1] as string).split("/");
    const parts = (main as string).trim().split(/\s+/).map(Number);
    if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) return null;
    return { r: clamp((parts[0] as number) * 255, 0, 255), g: clamp((parts[1] as number) * 255, 0, 255), b: clamp((parts[2] as number) * 255, 0, 255), a: alphaOf(slashAlpha) };
  }
  m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1] as string;
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  return null;
}

/** `top` painted over `under` (an opaque result when `under` is opaque). */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top.a + under.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, u: number) => (t * top.a + u * under.a * (1 - top.a)) / a;
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
}

/** WCAG 2 relative luminance (alpha ignored). */
export function luminance(c: Rgba): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 2 contrast ratio, 1 to 21. A translucent `fg` is painted over `bg` first. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const f = fg.a < 1 ? composite(fg, bg) : fg;
  const a = luminance(f), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// HSL keeps the hue and saturation while only the lightness moves.
function toHsl(c: Rgba): [number, number, number] {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): Rgba {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4), a: 1 };
}

/**
 * Text that reads against `bg` with at least `min` contrast. Null when `fg` already passes. Otherwise the same hue made
 * darker on a light background (lighter on a dark one) only as far as it must go; black or white when even that cannot
 * pass. The result is opaque. `bg` must be opaque (composite it first).
 */
export function readableOn(fg: Rgba, bg: Rgba, min = 4.5): Rgba | null {
  if (contrastRatio(fg, bg) >= min) return null;
  const solid = fg.a < 1 ? composite(fg, bg) : fg;
  const darker = contrastRatio(BLACK, bg) >= contrastRatio(WHITE, bg);
  const [h, s, l] = toHsl(solid);
  // Binary search on the lightness between the colour and the pole (0 or 1).
  let lo = l, hi = darker ? 0 : 1;
  if (contrastRatio(fromHsl(h, s, hi), bg) < min) return darker ? BLACK : WHITE;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(fromHsl(h, s, mid), bg) >= min) hi = mid; else lo = mid;
  }
  const out = fromHsl(h, s, hi);
  // Rounding to whole channels may lose a hair of contrast: step once more towards the pole when it does.
  const round = (c: Rgba): Rgba => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 1 });
  let r = round(out);
  for (let step = 0.002; contrastRatio(r, bg) < min && step < 0.2; step += 0.002) r = round(fromHsl(h, s, clamp(darker ? hi - step : hi + step, 0, 1)));
  return r;
}

/** As CSS: `rgb(12 34 56)`, or with `/ a` when translucent. */
export function cssColor(c: Rgba): string {
  const ch = (v: number) => Math.round(clamp(v, 0, 255));
  return c.a < 1 ? `rgb(${ch(c.r)} ${ch(c.g)} ${ch(c.b)} / ${Math.round(c.a * 1000) / 1000})` : `rgb(${ch(c.r)} ${ch(c.g)} ${ch(c.b)})`;
}
