// r5-06 pictures in the cleaned page, and r5-05's numbers in tables: what can be checked without layout. Sizes, the
// gallery (side by side needs boxes) and the space kept for pictures need a real browser: caption-media.spec.ts.
import { afterEach, describe, expect, it } from "vitest";
import { applyMedia, clearMedia, mediaReport, wakeMedia } from "./media";
import { typeset } from "./typeset";

const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const ctxOf = () => {
  const main = document.querySelector("article") as Element;
  return { doc: document, win: window, main, body: Array.from(main.querySelectorAll("p")), protect: [] as Element[] };
};

afterEach(() => { clearMedia(document); document.body.innerHTML = ""; });

describe("lazy pictures (r5-06)", () => {
  it("wakes a stand-in with the page's own data-src and data-srcset, and Close puts the stand-in back", () => {
    document.body.innerHTML = `<article><p>Text of the article that is long enough to count.</p>
      <img id="a" src="${GIF}" data-src="/media/most.png" width="1200" height="800" alt="Most">
      <picture><source id="s" data-srcset="/media/most.webp 1x"><img id="b" src="/img/blank.gif" data-src="/media/b.png" alt="B" width="800" height="600"></picture>
      </article>`;
    applyMedia(ctxOf());
    expect(wakeMedia()).toBe(2);
    expect(document.getElementById("a")?.getAttribute("src")).toBe("/media/most.png");
    expect(document.getElementById("b")?.getAttribute("src")).toBe("/media/b.png");
    expect(document.getElementById("s")?.getAttribute("srcset")).toBe("/media/most.webp 1x");
    expect(mediaReport().lazy).toBe(3);
    // Run again (Stay clean): nothing new to wake.
    applyMedia(ctxOf());
    expect(wakeMedia()).toBe(0);
    clearMedia(document);
    expect(document.getElementById("a")?.getAttribute("src")).toBe(GIF);
    expect(document.getElementById("b")?.getAttribute("src")).toBe("/img/blank.gif");
    expect(document.getElementById("s")?.hasAttribute("srcset")).toBe(false);
    expect(document.querySelectorAll("[data-distill-lazy], style[data-distill]").length).toBe(0);
  });

  it("never sets an address that is not a web address, and leaves a real picture with a data-src alone", () => {
    document.body.innerHTML = `<article><p>Text of the article that is long enough to count.</p>
      <img id="js" src="${GIF}" data-src="javascript:alert(1)" width="1200" height="800" alt="">
      <img id="set" src="${GIF}" data-srcset="/a.png 1x, data:image/png;base64,AAAA 2x" width="1200" height="800" alt="">
      <img id="real" src="/media/real.png" data-src="/media/other.png" width="1200" height="800" alt="">
      </article>`;
    applyMedia(ctxOf());
    expect(wakeMedia()).toBe(0);
    expect(document.getElementById("js")?.getAttribute("src")).toBe(GIF);
    expect(document.getElementById("set")?.hasAttribute("srcset")).toBe(false);
    expect(document.getElementById("real")?.getAttribute("src")).toBe("/media/real.png");
  });

  it("leaves logos and icons alone, and pictures outside the main column", () => {
    document.body.innerHTML = `<header><img id="logo" src="${GIF}" data-src="/logo.png" width="300" height="80" alt=""></header>
      <article><p>Text of the article that is long enough to count.</p>
      <img id="icon" src="${GIF}" data-src="/i/share-icon.png" width="300" height="300" alt="">
      <img id="small" src="/x.png" width="24" height="24" alt=""></article>
      <aside><img id="side" src="${GIF}" data-src="/side.png" width="300" height="250" alt=""></aside>`;
    applyMedia(ctxOf());
    expect(wakeMedia()).toBe(0);
    for (const id of ["logo", "icon", "small", "side"]) {
      expect(document.getElementById(id)?.getAttributeNames().filter((n) => n.startsWith("data-distill")), id).toEqual([]);
    }
  });
});

describe("numbers in data tables (r5-05)", () => {
  it("gives a data table tabular figures and right-aligns its numeric column, header included", () => {
    document.body.innerHTML = `<table id="t"><thead><tr><th>Vstupenka</th><th>Cena</th><th>Platnost</th></tr></thead><tbody>
      <tr><td>Dospělí</td><td>60 Kč</td><td>1 den</td></tr><tr><td>Děti</td><td>30 Kč</td><td>1 den</td></tr>
      <tr><td>Permanentka</td><td>1 200 Kč</td><td>365 dní</td></tr></tbody></table>`;
    const t = document.getElementById("t") as Element;
    const marks = new Map<Element, string[]>();
    typeset({ win: window, body: [t], headings: [], text: 16, scale: 1, mark: (el, decl, block) => { expect(block).toBe(t); marks.set(el, decl); } });
    expect(marks.get(t)).toEqual(["font-variant-numeric: tabular-nums"]);
    const aligned = Array.from(marks.keys()).filter((el) => el !== t).map((el) => el.textContent);
    expect(aligned).toEqual(["Cena", "60 Kč", "30 Kč", "1 200 Kč"]);
  });

  it("leaves a table of words, and a layout table, alone", () => {
    document.body.innerHTML = `<table id="w"><thead><tr><th>Den</th><th>Kde</th></tr></thead><tbody>
      <tr><td>Pondělí</td><td>Úřad</td></tr><tr><td>Středa</td><td>Knihovna</td></tr></tbody></table>
      <table id="l"><tr><td><p>Slovo starosty</p><p>12</p></td><td>34</td></tr><tr><td>56</td><td>78</td></tr></table>`;
    const marks: Element[] = [];
    typeset({ win: window, body: [document.getElementById("w") as Element, document.getElementById("l") as Element], headings: [], text: 16, scale: 1, mark: (el) => { marks.push(el); } });
    expect(marks).toEqual([]);
  });
});
