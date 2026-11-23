// r3-01: the main text is only the text. Photo credits, "read also" boxes, a "follow us on Google" promo and ad slots
// that show only their label are not the page's blocks, and Clean takes the promo, the boxes and the slots away. The
// fixtures are saved, trimmed copies of two real Czech news articles (Deník, Aktuálně), as they stood on 2026-11-23.
import { describe, expect, it } from "vitest";
import { boilerKind, cssLabel, extractPage, findClutter, isCredit } from "../src/index.js";
import { parse } from "./helpers.js";
import denik from "./fixtures/denik-article.html?raw";
import aktualne from "./fixtures/aktualne-article.html?raw";

const collapse = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
/** Words compared without spaces: a block's text puts a space between two boxes where textContent runs them on. */
const squash = (s: string): string => s.replace(/\s+/g, "");
const holds = (texts: string[], p: string): boolean => texts.some((t) => squash(t).includes(squash(p).slice(0, 70)));

/** Every real paragraph of the article: each <p> of the article's body with a sentence in it. */
function paragraphs(doc: Document, body: string): string[] {
  return Array.from(doc.querySelectorAll(`${body} p`)).map((p) => collapse(p.textContent)).filter((t) => t.length >= 40);
}

/** What Clean is handed (as the extension's content script builds it) and what it finds. `label` plays the page's CSS:
 *  Deník draws "Reklama" in each ad slot with ::before. */
function clean(doc: Document, url: string, label?: (el: Element) => string) {
  const keep: Element[] = [];
  const page = extractPage(doc, url, { onSource: (_id, el) => keep.push(el) });
  const body = keep.filter((_el, i) => ["paragraph", "list", "table", "quote", "code"].includes(page.blocks[i]?.kind ?? ""));
  const els = new Map<string, Element>();
  const items = findClutter(doc, { keep, body, label, onElement: (id, el) => els.set(id, el) });
  return { page, items, removed: [...els.values()] };
}

const denikLabel = (el: Element): string => (el.classList.contains("content-box-wrap") && !el.classList.contains("content-box-wrap--no-label") ? "Reklama" : "");

describe("isCredit", () => {
  it("knows a photo's credit line", () => {
    for (const t of ["Foto: ČTK", "Foto: Deník/Jan Novák", "Ilustrační foto | Foto: ČTK / Švancara Petr", "Zdroj: Shutterstock", "Photo: Reuters", "FOTO: archiv obce", "Ilustrační foto"]) {
      expect(isCredit(t), t).toBe(true);
    }
    expect(isCredit("Deník/Jakub Dostál", true)).toBe(true);
    expect(isCredit("ČTK/Michal Kamaryt", true)).toBe(true);
  });

  it("never takes a sentence for one", () => {
    for (const t of [
      "Fotografie z akce najdete v galerii na webu obce, kde je zveřejní redakce do konce týdne.",
      "Zdroj vody pro celou obec je vrt u hřiště.",
      "Deník/Jakub Dostál",
      "Výši příspěvku na bydlení lze orientačně zjistit například v kalkulačce ministerstva práce a sociálních věcí.",
    ]) expect(isCredit(t), t).toBe(false);
  });
});

describe("boilerKind", () => {
  it("names a read-also box, a Google promo and a bare ad label", () => {
    const doc = parse(`<div id="a"><strong>Čtěte také:</strong> <a href="/x">Stát si vytváří cenovou mapu nájmů</a></div>
      <div id="b"><h3>Mohlo by vás zajímat</h3><ul><li><a href="/1">Daň z nemovitosti 2024</a></li><li><a href="/2">Příspěvek na bydlení</a></li></ul></div>
      <div id="c"><span>Sledujte nás na Google News</span> <a href="https://news.google.com/x">Sledovat</a></div>
      <div id="d">REKLAMA</div>
      <p id="e">Čtěte také pozorně podmínky, které úřad práce zveřejnil na svém webu, protože se letos změnily a týkají se všech žadatelů o příspěvek.</p>
      <div id="f"><h2>See also</h2><ul><li><a href="/w">Prague</a></li></ul></div>`);
    const k = (id: string) => boilerKind(doc.getElementById(id) as Element);
    expect([k("a"), k("b"), k("c"), k("d")]).toEqual(["related", "related", "promo", "ad"]);
    // A sentence that starts like one but is not mostly links, and a plain "See also" section, are left alone.
    expect(k("e")).toBeNull();
    expect(k("f")).toBeNull();
  });

  it("reads the words CSS draws", () => {
    expect(cssLabel('"Reklama"')).toBe("Reklama");
    expect(cssLabel("none")).toBe("");
    expect(cssLabel("normal")).toBe("");
  });
});

describe("Deník: the main text is only the text", () => {
  const url = "https://www.denik.cz/ekonomika/prispevek-na-bydleni-2024/";

  it("leaves the photo credit, the Google promo and the related box out of the page's blocks, and keeps every real paragraph", () => {
    const doc = parse(denik);
    const { page } = clean(doc, url);
    const texts = page.blocks.map((b) => b.text);
    const all = texts.join("\n");
    expect(all).not.toContain("Deník/Jakub Dostál");
    expect(all).not.toContain("upřednostnit v Google");
    expect(all).not.toContain("Související články");
    const real = paragraphs(doc, ".article-body");
    expect(real.length).toBeGreaterThanOrEqual(10);
    for (const p of real) expect(holds(texts, p), p).toBe(true);
    // Between the headline and the lead: the byline, the date, the photo and its caption; no credit, no promo.
    const lead = texts.findIndex((t) => t.startsWith("Řada lidí nechává peníze ležet na ulici"));
    expect(lead).toBeGreaterThan(0);
    expect(texts.slice(0, lead).join(" | ")).not.toMatch(/Dostál|Google|Reklama/);
  });

  it("Clean takes away the Google promo, the related box and every ad slot that shows only its Reklama label, and no paragraph", () => {
    const doc = parse(denik);
    const { items, removed } = clean(doc, url, denikLabel);
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("promo");
    expect(items.find((i) => i.kind === "promo")?.label).toBe("Site promotion");
    expect(removed.some((el) => collapse(el.textContent).startsWith("Související články"))).toBe(true);
    const slots = Array.from(doc.querySelectorAll(".article-body .content-box-wrap"));
    expect(slots.length).toBeGreaterThanOrEqual(3);
    for (const slot of slots) expect(removed.some((el) => el.contains(slot)), slot.outerHTML.slice(0, 120)).toBe(true);
    for (const p of Array.from(doc.querySelectorAll(".article-body p"))) {
      if (collapse(p.textContent).length >= 40) expect(removed.some((el) => el.contains(p)), collapse(p.textContent)).toBe(false);
    }
    expect(removed.some((el) => el.contains(doc.querySelector("h1") as Element))).toBe(false);
  });

  it("without the CSS label an empty slot is only an empty box, and stays", () => {
    const doc = parse(denik);
    const { removed } = clean(doc, url);
    const empty = Array.from(doc.querySelectorAll(".article-body .content-box-wrap")).filter((s) => !collapse(s.textContent) && !s.querySelector("iframe, video"));
    expect(empty.length).toBeGreaterThan(0);
    for (const slot of empty) expect(removed.some((el) => el.contains(slot))).toBe(false);
  });
});

describe("Aktuálně: the main text is only the text", () => {
  const url = "https://zpravy.aktualne.cz/ekonomika/dane-elektronicky-navod/r~efa4315afe2311ee95ee0cc47ab5f122/";

  it("leaves the photo credit and the related boxes out and keeps every real paragraph", () => {
    const doc = parse(aktualne);
    const { page, removed } = clean(doc, url);
    const texts = page.blocks.map((b) => b.text);
    expect(texts.join("\n")).not.toContain("Foto: ČTK");
    expect(texts.join("\n")).not.toContain("Související");
    const real = paragraphs(doc, ".article__content");
    expect(real.length).toBeGreaterThanOrEqual(8);
    for (const p of real) {
      expect(holds(texts, p), p).toBe(true);
      expect(removed.some((el) => el.contains(Array.from(doc.querySelectorAll(".article__content p")).find((e) => collapse(e.textContent) === p) as Element))).toBe(false);
    }
  });
});
