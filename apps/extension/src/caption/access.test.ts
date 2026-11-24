// r5-10: what Clean removes never takes the page's way in. The e2e (caption-keyboard.spec.ts) checks it in a real
// browser: the skip link works after Clean, the h1 and the main landmark stay, focus never lands on what went.
import { beforeEach, describe, expect, it } from "vitest";
import { clearWayIn, keepSkipLinks, rescueFocus, skipLinks, spareWayIn, WAY, WAY_LINK } from "./access";

const PAGE = `
<header id="head"><a id="skip" href="#obsah">Přeskočit na obsah</a><nav id="menu"><a href="/a">Úřad</a><a href="#top">Nahoru</a></nav></header>
<div id="wrap">
  <div id="hero"><h1 id="h1">Nová knihovna</h1></div>
  <main id="obsah"><p id="p1">Knihovna se stěhuje do staré školy.</p></main>
  <aside id="side"><button id="ad">Zavřít reklamu</button></aside>
</div>`;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const shown = (el: Element, w = 300) => Object.defineProperty(el, "getBoundingClientRect", { configurable: true, value: () => ({ width: w, height: w ? 40 : 0, top: 0, left: 0, right: w, bottom: 40 }) });

beforeEach(() => { document.body.innerHTML = PAGE; shown($("h1")); });

describe("skipLinks", () => {
  it("finds a skip link by its words, or by where it points; not a menu link to the top", () => {
    expect(skipLinks(document, $("p1")).map((a) => a.id)).toEqual(["skip"]);
    $("skip").textContent = "Obsah"; // no skip words: it points to the main landmark
    expect(skipLinks(document, $("p1")).map((a) => a.id)).toEqual(["skip"]);
    $("skip").setAttribute("href", "#nowhere");
    expect(skipLinks(document, $("p1"))).toEqual([]);
  });
});

describe("spareWayIn", () => {
  it("keeps an item that holds the page's h1 or the main landmark with the text; removes the rest", () => {
    const removed = new Map<string, Element>([["c0", $("hero")], ["c1", $("side")], ["c2", $("wrap")], ["c3", $("head")]]);
    expect([...spareWayIn(document, removed, [$("p1")])].sort()).toEqual(["c0", "c2"]);
  });

  it("an h1 that is not shown is not the page's headline", () => {
    shown($("h1"), 0);
    expect([...spareWayIn(document, new Map([["c0", $("hero")]]), [$("p1")])]).toEqual([]);
  });
});

describe("keepSkipLinks and clearWayIn", () => {
  it("marks the removed box that holds the skip link and the link; nothing when the target went too", () => {
    $("head").setAttribute("data-distill-hide", "c3");
    expect(keepSkipLinks(document, [$("head")], $("p1"))).toBe(1);
    expect($("head").hasAttribute(WAY)).toBe(true);
    expect($("skip").hasAttribute(WAY_LINK)).toBe(true);
    clearWayIn(document);
    expect(document.querySelector(`[${WAY}], [${WAY_LINK}]`)).toBeNull();
    $("obsah").setAttribute("data-distill-hide", "c9");
    expect(keepSkipLinks(document, [$("head")], $("p1"))).toBe(0);
  });
});

describe("rescueFocus", () => {
  it("takes focus out of what Distill hid; leaves it on a kept skip link and on the page", () => {
    $("ad").focus();
    expect(document.activeElement).toBe($("ad"));
    expect(rescueFocus(document)).toBe(false); // nothing hidden yet
    $("side").setAttribute("data-distill-hide", "c1");
    expect(rescueFocus(document)).toBe(true);
    expect(document.activeElement).not.toBe($("ad"));
    $("head").setAttribute("data-distill-hide", "c3");
    $("skip").setAttribute(WAY_LINK, "");
    $("skip").focus();
    expect(rescueFocus(document)).toBe(false);
    expect(document.activeElement).toBe($("skip"));
  });
});
