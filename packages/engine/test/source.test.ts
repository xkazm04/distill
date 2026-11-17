import { describe, expect, it } from "vitest";
import { extractPage } from "../src/index.js";
import { parse } from "./helpers.js";
// The three demo pages the web app ships: the source map has to hold on exactly these.
import article from "../../../apps/web/public/demo/article.html?raw";
import form from "../../../apps/web/public/demo/form.html?raw";
import pricing from "../../../apps/web/public/demo/pricing.html?raw";
import news from "./fixtures/news-article.html?raw";

const squash = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
/** The first few words of a block's text, as they read in the page. */
const firstWords = (text: string): string => squash((text.split("\n")[0] ?? "").split(" - ")[0] ?? "").split(" ").slice(0, 4).join(" ");

describe("extractPage onSource", () => {
  for (const [name, html] of [["article", article], ["form", form], ["pricing", pricing]] as const) {
    it(`maps every block of the ${name} demo to the element it was read from`, () => {
      const doc = parse(html);
      const seen = new Map<string, Element>();
      const page = extractPage(doc, `https://distill.example/demo/${name}.html`, {
        onSource: (id, el) => {
          expect(seen.has(id)).toBe(false); // once per block
          seen.set(id, el);
        },
      });
      expect(page.blocks.length).toBeGreaterThan(0);
      expect([...seen.keys()]).toEqual(page.blocks.map((b) => b.id)); // final ids, in order
      for (const b of page.blocks) {
        const el = seen.get(b.id) as Element;
        expect(el.ownerDocument).toBe(doc);
        const words = b.kind === "image" ? squash(el.getAttribute("alt") ?? "") : squash(el.textContent ?? "");
        const want = b.kind === "table" ? squash(b.rows?.[0]?.[0] ?? "") : firstWords(b.text);
        expect(words, `${b.id} (${b.kind}) "${b.text.slice(0, 40)}"`).toContain(want);
      }
    });
  }

  it("reports the leading h1 under its final id b0", () => {
    // The fixture's h1 sits in a header the content walk skips, so it is put in front and the rest renumbered.
    const ids: string[] = [];
    const page = extractPage(parse(news), "https://ledger.example/news/tram", { onSource: (id, el) => { ids.push(id); if (id === "b0") expect(el.tagName).toBe("H1"); } });
    expect(ids).toEqual(page.blocks.map((b) => b.id));
    expect(page.blocks[0]?.text).toBe("City council approves new tram line");
  });

  it("changes nothing in the page model", () => {
    const a = extractPage(parse(article), "https://distill.example/demo/article.html");
    const b = extractPage(parse(article), "https://distill.example/demo/article.html", { onSource: () => undefined });
    expect(b).toEqual(a);
  });
});
