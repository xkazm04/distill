import { describe, expect, it } from "vitest";
import { extractPage } from "../src/index.js";
import { parse } from "./helpers.js";
import news from "./fixtures/news-article.html?raw";
import pricing from "./fixtures/saas-pricing.html?raw";
import czech from "./fixtures/czech-residence-form.html?raw";

describe("extractPage", () => {
  it("extracts a cluttered article without the clutter", () => {
    const page = extractPage(parse(news), "https://ledger.example/news/tram");
    const all = page.blocks.map((b) => b.text).join("\n");
    expect(page.kind).toBe("article");
    expect(page.lang).toBe("en");
    expect(page.title).toContain("tram line");
    expect(page.blocks[0]).toMatchObject({ id: "b0", kind: "heading", level: 1, text: "City council approves new tram line" });
    page.blocks.forEach((b, i) => expect(b.id).toBe(`b${i}`));
    for (const noise of ["cookies", "Most read", "Advertisement", "Copyright", "Subscribe", "not content", "Home"]) expect(all).not.toContain(noise);
    expect(all).toContain("480 million crowns");
    expect(page.blocks.some((b) => b.kind === "quote")).toBe(true);
    const list = page.blocks.find((b) => b.kind === "list");
    expect(list?.text.split("\n")).toHaveLength(3);
    const img = page.blocks.find((b) => b.kind === "image");
    expect(img).toMatchObject({ text: "A tram passing the old town square", src: "https://ledger.example/img/tram.jpg" });
    expect(page.formCount).toBeUndefined();
    expect(page.blocks.every((b) => !/<[a-z][^>]*>/i.test(b.text))).toBe(true);
  });

  it("classifies a SaaS pricing page as a product and keeps the table", () => {
    const page = extractPage(parse(pricing), "https://beacon.example/pricing");
    expect(page.kind).toBe("product");
    const table = page.blocks.find((b) => b.kind === "table");
    expect(table?.rows?.[0]).toEqual(["Feature", "Starter", "Team", "Business"]);
    const all = page.blocks.map((b) => b.text).join("\n");
    expect(all).toContain("$39 per month");
    expect(all).not.toContain("Log in");
    expect(page.formCount).toBeUndefined();
  });

  it("calls a page dominated by a form a form, reports formCount and leaves the fields out of blocks", () => {
    const page = extractPage(parse(czech), "https://mv.example/zadost");
    expect(page.kind).toBe("form");
    expect(page.lang).toBe("cs");
    expect(page.formCount).toBe(1);
    expect(page.blocks[0]?.text).toBe("Žádost o povolení k přechodnému pobytu");
  });

  it("reads the human text of a form page: legends as headings, labels and help text as a list, never an option", () => {
    const page = extractPage(parse(czech), "https://mv.example/zadost");
    expect(page.blocks.length).toBeGreaterThan(3);
    const headings = page.blocks.filter((b) => b.kind === "heading").map((b) => b.text);
    expect(headings).toEqual(expect.arrayContaining(["Osobní údaje", "Rodinný stav", "Kontakt a pobyt"]));
    expect(page.blocks.find((b) => b.text === "Osobní údaje")?.level).toBe(2);
    expect(page.blocks.find((b) => b.text === "Rodinný stav")?.level).toBe(3);
    const items = page.blocks.filter((b) => b.kind === "list").flatMap((b) => b.text.split("\n"));
    expect(items).toEqual(expect.arrayContaining(["Jméno *", "Telefon", "Rodné číslo * - Rodné číslo najdete na občanském průkazu."]));
    expect(page.blocks.some((b) => b.text.includes("Vyplňte prosím"))).toBe(true);
    const all = page.blocks.map((b) => b.text).join("\n");
    for (const notText of ["Ukrajina", "vyberte", "Odeslat", "a1b2c3"]) expect(all).not.toContain(notText);
    page.blocks.forEach((b, i) => expect(b.id).toBe(`b${i}`));
  });

  it("reads a form page whose title and instructions sit in a page-level header", () => {
    const html = `<html lang="cs"><head><title>Žádost o příspěvek</title></head><body>
      <header><h1>Žádost o příspěvek</h1><p>Vyplňte všechna povinná pole.</p><nav><a href="/">Úvod</a></nav></header>
      <form><fieldset><legend>Žadatel</legend>
        <label for="a">Jméno * <span class="hint">jak je v pasu</span></label><input id="a" name="a">
        <label for="b">Příjmení *</label><input id="b" name="b">
        <label for="c">Obec</label><input id="c" name="c">
      </fieldset><p><button>Odeslat</button></p></form></body></html>`;
    const page = extractPage(parse(html), "https://x.example/form");
    expect(page.kind).toBe("form");
    expect(page.blocks.map((b) => b.text)).toEqual(["Vyplňte všechna povinná pole.", "Žadatel", "Jméno * - jak je v pasu\nPříjmení *\nObec"]);
  });

  it("does not repeat the title as the first block (whitespace and case do not count)", () => {
    const doc = parse(news);
    doc.title = "  city COUNCIL approves   new tram line ";
    const page = extractPage(doc, "https://ledger.example/news/tram");
    expect(page.title).toBe("city COUNCIL approves new tram line");
    expect(page.blocks[0]?.kind).not.toBe("heading");
    expect(page.blocks.some((b) => b.text === "City council approves new tram line")).toBe(false);
    page.blocks.forEach((b, i) => expect(b.id).toBe(`b${i}`));
  });

  it("keeps a first heading that differs from the title, once", () => {
    const page = extractPage(parse(news), "https://ledger.example/news/tram");
    expect(page.blocks.filter((b) => b.text === "City council approves new tram line")).toHaveLength(1);
  });

  it("adds an h1 outside the content root once, and not at all when it only repeats the title", () => {
    const body = `<div class="top"><h1>Opening hours</h1></div><div class="content">
      <p>The library opens at nine in the morning on weekdays, and at ten on Saturdays, except on public holidays.</p>
      <p>On Sundays, the reading room stays closed, but the book return box at the main door is open all day.</p></div>`;
    const other = extractPage(parse(`<html><head><title>City library</title></head><body>${body}</body></html>`), "https://lib.example/");
    expect(other.blocks[0]).toMatchObject({ id: "b0", kind: "heading", level: 1, text: "Opening hours" });
    expect(other.blocks.filter((b) => b.text === "Opening hours")).toHaveLength(1);
    const same = extractPage(parse(`<html><head><title>Opening Hours</title></head><body>${body}</body></html>`), "https://lib.example/");
    expect(same.blocks.some((b) => /opening hours/i.test(b.text))).toBe(false);
    expect(same.blocks[0]).toMatchObject({ id: "b0", kind: "paragraph" });
    const untitled = extractPage(parse(`<html><body>${body}</body></html>`), "https://lib.example/");
    expect(untitled.title).toBe("Opening hours");
    expect(untitled.blocks.some((b) => b.text === "Opening hours")).toBe(false);
  });

  it("falls back to lang 'und' and the host when the page says nothing", () => {
    const page = extractPage(parse("<html><body><p>Short.</p></body></html>"), "https://x.example/");
    expect(page.lang).toBe("und");
    expect(page.title).toBe("x.example");
  });

  it("leaves a form page's validation messages out, and keeps a page with no form whole", () => {
    // A message can repeat what the person typed (values class); a docs page's "Errors" chapter is page text.
    const form = extractPage(parse(`<html lang="cs"><body><main><h1>Žádost</h1><p>Vyplňte formulář pečlivě a pravdivě.</p>
      <form><label for="a">Jméno</label><input id="a"><span class="error">Jméno nesmí obsahovat číslice</span>
      <label for="b">Obec</label><input id="b"><small>Jak ji píše úřad</small><label for="c">Ulice</label><input id="c"></form></main></body></html>`), "https://x.example/f");
    const text = JSON.stringify(form.blocks);
    expect(text).toContain("Jak ji píše úřad");
    expect(text).not.toContain("číslice");
    const docs = extractPage(parse(`<html lang="en"><body><main><h1>API</h1><section id="errors"><h2>Error codes</h2>
      <p class="error">A 404 means the record does not exist, and a 409 means it changed meanwhile.</p></section></main></body></html>`), "https://x.example/docs");
    expect(JSON.stringify(docs.blocks)).toContain("A 404 means the record does not exist");
  });
});
