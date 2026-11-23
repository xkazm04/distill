// r5-07: the marks on a page, read the same way by the hermetic spec (caption-marks.spec.ts) and the live probe
// (live/probes/marks.live.ts): which highlights are up, the wash's strength in Distill's style sheet, and the colours a
// mark meets (the background behind the marked words, the text's colour, and the system's Mark/MarkText as this page
// resolves them). markContrast (src/caption/marks.ts) turns the colours into the contrast table.
import { parseColor, type Rgba } from "@distill/engine";
import type { Page } from "playwright/test";
import { markContrast, type MarkContrast } from "../src/caption/marks";

export interface MarksNow {
  /** Ranges per highlight name. */
  ranges: Record<string, number>;
  /** Priorities of the highlights that are up. */
  priority: Record<string, number>;
  /** The wash's percent in the actions' style sheet, or null. */
  wash: number | null;
}

export const marksNow = (page: Page): Promise<MarksNow> => page.evaluate(() => {
  const reg = (CSS as unknown as { highlights?: Map<string, Set<Range> & { priority: number }> }).highlights;
  const ranges: Record<string, number> = {};
  const priority: Record<string, number> = {};
  for (const [name, h] of reg ?? []) if (name.startsWith("distill-")) { ranges[name] = h.size; priority[name] = h.priority; }
  const m = /Mark (\d+)%/.exec(document.getElementById("distill-actions-style")?.textContent ?? "");
  return { ranges, priority, wash: m ? Number(m[1]) : null };
});

/** `overPicture`: a background image is behind the words, so `bg` is only the colour under it (not in the table). */
export interface MarkColours { bg: string; text: string; mark: string; markText: string; where: string; overPicture: boolean }

/** The colours under the first element matching `selector` (a marked block), as computed now. */
export const markColours = (page: Page, selector: string): Promise<MarkColours | null> => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const parse = (s: string) => {
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return null;
    const p = (m[1] as string).split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0] as number, g: p[1] as number, b: p[2] as number, a: p[3] ?? 1 };
  };
  // Behind the element: its own and its ancestors' backgrounds over the canvas.
  const layers: { r: number; g: number; b: number; a: number }[] = [];
  let overPicture = false;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    const c = parse(cs.backgroundColor);
    if (/url\(|gradient\(/i.test(cs.backgroundImage)) overPicture = true;
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
  }
  // Laid over a picture that is not its background (positioned over an <img>): under its first line, before an opaque
  // box of its own.
  const first = el.getClientRects()[0];
  if (first) {
    for (const under of document.elementsFromPoint(first.left + Math.min(4, first.width / 2), first.top + first.height / 2)) {
      if (under === el || el.contains(under)) continue;
      if (under.contains(el)) { if ((parse(getComputedStyle(under).backgroundColor)?.a ?? 0) >= 1) break; continue; }
      if (["img", "picture", "video", "canvas", "svg", "iframe"].includes(under.localName)) { overPicture = true; break; }
    }
  }
  const scheme = getComputedStyle(document.documentElement).colorScheme ?? "";
  let bg = /dark/.test(scheme) && !/light/.test(scheme) ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) {
    const t = layers[i] as typeof bg;
    bg = { r: t.r * t.a + bg.r * (1 - t.a), g: t.g * t.a + bg.g * (1 - t.a), b: t.b * t.a + bg.b * (1 - t.a), a: 1 };
  }
  const sys = (name: string) => {
    const probe = document.createElement("span");
    probe.style.color = name;
    el.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  };
  return {
    bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
    text: getComputedStyle(el).color,
    mark: sys("Mark"),
    markText: sys("MarkText"),
    where: `${el.localName}${el.id ? `#${el.id}` : ""}`,
    overPicture,
  };
}, selector);

/** The contrast of every mark on these colours (null when one of them cannot be read). */
export function contrastOf(c: MarkColours): (MarkContrast & { colours: MarkColours }) | null {
  const [bg, text, mark, markText] = [c.bg, c.text, c.mark, c.markText].map(parseColor) as (Rgba | null)[];
  if (!bg || !text || !mark || !markText) return null;
  return { ...markContrast(bg, text, mark, markText), colours: c };
}
