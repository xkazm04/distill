import { describe, expect, it } from "vitest";
import { CLUTTER_LABELS, clutterSummary, extractPage, findClutter, findEmptySpace } from "../src/index.js";
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

/** G11: the page reader took loose text from a box (a bare text node in an <article>), so that box is content; what
 *  names itself plainly inside it still goes, as inside the main column, as long as it holds none of the content. */
describe("findClutter: clutter inside a box the page reader read text from", () => {
  const LONG = "The council said on Monday that the tram line to the hospital opens in June, with a stop every four minutes at rush hour, and that the old bus line will run on until the end of the summer.";
  /** An article with a bare line of text of its own (so the page reader takes the article itself in), around `inner`. */
  const page = (inner: string, articleAttrs = "") => `<!doctype html><html lang="en"><body>
    <nav><a href="/">Home</a> <a href="/city">City</a></nav>
    <article${articleAttrs}><h1>The tram line opens in June</h1>
      By the city desk, 12 May 2026. ${LONG}
      <p>${LONG} Tickets stay at the same price for now, the transport office said.</p>
      ${inner}
      <p>${LONG} Cyclists will get a new lane along the line by the autumn.</p>
      <p>${LONG} The works on Mill Street end a week before the opening.</p>
    </article>
    <footer>Copyright The Ledger</footer></body></html>`;

  it("takes an ad, a share bar, a sign-up and a back-to-top link from inside it", () => {
    const doc = parse(page([
      '<div class="share-bar"><a href="#">Share on X</a> <a href="#">Share on Facebook</a></div>',
      '<div class="ad-slot"><span>Advertisement</span><p>Garden furniture sale: 30% off this weekend only.</p></div>',
      '<div class="newsletter-box"><p>Get the city newsletter every Friday.</p><button>Sign up</button></div>',
      '<div class="totop"><a href="#top">Back to top</a></div>',
    ].join("")));
    const { items, els } = clean(doc);
    // The article is content (the page reader read its own line of text), and stays.
    expect([...els.values()].some((el) => el.localName === "article" || el.querySelector("article"))).toBe(false);
    expect(items.map((i) => i.kind)).toEqual(["menu", "share", "ad", "newsletter", "backToTop", "footer"]);
  });

  it("keeps an inline 'Advertisement' word in its text and in a paragraph", () => {
    const doc = parse(page('<p>Every shop on the line can show an <b>Advertisement</b> in the stops, the office said, at a price set by the council.</p>')
      .replace("By the city desk", "<span>Advertisement</span> By the city desk"));
    const { items, els } = clean(doc);
    expect(items.map((i) => i.kind)).toEqual(["menu", "footer"]);
    expect([...els.values()].some((el) => el.closest("article"))).toBe(false);
  });

  it("keeps the box itself when it is the running text, whatever it calls itself, and keeps a box holding the main video", () => {
    const doc = parse(page('<div class="player ad-showing"><video src="/v.mp4"></video></div><div class="share"><a href="#">Share</a></div>', ' class="post comments-open"'));
    const { keep, body } = contentOf(doc);
    const video = doc.querySelector("video") as Element;
    const els = new Map<string, Element>();
    const items = findClutter(doc, { keep, body, protect: [video], onElement: (id, el) => els.set(id, el) });
    expect(items.map((i) => i.kind)).toEqual(["menu", "share", "footer"]);
    for (const el of els.values()) { expect(el.contains(video)).toBe(false); expect(el.localName).not.toBe("article"); }
  });

  it("never looks inside a box of running text with no blocks of its own (a paragraph)", () => {
    const doc = parse(page('<p>The office will put up a notice <span class="ad">sponsored by the tram company</span> at every stop before the opening day.</p>'));
    const { items } = clean(doc);
    expect(items.map((i) => i.kind)).toEqual(["menu", "footer"]);
  });
});

/** Things that float over the page (#4). `box` plays the browser: where each fixed box sits in a 1440x900 window. */
describe("findClutter: things that float over the page", () => {
  const WIN = { winWidth: 1440, winHeight: 900 };
  const at = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, ...WIN });
  /** Adds `html` at the start of the article page's body; returns the kind found for each element with a data-t. */
  function kinds(html: string, place: Record<string, ReturnType<typeof at>> = {}, protect: (doc: Document) => Element[] = () => []) {
    const doc = parse(news.replace("<body>", `<body>${html}`));
    const { keep, body } = contentOf(doc);
    const els = new Map<string, Element>();
    const items = findClutter(doc, {
      keep, body, protect: protect(doc), onElement: (id, el) => els.set(id, el),
      box: (el) => place[el.getAttribute("data-t") ?? ""] ?? null,
    });
    const out: Record<string, string> = {};
    for (const it of items) { const t = els.get(it.id)?.getAttribute("data-t"); if (t) out[t] = it.kind; }
    return { out, items };
  }

  it("knows each kind by the names its makers give it", () => {
    const { out, items } = kinds([
      '<div data-t="a" id="intercom-container" style="position: fixed"><iframe title="Intercom live chat launcher" srcdoc="<p></p>"></iframe></div>',
      '<div data-t="b" class="tawk-min-container" style="position: fixed"><p>Napište nám</p></div>',
      '<div data-t="c" class="_hj_feedback_container" style="position: fixed"><button>Feedback</button></div>',
      '<div data-t="d" class="usabilla_live_button_container" style="position: fixed"><button>Zpětná vazba</button></div>',
      '<div data-t="e" class="article-video sticky-player" style="position: fixed"><video src="/v.mp4"></video></div>',
      '<div data-t="f" class="smartbanner smartbanner--android" style="position: fixed"><p>Open in the app</p></div>',
      '<a data-t="g" class="back-to-top" href="#" style="position: fixed">Nahoru</a>',
      '<a data-t="h" id="scrollTop" href="#" style="position: fixed"><svg></svg></a>',
      '<div data-t="i" id="smartsupp-widget-container"><iframe srcdoc="<p></p>"></iframe></div>',
    ].join(""));
    expect(out).toEqual({ a: "chat", b: "chat", c: "feedback", d: "feedback", e: "player", f: "appBanner", g: "backToTop", h: "backToTop", i: "chat" });
    expect(items.find((i) => i.kind === "chat")?.label).toBe("Chat button");
    expect(items.find((i) => i.kind === "feedback")?.label).toBe("Feedback tab");
    expect(items.find((i) => i.kind === "player")?.label).toBe("Floating video");
    expect(items.find((i) => i.kind === "appBanner")?.label).toBe("App banner");
    expect(items.find((i) => i.kind === "backToTop")?.label).toBe("Back to top button");
  });

  it("knows a small fixed box with no telling name by its place, what it holds and its words", () => {
    const { out } = kinds([
      '<div data-t="chat" class="x8f2" style="position: fixed"><iframe srcdoc="<p>Hi</p>"></iframe></div>',
      '<div data-t="tab" class="k1" style="position: fixed"><button>Feedback</button></div>',
      '<div data-t="video" class="k2" style="position: fixed"><div><video src="/ad.mp4"></video></div></div>',
      '<div data-t="top" class="k3" style="position: fixed"><a href="#top"><svg></svg></a></div>',
      '<div data-t="help" class="k4" style="position: fixed"><button aria-label="Potřebujete poradit?"><svg></svg></button></div>',
      '<div data-t="app" class="k5" style="position: fixed"><p>Stáhněte si naši aplikaci</p><a href="#">Otevřít</a></div>',
      '<div data-t="box" class="k6" style="position: fixed"><p>Win a prize today</p></div>',
    ].join(""), {
      chat: at(1340, 800, 70, 70), // bottom-right corner
      tab: at(1400, 380, 40, 140), // the right edge, half way down
      video: at(1060, 640, 360, 200),
      top: at(1370, 820, 48, 48),
      help: at(20, 820, 60, 60), // bottom-left
      app: at(0, 0, 1440, 64), // a bar across the top
      box: at(500, 300, 440, 300), // in the middle: a pop-up, whatever it says
    });
    expect(out).toEqual({ chat: "chat", tab: "feedback", video: "player", top: "backToTop", help: "chat", app: "appBanner", box: "popup" });
  });

  it("does not take a fixed header with the site's menu for a chat button", () => {
    const { out } = kinds([
      '<div data-t="bar" class="top-wrap" style="position: fixed"><a href="/">Home</a> <a href="/chat">Chat</a> <a href="/help">Need help?</a></div>',
      '<header data-t="head" style="position: fixed"><nav><a href="/">Home</a> <a href="/chat">Live chat</a></nav></header>',
    ].join(""), { bar: at(0, 0, 1440, 72), head: at(0, 0, 1440, 90) });
    expect(out.bar).not.toBe("chat");
    expect(out.head).toBe("header");
    // Without layout (no box), the same bar is a pop-up as before, never a chat button.
    expect(kinds('<div data-t="bar" style="position: fixed"><a href="/">Home</a> <a href="/chat">Chat</a></div>').out.bar).toBe("popup");
  });

  it("never takes a floating player that is the page's main video", () => {
    const { out } = kinds('<div data-t="p" class="sticky-player" style="position: fixed"><video src="/main.mp4"></video></div>',
      { p: at(1060, 640, 360, 200) }, (doc) => [doc.querySelector("video") as Element]);
    expect(out.p).toBeUndefined();
  });

  it("takes a feedback box and a back-to-top link from inside the article", () => {
    const doc = parse(news.replace("</article>", '<div class="article-feedback"><p>Was this article helpful?</p><button>Yes</button></div><div class="totop"><a href="#top">Back to top</a></div></article>'));
    const { items, els } = clean(doc);
    const inside = items.filter((i) => els.get(i.id)?.closest("article"));
    expect(inside.map((i) => i.kind)).toEqual(["feedback", "backToTop"]);
  });
});

/** G15: Clean on a very large page. A page's hidden parts, its icons' drawings and its content are not asked about
 *  things that float; what is found stays the same. */
describe("findClutter: a very large page", () => {
  /** The article page with a hidden menu of `n` items (display: none by its inline style, which `rendered` reads here
   *  as the browser would), `n` icons and a fixed cookie bar. */
  function big(n: number): Document {
    const items = Array.from({ length: n }, (_, i) => `<li><a href="/c${i}"><span>Category ${i}</span></a></li>`).join("");
    const icons = Array.from({ length: n }, () => '<svg viewBox="0 0 24 24"><g><path d="M0 0h24v24H0z"></path><path d="M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z"></path></g></svg>').join("");
    return parse(news.replace("<body>", `<body><div class="mega" style="display: none"><ul>${items}</ul><div class="late" style="position: fixed">Late offer</div></div>`
      + `<div class="toolbar">${icons}</div><div class="bar" style="position: fixed">We use cookies on this site. <button>OK</button></div>`));
  }
  const drawn = (el: Element) => !/display\s*:\s*none/.test(el.getAttribute("style") ?? "");
  const fixed = (el: Element) => (/position\s*:\s*fixed/.test(el.getAttribute("style") ?? "") ? "fixed" : "static");

  it("never asks the position of what is hidden, inside an icon or inside the content", () => {
    const doc = big(500);
    const asked: Element[] = [];
    const { keep, body } = contentOf(doc);
    const items = findClutter(doc, { keep, body, rendered: drawn, position: (el) => { asked.push(el); return fixed(el); } });
    expect(asked.some((el) => el.closest(".mega"))).toBe(false);
    expect(asked.some((el) => el.closest("svg"))).toBe(false);
    expect(asked.some((el) => keep.some((k) => k.contains(el)))).toBe(false);
    // The page has about 3,500 elements; fewer than 60 are asked.
    expect(doc.body.querySelectorAll("*").length).toBeGreaterThan(3000);
    expect(asked.length).toBeLessThan(60);
    expect(items.some((i) => i.kind === "cookie")).toBe(true);
  });

  it("finds the same as when every element is asked", () => {
    const doc = big(50);
    const { keep, body } = contentOf(doc);
    // What a browser says: nothing inside a display: none box is on screen.
    const shown = (el: Element) => !el.closest("[style*='display: none']");
    const run = (rendered?: (el: Element) => boolean) => {
      const els: Element[] = [];
      const items = findClutter(doc, { keep, body, shown, rendered, position: fixed, onElement: (_id, el) => els.push(el) });
      return { items, els };
    };
    const all = run(), pruned = run(drawn);
    expect(pruned.items).toEqual(all.items);
    expect(pruned.els).toEqual(all.els);
    // The icon toolbar, the fixed cookie bar, then what the article page always had.
    expect(all.items.map((i) => i.kind)).toEqual(["other", "cookie", "cookie", "header", "sidebar", "newsletter", "footer"]);
  });
});

describe("a Subscribe button is not a newsletter sign-up", () => {
  it("leaves a channel's Subscribe button, takes a sign-up box with a field", () => {
    const doc = parse(`<!doctype html><html lang="en"><body>
      <main><h1>Potato pancakes</h1>
        <p>${"A long description of how to make potato pancakes at home, with grated potatoes and garlic. ".repeat(4)}</p>
        <div class="owner"><a href="/c/chef">Chef</a><div id="subscribe-button"><button>Subscribe</button></div></div>
        <p>${"Fry them in lard until golden on both sides, then serve with sauerkraut. ".repeat(4)}</p>
        <div class="subscribe"><p>Get our recipes every week</p><input type="email" placeholder="E-mail"><button>Subscribe</button></div>
      </main></body></html>`);
    const keep: Element[] = [];
    extractPage(doc, "https://example.org/watch", { onSource: (_id, el) => keep.push(el) });
    const kinds: [string, string][] = [];
    findClutter(doc, { keep, onElement: (id, el) => kinds.push([el.className || el.id, id]) });
    const names = kinds.map(([n]) => n);
    expect(names).not.toContain("subscribe-button");
    expect(names).toContain("subscribe");
  });
});

describe("findEmptySpace: empty boxes inside the main text (r4-01)", () => {
  // Layout in a test document comes from data-* attributes: data-h (height), data-w (width, default 640), data-d
  // (display, default block), data-pic (a background picture), data-label (words CSS draws).
  const opts = (keep: Element[]) => ({
    keep,
    hidden: (el: Element) => el.hasAttribute("data-distill-hide"),
    size: (el: Element) => ({ width: Number(el.getAttribute("data-w") ?? 640), height: Number(el.getAttribute("data-h") ?? 200) }),
    display: (el: Element) => el.getAttribute("data-d") ?? "block",
    picture: (el: Element) => el.hasAttribute("data-pic"),
    label: (el: Element) => el.getAttribute("data-label") ?? "",
  });
  const page = `<main id="main">
      <p id="p1">First paragraph of the article, a real one.</p>
      <div id="bar" data-h="24"></div>
      <article id="related" data-h="32"><div><article class="js-related-article" data-distill-hide="c3"><a href="/x">Read also</a><img src="a.jpg"></article></div></article>
      <p id="empty-p" data-h="22">&nbsp;</p>
      <figure id="fig" data-h="300"><img src="photo.jpg"></figure>
      <div id="pic" data-h="60" data-pic></div>
      <div id="label" data-h="40" data-label="Reklama"></div>
      <div id="tall" data-h="300"></div>
      <div id="thin" data-h="8"></div>
      <div id="narrow" data-h="60" data-w="40"></div>
      <span id="inline" data-h="24" data-d="inline"></span>
      <hr id="rule" data-h="24">
      <div id="field" data-h="40"><input name="q"></div>
      <table><tbody><tr><td id="cell" data-h="24"></td></tr></tbody></table>
      <p id="p2">Second paragraph of the article, a real one too.</p>
    </main>`;

  it("finds the empty bar and the frame left of a hidden box; keeps every paragraph, picture, field and table part", () => {
    const doc = parse(page);
    const keep = [doc.getElementById("p1"), doc.getElementById("p2"), doc.getElementById("fig")] as Element[];
    const found = findEmptySpace(doc.getElementById("main") as Element, opts(keep)).map((el) => el.id);
    expect(found).toEqual(["bar", "related", "empty-p"]);
    expect(CLUTTER_LABELS.space).toBe("Empty space");
  });

  it("a box whose hidden part comes back holds something again", () => {
    const doc = parse(page);
    doc.querySelector(".js-related-article")?.removeAttribute("data-distill-hide");
    const keep = [doc.getElementById("p1"), doc.getElementById("p2")] as Element[];
    expect(findEmptySpace(doc.getElementById("main") as Element, opts(keep)).map((el) => el.id)).not.toContain("related");
  });

  it("looks inside a box that holds content, never into content itself", () => {
    const doc = parse(`<main id="main"><section id="s"><p id="p">A paragraph inside a section of the article.</p><div id="gap" data-h="30"></div></section>
      <p id="q">Another paragraph <span id="sp" data-h="24" data-d="block"></span> with an empty span inside.</p></main>`);
    const keep = [doc.getElementById("p"), doc.getElementById("q")] as Element[];
    expect(findEmptySpace(doc.getElementById("main") as Element, opts(keep)).map((el) => el.id)).toEqual(["gap"]);
  });
});
