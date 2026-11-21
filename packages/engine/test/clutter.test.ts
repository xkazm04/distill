import { describe, expect, it } from "vitest";
import { clutterSummary, extractPage, findClutter } from "../src/index.js";
import { parse } from "./helpers.js";
import news from "./fixtures/news-article.html?raw";
import czech from "./fixtures/czech-residence-form.html?raw";

/** The page's content elements, as the extension's content script collects them: every block's source, and the
 *  sources of the running text (paragraphs, lists, tables, quotes). */
function contentOf(doc: Document): { keep: Element[]; body: Element[] } {
  const keep: Element[] = [];
  const page = extractPage(doc, "https://ledger.example/news/tram", { onSource: (_id, el) => keep.push(el) });
  const body = keep.filter((_el, i) => page.blocks[i]?.kind !== "heading" && page.blocks[i]?.kind !== "image");
  return { keep, body };
}

function clean(doc: Document, extraKeep: Element[] = []) {
  const els = new Map<string, Element>();
  const { keep, body } = contentOf(doc);
  const items = findClutter(doc, { keep: [...keep, ...extraKeep], body, onElement: (id, el) => els.set(id, el) });
  return { items, els };
}

describe("findClutter", () => {
  it("finds the cookie banner, the site header, the sidebar, the newsletter box and the footer of an article", () => {
    const doc = parse(news);
    const { items, els } = clean(doc);
    expect(items.map((i) => i.kind)).toEqual(["cookie", "header", "sidebar", "newsletter", "footer"]);
    expect(items.map((i) => i.id)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
    expect(items[0]).toMatchObject({ label: "Cookie notice" });
    expect(els.get("c0")?.id).toBe("cookie-consent");
    // The article, its own header (title, byline) and its figure are content, never clutter.
    for (const el of els.values()) {
      expect(el.querySelector("h1, article")).toBeNull();
      expect(el.closest("article")).toBeNull();
    }
    expect(clutterSummary(items)).toBe("Removed 5 distractions");
  });

  it("inside the article, takes only what announces itself: an ad, a share bar, comments", () => {
    const doc = parse(news.replace("<blockquote>", '<div class="share-bar"><a href="#">Share on X</a></div><div id="ad-inline-1"><span>Reklama</span></div><section class="comments"><h3>412 comments</h3><p>I take the tram every day and this is great news.</p></section><blockquote>'));
    const { items, els } = clean(doc);
    const inside = items.filter((i) => els.get(i.id)?.closest("article"));
    expect(inside.map((i) => i.kind)).toEqual(["share", "ad", "comments"]);
    // The figure without a telling class stays.
    expect([...els.values()].some((el) => el.querySelector("figure, img"))).toBe(false);
  });

  it("finds an overlay by its position, and names a cookie wall by its words", () => {
    const doc = parse(news.replace("<body>", '<body><div style="position: fixed; inset: 0"><div class="box"><p>Souhlasím se zpracováním osobních údajů.</p><button>OK</button></div></div><div style="position: sticky; top: 0">Breaking: storm warning</div>'));
    const { items } = clean(doc);
    expect(items.slice(0, 2).map((i) => i.kind)).toEqual(["cookie", "popup"]);
  });

  it("keeps what the host says is content, and everything around it on the way down", () => {
    const doc = parse(news.replace("<footer>", '<div class="player"><video src="/v.mp4"></video></div><footer>'));
    const video = doc.querySelector("video") as Element;
    const { els } = clean(doc, [video]);
    for (const el of els.values()) expect(el.contains(video)).toBe(false);
  });

  it("never takes protected media, whatever its box calls itself (a video player marked ad-showing)", () => {
    const doc = parse(news.replace("<blockquote>", '<div class="player ad-showing"><video src="/v.mp4"></video></div><blockquote>'));
    const video = doc.querySelector("video") as Element;
    const { keep, body } = contentOf(doc);
    const els: Element[] = [];
    findClutter(doc, { keep, body, protect: [video], onElement: (_id, el) => els.push(el) });
    for (const el of els) expect(el.contains(video)).toBe(false);
  });

  it("takes a self-named column of links even when it holds most of the text", () => {
    const links = Array.from({ length: 12 }, (_, i) => `<p><a href="/v${i}">A much longer recommended video title number ${i} that links away from this page</a></p>`).join("");
    const doc = parse(news.replace("</article>", `</article><div id="related">${links}</div>`));
    const { items, els } = clean(doc);
    const related = items.find((i) => els.get(i.id)?.id === "related");
    expect(related?.kind).toBe("related");
  });

  it("takes a self-named column the page reader read as one block of text", () => {
    const titles = Array.from({ length: 10 }, (_, i) => `<a href="/v${i}">Recommended video title number ${i} that links away</a> 12K views`).join(" ");
    const doc = parse(news.replace("</article>", `</article><div id="related">${titles}</div>`));
    const { items, els } = clean(doc);
    expect(items.find((i) => els.get(i.id)?.id === "related")?.kind).toBe("related");
  });

  it("keeps the lead between the headline and the main text, and still takes a share bar there", () => {
    const html = `<!doctype html><html lang="cs"><body><nav><a href="/">Zprávy</a> <a href="/s">Sport</a></nav>
      <div class="wrap"><div class="head"><h1>Blíží se termín pro podání daňového přiznání</h1></div>
      <div class="lead"><div class="perex"><span>Osoby samostatně výdělečně činné musí od letoška podávat daně výhradně elektronicky.</span></div>
      <figure><img src="/foto.jpg"></figure><div class="share">Sdílet článek</div></div>
      <div class="body"><p>Základní termín pro podání papírového přiznání je 2. dubna 2024, elektronického do 2. května.</p>
      <p>Finanční správa upozorňuje, že nebude možné opakovat loňské rozhodnutí o odpuštění pokuty.</p>
      <p>Daňové přiznání nemusí podávat lidé, jejichž zdanitelné příjmy loni nedosáhly 50 tisíc korun.</p>
      <p>Přiznání je možné podat přes portál Moje daně, což je nejčastější cesta, nebo přes datovou schránku.</p>
      <p>Do portálu se lze přihlásit datovou schránkou, občanským průkazem s čipem nebo bankovní identitou.</p></div></div>
      <footer>Copyright</footer></body></html>`;
    const doc = parse(html);
    const { items, els } = clean(doc);
    const gone = [...els.values()];
    expect(gone.some((el) => el.querySelector("img") || el.classList.contains("perex") || el.querySelector(".perex"))).toBe(false);
    expect(items.map((i) => i.kind)).toEqual(["menu", "share", "footer"]);
  });

  it("on a thin page keeps the menu (it is the way to the content) and still takes a cookie notice", () => {
    const html = `<!doctype html><html lang="cs"><body><div class="cookies">Používáme cookies. <button>OK</button></div>
      <table><tr><td><img src="/auto.jpg" alt="Autoservis Dymáček, Palackého 73, Brno"></td></tr>
      <tr><td><nav><a href="/autoservis.htm">autoservis</a> <a href="/pneu.htm">pneuservis</a></nav></td></tr>
      <tr><td><p>Po - Pá 7.00 - 17.00 hod, tel.: 549 211 296</p></td></tr></table>
      <div id="footer">Počet návštěvníků: 19457</div></body></html>`;
    const doc = parse(html);
    const { items, els } = clean(doc);
    expect(items.map((i) => i.kind)).toEqual(["cookie"]);
    expect([...els.values()].some((el) => el.querySelector("nav") || el.localName === "nav")).toBe(false);
  });

  it("takes an empty backdrop over most of the window, and not a small empty box", () => {
    const doc = parse(news.replace("<body>", '<body><div class="backdrop" style="position: fixed; inset: 0"></div><div class="dot" style="position: fixed"></div>'));
    const els = new Map<string, Element>();
    const { keep, body } = contentOf(doc);
    const items = findClutter(doc, { keep, body, covers: (el) => (el.classList.contains("backdrop") ? 1 : 0.01), onElement: (id, el) => els.set(id, el) });
    expect(items[0]?.kind).toBe("popup");
    expect(els.get("c0")?.className).toBe("backdrop");
    expect([...els.values()].some((el) => el.className === "dot")).toBe(false);
  });

  it("keeps a self-named box that holds most of the text: the article is never taken for comments", () => {
    const doc = parse(news.replace("<article>", '<article class="comments-enabled related-article">'));
    const { els } = clean(doc);
    for (const el of els.values()) expect(el.closest("article") ?? el.querySelector("article")).toBeNull();
  });

  it("never returns an element that holds content, and returns nothing with nothing to keep", () => {
    const doc = parse(czech);
    const { keep, body } = contentOf(doc);
    const els: Element[] = [];
    findClutter(doc, { keep, body, onElement: (_id, el) => els.push(el) });
    for (const el of els) for (const k of keep) expect(el.contains(k)).toBe(false);
    expect(findClutter(doc, { keep: [] })).toEqual([]);
    expect(clutterSummary([])).toBe("Nothing to remove");
  });

  it("names a box by its element before its words, and by its words before a bare box", () => {
    const doc = parse(news.replace("<footer>", '<nav><a href="/">Home</a> <a href="/s">Subscribe now - 50% off</a></nav><aside>ADVERTISEMENT: Win a holiday!</aside><aside>Trending: ten tips for your garden</aside><footer>'));
    const { items } = clean(doc);
    expect(items.map((i) => i.kind)).toEqual(["cookie", "header", "sidebar", "newsletter", "menu", "ad", "related", "footer"]);
  });

  it("skips what is not on screen and empty boxes", () => {
    const doc = parse(news.replace("<footer>", '<div class="spacer"></div><div hidden class="advert">Advertisement</div><footer>'));
    const { els } = clean(doc);
    for (const el of els.values()) expect(el.classList.contains("spacer") || el.hasAttribute("hidden")).toBe(false);
  });
});
