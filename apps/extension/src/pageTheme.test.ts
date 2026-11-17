import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { readPageTheme } from "./pageTheme";

function page(html: string): Document {
  const w = new Window({ url: "https://example.test/" });
  w.document.write(html);
  return w.document as unknown as Document;
}

// A light news site: white page, dark body copy, red links, a serif body, a sans headline, square-ish buttons.
const NEWS = `<!doctype html><html lang="en"><head><meta name="color-scheme" content="light"></head>
<body style="background-color: #fafafa; color: #1a1a1a; font-family: Georgia, 'Times New Roman', serif">
  <nav><a href="/" style="color: #ffffff">Home</a></nav>
  <main>
    <h1 style="font-family: 'Helvetica Neue', Arial, sans-serif">Council approves the new tram line</h1>
    <p>The vote passed on Tuesday. <a href="/more" style="color: #c4302b">Read more</a></p>
    <form><input type="text" value="secret-typed-value" style="border-radius: 2px"></form>
  </main>
</body></html>`;

// A dark docs site: dark background on the html element, light text, blue links, a sans stack, rounded inputs.
const DOCS = `<!doctype html><html style="background-color: rgb(13, 17, 23); color-scheme: dark">
<body style="color: rgb(230, 237, 243); font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">
  <div role="main">
    <h2>Getting started</h2>
    <p>Install the package, then <a href="#config" style="color: rgb(47, 129, 247)">configure it</a>.</p>
    <button style="border-radius: 6px">Copy</button>
  </div>
</body></html>`;

// A marketing page whose hero has an image background: the background cannot be read, so it is left out.
const HERO = `<!doctype html><html><body style="background-color: #ffffff">
  <main style="background-image: url(hero.jpg); color: #ffffff">
    <h1>Big ideas</h1><p>Start your free trial <a href="/t" style="color: #ffd700">today</a>.</p>
    <button style="border-radius: 999px">Go</button>
  </main>
</body></html>`;

// A page with a webfont stack and a translucent overlay over a coloured wrapper.
const WEBFONT = `<!doctype html><html><body style="background-color: #f5f0e6">
  <article style="background-color: rgba(0, 0, 0, 0.04); font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, serif; color: #2b2b2b">
    <h1 style="font-family: Inter, 'Inter var', system-ui, sans-serif">Letters from the archive</h1>
    <p>Notes. <a href="/a" style="color: rgba(30, 90, 160, 0.5)">translucent link</a></p>
  </article>
  <footer><a href="/b" style="color: #1e5aa0">opaque link outside the article</a></footer>
</body></html>`;

// Nothing set at all: the browser's white canvas shows through.
const PLAIN = `<!doctype html><html><body><p>Plain.</p></body></html>`;

describe("readPageTheme", () => {
  it("reads a light news site", () => {
    expect(readPageTheme(page(NEWS))).toEqual({
      scheme: "light",
      bg: "rgb(250, 250, 250)",
      fg: "rgb(26, 26, 26)",
      link: "rgb(196, 48, 43)",
      fontBody: "Georgia, \"Times New Roman\", serif",
      fontDisplay: "\"Helvetica Neue\", Arial, sans-serif",
      radiusPx: 2,
    });
  });

  it("reads a dark docs site", () => {
    expect(readPageTheme(page(DOCS))).toEqual({
      scheme: "dark",
      bg: "rgb(13, 17, 23)",
      fg: "rgb(230, 237, 243)",
      link: "rgb(47, 129, 247)",
      fontBody: "-apple-system, \"Segoe UI\", Helvetica, Arial, sans-serif",
      fontDisplay: "-apple-system, \"Segoe UI\", Helvetica, Arial, sans-serif",
      radiusPx: 6,
    });
  });

  it("leaves the background out when it is an image", () => {
    const seed = readPageTheme(page(HERO));
    expect(seed.bg).toBeUndefined();
    expect(seed.fg).toBe("rgb(255, 255, 255)");
    expect(seed.link).toBe("rgb(255, 215, 0)");
    expect(seed.radiusPx).toBe(999); // clamped later, by deriveTheme
  });

  it("reads a webfont stack, walks past a translucent overlay and skips a translucent link", () => {
    expect(readPageTheme(page(WEBFONT))).toEqual({
      bg: "rgb(245, 240, 230)",
      fg: "rgb(43, 43, 43)",
      fontBody: "\"Source Serif 4\", \"Source Serif Pro\", Georgia, serif",
      fontDisplay: "Inter, \"Inter var\", system-ui, sans-serif",
    });
  });

  it("assumes the white canvas when nothing is set", () => {
    expect(readPageTheme(page(PLAIN)).bg).toBe("rgb(255, 255, 255)");
  });

  it("never touches a typed value or the text of the page", () => {
    const seed = JSON.stringify(readPageTheme(page(NEWS)));
    expect(seed).not.toContain("secret-typed-value");
    expect(seed).not.toContain("tram");
    const src = readFileSync(resolve(process.cwd(), "src/pageTheme.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\.value\b|textContent|innerText|innerHTML|outerHTML|\.data\b|selectedIndex|\.checked\b/);
  });
});
