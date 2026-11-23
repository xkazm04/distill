import { describe, expect, it } from "vitest";
import { bylineLine, readByline } from "../src/index.js";
import { ago, datesIn, dayOf, isoOf } from "../src/byline.js";
import { parse } from "./helpers.js";

const page = (head: string, body = "<p>Text.</p>") => parse(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
const ld = (json: unknown) => `<script type="application/ld+json">${JSON.stringify(json)}</script>`;
const NOW = new Date(2026, 10, 23, 12, 0);

describe("readByline: structured data", () => {
  it("reads a NewsArticle: dates as stated, author and publisher names", () => {
    const b = readByline(page(ld({
      "@context": "https://schema.org", "@type": "NewsArticle", headline: "X",
      datePublished: "2023-03-15T10:30:00+01:00", dateModified: "2026-11-22T08:00:00+01:00",
      author: { "@type": "Person", name: "Jan Novák", url: "https://example.cz/autor/jan" },
      publisher: { "@type": "Organization", name: "Deník.cz", logo: { url: "https://x/logo.png" } },
    })));
    expect(b).toEqual({ from: "data", published: "2023-03-15T10:30:00+01:00", updated: "2026-11-22T08:00:00+01:00", author: "Jan Novák", publisher: "Deník.cz" });
  });

  it("reads an @graph and an array of authors, and prefers the article over the WebPage", () => {
    const b = readByline(page(ld({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Aktuálně.cz" },
        { "@type": "WebPage", datePublished: "2020-01-01", dateModified: "2026-01-01" },
        { "@type": ["Article", "NewsArticle"], datePublished: "2024-03-15", author: [{ "@type": "Person", name: "Eva Malá" }, { name: "Petr Dvořák" }, "Eva Malá"] },
      ],
    })));
    expect(b.published).toBe("2024-03-15");
    expect(b.updated).toBe("2026-01-01"); // the article states none; the page's own is the next best
    expect(b.author).toBe("Eva Malá, Petr Dvořák");
    expect(b.publisher).toBe("Aktuálně.cz");
    expect(b.from).toBe("data");
  });

  it("reads JSON-LD given as an array of objects, and skips broken JSON", () => {
    const b = readByline(page(`<script type="application/ld+json">{ broken</script>${ld([{ "@type": "BreadcrumbList" }, { "@type": "BlogPosting", datePublished: "2025-05-01", author: "https://x.example/me" }])}`));
    expect(b).toEqual({ from: "data", published: "2025-05-01" }); // a link is no author's name
  });

  it("reads schema.org microdata", () => {
    const b = readByline(page("", `<article itemscope itemtype="https://schema.org/Article"><h1 itemprop="headline">X</h1>
      <span itemprop="author" itemscope><span itemprop="name">Karel Čapek</span></span>
      <time itemprop="datePublished" datetime="2022-06-01">1. června 2022</time></article>`));
    expect(b).toMatchObject({ from: "data", published: "2022-06-01", author: "Karel Čapek" });
  });
});

describe("readByline: meta tags", () => {
  it("reads article:published_time, article:modified_time, og:site_name and author", () => {
    const b = readByline(page(`<meta property="article:published_time" content="2021-09-10T07:00:00Z">
      <meta property="article:modified_time" content="2021-09-12T09:00:00Z">
      <meta property="og:site_name" content="Example News"><meta name="author" content="Jana Nová">`));
    expect(b).toEqual({ from: "meta", published: "2021-09-10T07:00:00Z", updated: "2021-09-12T09:00:00Z", author: "Jana Nová", publisher: "Example News" });
  });

  it("structured data wins over meta tags; meta fills what the data leaves out", () => {
    const b = readByline(page(`<meta property="article:published_time" content="2019-01-01"><meta property="og:site_name" content="Site">${ld({ "@type": "Article", datePublished: "2024-02-02" })}`));
    expect(b).toEqual({ from: "data", published: "2024-02-02", publisher: "Site" });
  });

  it("drops an update before the published date, and an update that is the same moment", () => {
    expect(readByline(page(`<meta property="article:published_time" content="2024-05-05"><meta property="article:modified_time" content="2024-01-01">`)).updated).toBeUndefined();
    expect(readByline(page(`<meta property="article:published_time" content="2024-05-05T10:00"><meta property="article:modified_time" content="2024-05-05T10:00">`)).updated).toBeUndefined();
  });
});

describe("readByline: the visible byline", () => {
  it("reads Czech dates next to Publikováno and Aktualizováno", () => {
    const b = readByline(page("", `<article><h1>Příspěvek na bydlení</h1>
      <p class="meta">Autor: Jan Novák | Publikováno: 15. března 2024 | Aktualizováno 2. 4. 2024 10:30</p><p>Text článku.</p></article>`));
    expect(b).toEqual({ from: "text", published: "2024-03-15", updated: "2024-04-02T10:30", author: "Jan Novák" });
  });

  it("reads '15. 3. 2024 10:30' under the headline as the published date when it has no label", () => {
    const b = readByline(page("", `<article><h1>Daně</h1><div class="byline">Petr Malý</div><div>15. 3. 2024 10:30</div><p>Text.</p></article>`));
    expect(b).toMatchObject({ from: "text", published: "2024-03-15T10:30" });
  });

  it("reads <time datetime> and tells an updated one by its label", () => {
    const b = readByline(page("", `<article><h1>X</h1><p>Posted <time datetime="2023-01-10">Jan 10</time>, updated <time datetime="2023-02-20">Feb 20</time></p></article>`));
    expect(b).toMatchObject({ from: "text", published: "2023-01-10", updated: "2023-02-20" });
  });

  it("reads English dates: 'Published March 15, 2024' and 'Last updated 2 May 2024'", () => {
    const b = readByline(page("", `<main><h1>X</h1><p>Published March 15, 2024</p><p>Text.</p><p>Last updated 2 May 2024</p></main>`));
    expect(b).toMatchObject({ from: "text", published: "2024-03-15", updated: "2024-05-02" });
  });

  it("a village page's 'Poslední aktualizace' is an update; nothing else is guessed", () => {
    const b = readByline(page("", `<div id="obsah"><p>Hlášení závad</p><p>Poslední aktualizace: 1. 2. 2020</p></div>`));
    expect(b).toEqual({ from: "text", updated: "2020-02-01" });
  });

  it("a page with nothing says from: none, and never takes a typed value", () => {
    expect(readByline(page("", `<form><input value="15. 3. 2024"><textarea>Publikováno 1. 1. 2024</textarea></form><p>Bez data.</p>`))).toEqual({ from: "none" });
  });
});

describe("bylineLine", () => {
  it("speaks only when the two dates differ by more than a week", () => {
    expect(bylineLine({ from: "data", published: "2023-11-01", updated: "2026-11-22T08:00:00+01:00" }, NOW)).toBe("Published 3 years ago, updated yesterday");
    expect(bylineLine({ from: "data", published: "2026-11-10", updated: "2026-11-16" }, NOW)).toBeNull();
    expect(bylineLine({ from: "data", published: "2026-11-10" }, NOW)).toBeNull();
    expect(bylineLine({ from: "none" }, NOW)).toBeNull();
    expect(bylineLine({ from: "meta", published: "2026-09-01", updated: "2026-11-23T06:00Z" }, NOW)).toBe("Published 2 months ago, updated today");
  });

  it("ago: days, weeks, months, years", () => {
    const d = (s: string) => dayOf(s) as number;
    expect(ago(d("2026-11-18"), NOW)).toBe("5 days ago");
    expect(ago(d("2026-11-02"), NOW)).toBe("3 weeks ago");
    expect(ago(d("2026-07-23"), NOW)).toBe("4 months ago");
    expect(ago(d("2025-10-01"), NOW)).toBe("a year ago");
    expect(ago(d("2023-11-24"), NOW)).toBe("2 years ago");
  });
});

describe("dates", () => {
  it("reads the Czech and English forms, and refuses impossible ones", () => {
    expect(datesIn("do 15. března 2024 a 1.4.2024 nebo 2024-05-06").map((x) => x.iso)).toEqual(["2024-03-15", "2024-04-01", "2024-05-06"]);
    expect(datesIn("15. brezna 2024").map((x) => x.iso)).toEqual(["2024-03-15"]);
    expect(datesIn("31. 2. 2024, 15. 3. 1850").map((x) => x.iso)).toEqual([]);
    expect(isoOf("2024-03-15T10:30:00+01:00")).toBe("2024-03-15T10:30:00+01:00");
    expect(isoOf("2024-13-01")).toBeUndefined();
    expect(isoOf("15 March 2024")).toBe("2024-03-15");
  });
});
