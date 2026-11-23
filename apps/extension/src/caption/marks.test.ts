// r5-07: one mark system. The pure parts: the CSS every feature takes, the verdict styles, the wash and the contrast of
// every mark on light, dark and Dark-page backgrounds.
import { describe, expect, it } from "vitest";
import type { Rgba } from "@distill/engine";
import {
  activeCss, backgroundBehind, CLAIM_LINE, markContrast, NOTE_CSS, ringCss, underlineCss, WASH_MAX, WASH_MIN, WASH_TEXT_MIN, washCss, washFor, washOn,
} from "./marks";

const rgb = (r: number, g: number, b: number): Rgba => ({ r, g, b, a: 1 });
/** Backgrounds and text the marks meet: a light article, a page dark already, a page Dark page darkened (dark.ts makes
 *  white about #181a1b and keeps light text at >= 4.5:1), and a dark page with grey text (the hard case for a wash). */
const PAGES: Record<string, { bg: Rgba; text: Rgba }> = {
  light: { bg: rgb(255, 255, 255), text: rgb(34, 34, 34) },
  dark: { bg: rgb(18, 18, 18), text: rgb(230, 230, 230) },
  darkPage: { bg: rgb(24, 26, 27), text: rgb(232, 230, 227) },
  darkGrey: { bg: rgb(30, 30, 30), text: rgb(150, 150, 150) },
};

describe("the marks' CSS", () => {
  it("uses system colours only, never a colour literal", () => {
    const all = [underlineCss("x", "dotted"), washCss("x", 20), activeCss("a", "b"), ringCss("[x]"), NOTE_CSS].join("\n");
    expect(all).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(activeCss("a", "b")).toBe("::highlight(a), ::highlight(b) { background-color: Mark; color: MarkText; }");
    expect(ringCss("[x]")).toContain("solid Mark");
    expect(ringCss("[x]")).toContain("MarkText");
    expect(washCss("x", 18)).toContain("Mark 18%");
  });

  it("gives every claim state its own line style: verdicts are told apart without colour", () => {
    const styles = Object.values(CLAIM_LINE);
    expect(new Set(styles).size).toBe(styles.length);
    expect(underlineCss("distill-claim-disputed", CLAIM_LINE.disputed)).toContain("underline wavy");
  });
});

describe("washFor", () => {
  it("is full on a light page and fainter on a dark page with grey text", () => {
    expect(washFor(PAGES.light!.bg, PAGES.light!.text)).toBe(WASH_MAX);
    const grey = washFor(PAGES.darkGrey!.bg, PAGES.darkGrey!.text);
    expect(grey).toBeLessThan(WASH_MAX);
    expect(grey).toBeGreaterThanOrEqual(WASH_MIN);
  });

  it("never lets the wash push readable text below 4.5:1", () => {
    for (const [name, p] of Object.entries(PAGES)) {
      const c = markContrast(p.bg, p.text);
      if (c.text >= WASH_TEXT_MIN) expect(c.textOnWash, name).toBeGreaterThanOrEqual(WASH_TEXT_MIN);
    }
  });
});

describe("washOn (the page as it looks)", () => {
  it("weighs the wash on the colours behind the words, and leaves words over a picture out", () => {
    document.body.innerHTML = `<div id="d" style="background-color: rgb(30, 30, 30)"><p id="g" style="color: rgb(150, 150, 150)">grey</p></div>
      <div style="background-image: url(x.png)"><p id="pic" style="color: rgb(0, 0, 0)">on a picture</p></div>
      <p id="w" style="color: rgb(34, 34, 34)">light</p>`;
    const el = (id: string) => document.getElementById(id) as Element;
    expect(backgroundBehind(el("pic"))).toBeNull();
    expect(washOn([el("w")])).toBe(WASH_MAX);
    expect(washOn([el("pic")])).toBe(WASH_MAX);
    expect(washOn([el("w"), el("g"), el("pic")])).toBe(washFor(PAGES.darkGrey!.bg, PAGES.darkGrey!.text));
    document.body.innerHTML = "";
  });
});

describe("markContrast", () => {
  it("keeps the active mark and the ring readable on every background", () => {
    for (const [name, p] of Object.entries(PAGES)) {
      const c = markContrast(p.bg, p.text);
      expect(c.activeText, name).toBeGreaterThan(19);
      // One of the ring's two lines (MarkText, Mark) stands out at >= 4.4:1 on any background.
      expect(c.ring, name).toBeGreaterThanOrEqual(4.4);
      expect(c.underline, name).toBe(c.text);
    }
  });

  it("finds the worst background for the ring near mid grey, still above 4.4:1", () => {
    let worst = 21;
    for (let v = 0; v <= 255; v += 5) worst = Math.min(worst, markContrast(rgb(v, v, v), rgb(0, 0, 0)).ring);
    expect(worst).toBeGreaterThanOrEqual(4.4);
  });
});
