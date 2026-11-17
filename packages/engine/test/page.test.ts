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

  it("falls back to lang 'und' and the host when the page says nothing", () => {
    const page = extractPage(parse("<html><body><p>Short.</p></body></html>"), "https://x.example/");
    expect(page.lang).toBe("und");
    expect(page.title).toBe("x.example");
  });
});
