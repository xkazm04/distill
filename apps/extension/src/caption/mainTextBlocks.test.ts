// r3-01: the main text that claims, the gist, plain words and the link notes read is only the text. Run on saved,
// trimmed copies of two real Czech news articles (the engine's fixtures), after Clean, as the content script reads it.
import { afterEach, describe, expect, it } from "vitest";
import { extractPage, findClutter } from "@distill/engine";
import denik from "../../../../packages/engine/test/fixtures/denik-article.html?raw";
import aktualne from "../../../../packages/engine/test/fixtures/aktualne-article.html?raw";
import { commonAncestor, type CleanContext } from "./context";
import { clearTranslation, mainTextBlocks } from "./translate";

const collapse = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
const squash = (s: string): string => s.replace(/\s+/g, "");

/** The page loaded, Clean run on it (what it finds is marked hidden, as Clean marks it), and the context it leaves. */
function cleaned(html: string, url: string, label?: (el: Element) => string): CleanContext {
  const doc = new DOMParser().parseFromString(html, "text/html");
  document.title = doc.title;
  document.documentElement.setAttribute("lang", "cs");
  document.body.innerHTML = doc.body.innerHTML;
  const keep: Element[] = [];
  const page = extractPage(document, url, { onSource: (_id, el) => keep.push(el) });
  const body = keep.filter((_el, i) => ["paragraph", "list", "table", "quote", "code"].includes(page.blocks[i]?.kind ?? ""));
  const main = body.length ? body.reduce<Element>((a, b) => commonAncestor(a, b), body[0] as Element) : null;
  findClutter(document, { keep, body, label, onElement: (id, el) => el.setAttribute("data-distill-hide", id) });
  return { doc: document, win: window, keep, body, main, protect: [], removed: new Map() };
}

afterEach(() => { clearTranslation(); document.body.innerHTML = ""; });

describe("mainTextBlocks on a real Deník article", () => {
  const url = "https://www.denik.cz/ekonomika/prispevek-na-bydleni-2024/";
  const label = (el: Element) => (el.classList.contains("content-box-wrap") ? "Reklama" : "");

  it("starts with the article's first paragraph: not the headline, the photo credit, the caption or the Google promo", () => {
    const blocks = mainTextBlocks(cleaned(denik, url, label));
    expect(blocks[0]?.text).toMatch(/^Řada lidí nechává peníze ležet na ulici/);
    const all = blocks.map((b) => b.text).join("\n");
    for (const never of ["Příspěvek na bydlení 2024: Jak podat žádost", "Deník/Jakub Dostál", "Čtěte v článku", "upřednostnit v Google", "Související články", "Daň z nemovitosti v roce 2024", "KDU-ČSL Ministerstvo"]) {
      expect(all, never).not.toContain(never);
    }
  });

  it("holds every real paragraph of the article", () => {
    const blocks = mainTextBlocks(cleaned(denik, url, label)).map((b) => squash(b.text));
    const real = Array.from(document.querySelectorAll(".article-body p")).map((p) => collapse(p.textContent)).filter((t) => t.length >= 40);
    expect(real.length).toBeGreaterThanOrEqual(10);
    for (const p of real) expect(blocks.some((b) => b.includes(squash(p).slice(0, 70))), p).toBe(true);
  });
});

describe("mainTextBlocks on a real Aktuálně article", () => {
  const url = "https://zpravy.aktualne.cz/ekonomika/dane-elektronicky-navod/r~efa4315afe2311ee95ee0cc47ab5f122/";

  it("starts with the lead, leaves the headline and the photo credit out, and holds every real paragraph", () => {
    const blocks = mainTextBlocks(cleaned(aktualne, url));
    const texts = blocks.map((b) => b.text);
    expect(texts[0]).toMatch(/^Osoby samostatně výdělečně činné/);
    expect(texts.join("\n")).not.toContain("Foto: ČTK");
    expect(texts.join("\n")).not.toContain("Blíží se termín pro podání daňového přiznání online");
    const real = Array.from(document.querySelectorAll(".article__content p")).map((p) => collapse(p.textContent)).filter((t) => t.length >= 40);
    expect(real.length).toBeGreaterThanOrEqual(8);
    for (const p of real) expect(texts.some((b) => squash(b).includes(squash(p).slice(0, 70))), p).toBe(true);
  });
});

describe("mainTextBlocks keeps an old site's stacked headings", () => {
  it("drops only the one headline; a page of several h1s keeps them (all but one the title repeats)", () => {
    document.title = "Půjčovna vozíků";
    document.body.innerHTML = `<div id="c"><h1>Půjčovna vozíků</h1><h1>Pondělí až pátek 9 až 18 hodin</h1>
      <p id="p">Počet vleků i typů stále rozšiřujeme, od července máme další tři nové typy vleků.</p></div>`;
    const $ = (s: string) => document.querySelector(s) as Element;
    const ctx: CleanContext = { doc: document, win: window, keep: [...document.querySelectorAll("h1"), $("#p")], body: [$("#p")], main: $("#c"), protect: [], removed: new Map() };
    expect(mainTextBlocks(ctx).map((b) => b.text)).toEqual([
      "Pondělí až pátek 9 až 18 hodin",
      "Počet vleků i typů stále rozšiřujeme, od července máme další tři nové typy vleků.",
    ]);
  });
});
