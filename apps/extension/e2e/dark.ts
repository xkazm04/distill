// Dark page (r3-06), measured in the page: the contrast of the main text against what is really behind it, shared by
// the demo spec (caption-dark.spec.ts) and the live probe (live/probes/dark.live.ts).
import type { Page } from "playwright/test";

export interface TextContrast {
  /** Text elements measured (paragraphs, list items, cells, links with 20+ characters, on screen or not). */
  measured: number;
  /** Over a picture: not measured (the picture is the background). */
  overPicture: number;
  min: number;
  median: number;
  /** Measured elements below 4.5:1. */
  below: number;
  /** The worst few, for the report. */
  worst: { text: string; ratio: number; fg: string; bg: string }[];
  /** The page's background under its main text (luminance 0..1). */
  pageLuminance: number;
}

/** WCAG contrast of every main-text element's colour on the colours composited behind it. Runs in the page. */
export function textContrast(page: Page): Promise<TextContrast> {
  return page.evaluate(() => {
    type C = { r: number; g: number; b: number; a: number };
    const parse = (s: string): C | null => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (!m) return null;
      const p = (m[1] as string).split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] ?? 1 };
    };
    const over = (t: C, u: C): C => {
      const a = t.a + u.a * (1 - t.a);
      if (!a) return { r: 0, g: 0, b: 0, a: 0 };
      const m = (x: number, y: number) => (x * t.a + y * u.a * (1 - t.a)) / a;
      return { r: m(t.r, u.r), g: m(t.g, u.g), b: m(t.b, u.b), a };
    };
    const lum = (c: C) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: C, b: C) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const canvas = (): C => {
      // The canvas: the root's colour, else body's (propagated), else white, or the browser's dark under a dark-only scheme.
      const root = parse(getComputedStyle(document.documentElement).backgroundColor);
      if (root && root.a > 0) return over(root, { r: 255, g: 255, b: 255, a: 1 });
      const scheme = getComputedStyle(document.documentElement).colorScheme;
      return /dark/.test(scheme) && !/light/.test(scheme) ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    };
    /** What is behind `el`: its own and its ancestors' backgrounds over the canvas; null over a picture. */
    const behind = (el: Element): C | null => {
      const layers: C[] = [];
      for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
        if (/url\(/.test(cs.backgroundImage)) return null;
      }
      let bg = canvas(); // under an opaque layer it no longer shows
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i] as C, bg);
      return bg;
    };
    const els = Array.from(document.querySelectorAll("p, li, td, dd, blockquote, h1, h2, h3, a")).filter((el) => {
      if (el.closest("[data-distill-hide], distill-caption, nav, footer, header, aside")) return false;
      const t = (el.textContent ?? "").trim();
      const cs = getComputedStyle(el);
      return t.length >= 20 && cs.display !== "none" && cs.visibility !== "hidden" && el.getClientRects().length > 0;
    }).slice(0, 400);
    const out: { text: string; ratio: number; fg: string; bg: string }[] = [];
    let pictures = 0;
    for (const el of els) {
      const bg = behind(el);
      if (!bg) { pictures++; continue; }
      const fg = parse(getComputedStyle(el).color);
      if (!fg) continue;
      const solid = fg.a < 1 ? over(fg, bg) : fg;
      out.push({ text: (el.textContent ?? "").trim().slice(0, 60), ratio: Math.round(ratio(solid, bg) * 100) / 100,
        fg: `rgb(${Math.round(solid.r)},${Math.round(solid.g)},${Math.round(solid.b)})`, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` });
    }
    const ratios = out.map((o) => o.ratio).sort((a, b) => a - b);
    // The page under its text: the median luminance of what is behind the measured text (not the middle of the window,
    // which can be a photo or a video player).
    const lums = els.map(behind).filter((c): c is C => !!c).map(lum).sort((a, b) => a - b);
    const pageLum = lums.length ? (lums[Math.floor(lums.length / 2)] as number) : lum(canvas());
    return {
      measured: out.length, overPicture: pictures,
      min: ratios[0] ?? 0, median: ratios[Math.floor(ratios.length / 2)] ?? 0,
      below: ratios.filter((r) => r < 4.5).length,
      worst: [...out].sort((a, b) => a.ratio - b.ratio).slice(0, 5),
      pageLuminance: Math.round(pageLum * 1000) / 1000,
    };
  });
}
