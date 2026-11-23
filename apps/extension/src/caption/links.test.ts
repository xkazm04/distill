// Link notes (r2-07), the page side: which links get a note, what it says, and that it goes (Escape, scroll, the
// switch, Original, close). The e2e (caption-tables-links.spec.ts) checks it in a real browser with the strip.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CleanContext } from "./context";
import { clearLinks, HOVER_MS, linkNotes, noteLines, noteShown, setLinks } from "./links";

const PAGE = `
<nav><a id="menu" href="https://www.example.org/menu">Menu</a></nav>
<main id="main"><article>
  <p id="p">Vyhláška ve formátu <a id="pdf" href="/files/vyhlaska.pdf">PDF</a>, web <a id="out" href="https://www.mojedane.cz/?utm_source=obec&id=3">Moje daně</a>,
  <a id="mail" href="mailto:obec@example.cz">e-mail</a>, <a id="anchor" href="#poplatky">poplatky</a>, <a id="js" href="javascript:void(0)">tisk</a>.</p>
  <footer><a id="foot" href="https://www.example.org/">patička</a></footer>
</article></main>
<aside><a id="side" href="https://www.example.org/side">Reklama</a></aside>`;

const over = (id: string) => document.getElementById(id)?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));

function setup(): CleanContext {
  document.body.innerHTML = PAGE;
  const p = document.getElementById("p") as Element;
  return { doc: document, win: window, keep: [p], body: [p], main: document.getElementById("main"), protect: [], removed: new Map() };
}

describe("link notes on the page", () => {
  beforeEach(() => { vi.useFakeTimers(); linkNotes(setup()); });
  afterEach(() => { clearLinks(document); vi.useRealTimers(); });

  it("pointing at a link of the main text shows its note after a moment", () => {
    over("out");
    expect(noteShown()).toBeNull();
    vi.advanceTimersByTime(HOVER_MS + 10);
    const text = noteShown() ?? "";
    expect(text).toContain("mojedane.cz");
    expect(text).toContain("Leaves this site");
    expect(text).toContain("Tracking tags: utm_source");
    expect(text).toContain("Copy clean link");
    expect(document.querySelectorAll("distill-link-note")).toHaveLength(1);
  });

  it("a PDF of the same site", () => {
    over("pdf");
    vi.advanceTimersByTime(HOVER_MS + 10);
    expect(noteShown()).toMatch(/On this site.*PDF file/);
  });

  it("no note on mailto, anchor, javascript, or links outside the main text", () => {
    for (const id of ["mail", "anchor", "js", "menu", "foot", "side"]) {
      over(id);
      vi.advanceTimersByTime(HOVER_MS + 10);
      expect(noteShown(), id).toBeNull();
    }
  });

  it("Escape and scrolling take it down", () => {
    over("out");
    vi.advanceTimersByTime(HOVER_MS + 10);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(noteShown()).toBeNull();
    over("pdf");
    vi.advanceTimersByTime(HOVER_MS + 10);
    expect(noteShown()).not.toBeNull();
    document.dispatchEvent(new Event("scroll"));
    expect(noteShown()).toBeNull();
  });

  it("the switch off: no notes; Original takes one down", async () => {
    setLinks(document, false);
    over("out");
    vi.advanceTimersByTime(HOVER_MS + 10);
    expect(noteShown()).toBeNull();
    setLinks(document, true);
    over("pdf");
    vi.advanceTimersByTime(HOVER_MS + 10);
    expect(noteShown()).not.toBeNull();
    document.documentElement.setAttribute("data-distill-original", "");
    await vi.waitFor(() => expect(noteShown()).toBeNull());
    over("out");
    vi.advanceTimersByTime(HOVER_MS + 10);
    expect(noteShown()).toBeNull();
    document.documentElement.removeAttribute("data-distill-original");
  });

  it("close removes the note and stops listening", () => {
    over("out");
    vi.advanceTimersByTime(HOVER_MS + 10);
    clearLinks(document);
    expect(document.querySelectorAll("distill-link-note")).toHaveLength(0);
    over("pdf");
    vi.advanceTimersByTime(HOVER_MS + 10);
    expect(noteShown()).toBeNull();
    expect(document.querySelectorAll("distill-link-note")).toHaveLength(0);
  });
});

describe("noteLines", () => {
  it("names a redirect, a program and many tracking tags", () => {
    expect(noteLines({ site: "mvcr.cz", leaves: true, unwrapped: "https://www.mvcr.cz/", clean: "https://www.mvcr.cz/", tracking: [], kind: "web" }).map((l) => l.text))
      .toEqual(["Leaves this site", "Goes through a redirect to mvcr.cz"]);
    const prog = noteLines({ site: "e.cz", leaves: true, fileType: "EXE", tracking: [], kind: "web" });
    expect(prog[1]).toEqual({ text: "EXE file: a program that runs on your device", warn: true });
    expect(noteLines({ site: "e.cz", leaves: false, tracking: ["utm_source", "utm_medium", "utm_campaign", "fbclid"], kind: "web" })[1]?.text)
      .toBe("Tracking tags: utm_source, utm_medium, utm_campaign and 1 more");
  });
});
