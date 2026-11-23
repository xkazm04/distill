// Dark page (r3-06), the page side: the colour rules (light backgrounds go dark with their hue, text reads at 4.5:1 or
// better), pictures are never marked, a dark page is left alone, and off takes every mark and the stylesheet away.
// Real layout and rendering: e2e/caption-dark.spec.ts.
import { contrastRatio, luminance, parseColor, type Rgba } from "@distill/engine";
import { afterEach, describe, expect, it } from "vitest";
import { clearDark, darkBackground, darkBorder, darkText, MIN_CONTRAST, setDark } from "./dark";

const rgb = (r: number, g: number, b: number): Rgba => ({ r, g, b, a: 1 });

describe("colours", () => {
  it("white becomes a near-black, a pale yellow a dark yellowish one; dark ones stay", () => {
    const w = darkBackground(rgb(255, 255, 255)) as Rgba;
    expect(luminance(w)).toBeLessThan(0.02);
    const y = darkBackground(rgb(255, 248, 220)) as Rgba;
    expect(luminance(y)).toBeLessThan(0.05);
    expect(y.r).toBeGreaterThan(y.b); // still yellowish
    expect(darkBackground(rgb(20, 30, 60))).toBeNull();
    expect(darkBorder(rgb(221, 221, 221))).not.toBeNull();
  });
  it("text that reads on the new background keeps its colour; other text turns light just enough", () => {
    const bg = darkBackground(rgb(255, 255, 255)) as Rgba;
    expect(darkText(rgb(240, 240, 240), bg)).toBeNull();
    for (const fg of [rgb(0, 0, 0), rgb(34, 34, 34), rgb(102, 102, 102), rgb(6, 69, 173), rgb(200, 0, 0), rgb(0, 100, 0)]) {
      const t = darkText(fg, bg) as Rgba;
      expect(contrastRatio(t, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    // A link blue stays blue.
    const link = darkText(rgb(6, 69, 173), bg) as Rgba;
    expect(link.b).toBeGreaterThan(link.r);
  });
  it("on every background a light one becomes, body text passes 4.5:1", () => {
    for (let l = 120; l <= 255; l += 15) {
      for (const tint of [[0, 0, 0], [0, -10, -40], [-30, -10, 0]]) {
        const page = rgb(Math.max(0, l + (tint[0] as number)), Math.max(0, l + (tint[1] as number)), Math.max(0, l + (tint[2] as number)));
        const bg = darkBackground(page);
        if (!bg) continue;
        for (const fg of [rgb(0, 0, 0), rgb(85, 85, 85), rgb(51, 51, 102)]) {
          const t = darkText(fg, bg) ?? fg;
          expect(contrastRatio(t, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
      }
    }
  });
});

describe("the page", () => {
  afterEach(() => { clearDark(document); document.body.innerHTML = ""; document.body.removeAttribute("style"); document.documentElement.removeAttribute("style"); });

  it("marks what changes, never a picture, and off takes everything away", () => {
    document.body.setAttribute("style", "background-color: rgb(255, 255, 255); color: rgb(17, 17, 17)");
    document.body.innerHTML = `<main><p id="p">Text</p><img id="img" src="a.png"><svg id="logo"><rect fill="rgb(255,0,0)"/></svg>
      <div id="note" style="background-color: rgb(255, 248, 220)">Note</div><video id="v"></video><canvas id="c"></canvas></main>`;
    const before = document.documentElement.outerHTML;
    expect(setDark(document, window, true)).toEqual({ dark: true, alreadyDark: false });
    expect(document.documentElement.hasAttribute("data-distill-dark-on")).toBe(true);
    expect(document.body.getAttribute("data-distill-dark")).toBeTruthy();
    expect(document.getElementById("note")?.getAttribute("data-distill-dark")).toBeTruthy();
    for (const id of ["img", "logo", "v", "c"]) expect(document.getElementById(id)?.hasAttribute("data-distill-dark")).toBe(false);
    expect(document.querySelector("#logo rect")?.hasAttribute("data-distill-dark")).toBe(false);
    const css = document.querySelector('style[data-distill="dark"]')?.textContent ?? "";
    expect(css).toContain(":not([data-distill-original])");
    // The rule for body: a dark background and light text that reads on it.
    const id = document.body.getAttribute("data-distill-dark") as string;
    const rule = css.split("\n").find((l) => l.includes(`"${id}"`)) ?? "";
    const bg = parseColor(/background-color: ([^!]+) !important/.exec(rule)?.[1]) as Rgba;
    const fg = parseColor(/[^-]color: ([^!]+) !important/.exec(rule)?.[1]) as Rgba;
    expect(luminance(bg)).toBeLessThan(0.05);
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    // Twice on changes nothing more.
    expect(setDark(document, window, true)).toEqual({ dark: true, alreadyDark: false });

    expect(setDark(document, window, false)).toEqual({ dark: false, alreadyDark: false });
    expect(document.querySelectorAll("[data-distill-dark]").length).toBe(0);
    expect(document.querySelector('style[data-distill="dark"]')).toBeNull();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("follows parts that change later: a menu that opens by its class, a box whose style turns light (r4-01)", async () => {
    const sheet = document.createElement("style");
    sheet.id = "t-sheet";
    sheet.textContent = ".menu { display: none; background-color: rgb(255, 255, 255); color: rgb(34, 34, 34); } .menu.open { display: block; }"
      + " .nav.on .sub { display: block; } .sub { display: none; background-color: rgb(250, 250, 250); }";
    document.head.append(sheet);
    document.body.setAttribute("style", "background-color: rgb(255, 255, 255); color: rgb(17, 17, 17)");
    document.body.innerHTML = `<p>Text</p><div id="menu" class="menu"><a id="link" href="#">Item</a></div><div id="box">Box</div>
      <nav id="nav" class="nav"><ul id="sub" class="sub"><li>Sub</li></ul></nav>`;
    try {
      setDark(document, window, true);
      expect(document.getElementById("menu")?.hasAttribute("data-distill-dark")).toBe(false); // hidden: not looked at yet
      const ruleOf = (id: string) => {
        const css = document.querySelector('style[data-distill="dark"]')?.textContent ?? "";
        const mark = document.getElementById(id)?.getAttribute("data-distill-dark");
        return mark ? css.split("\n").find((l) => l.includes(`"${mark}"`)) ?? "" : "";
      };
      expect(ruleOf("box")).not.toContain("background-color"); // no background of its own yet
      document.getElementById("menu")?.classList.add("open");
      document.getElementById("box")?.setAttribute("style", "background-color: rgb(255, 248, 220)");
      document.getElementById("nav")?.classList.add("on");
      await new Promise((r) => setTimeout(r, 300));
      for (const id of ["menu", "box", "sub"]) expect(document.getElementById(id)?.getAttribute("data-distill-dark"), id).toBeTruthy();
      const css = document.querySelector('style[data-distill="dark"]')?.textContent ?? "";
      const rule = css.split("\n").find((l) => l.includes(`"${document.getElementById("box")?.getAttribute("data-distill-dark")}"`)) ?? "";
      expect(luminance(parseColor(/background-color: ([^!]+) !important/.exec(rule)?.[1]) as Rgba)).toBeLessThan(0.05);
      // The box changes back to no background: its mark goes, as the page made it.
      document.getElementById("box")?.removeAttribute("style");
      await new Promise((r) => setTimeout(r, 300));
      expect(document.getElementById("box")?.hasAttribute("data-distill-dark")).toBe(false);
      // Off takes the later marks away too.
      setDark(document, window, false);
      expect(document.querySelectorAll("[data-distill-dark]").length).toBe(0);
    } finally {
      sheet.remove();
    }
  });

  it("a page that is dark already is left alone", () => {
    document.body.setAttribute("style", "background-color: rgb(18, 18, 18); color: rgb(230, 230, 230)");
    document.body.innerHTML = `<p>Dark text page</p>`;
    const before = document.documentElement.outerHTML;
    expect(setDark(document, window, true)).toEqual({ dark: false, alreadyDark: true });
    expect(document.documentElement.outerHTML).toBe(before);
  });
});
