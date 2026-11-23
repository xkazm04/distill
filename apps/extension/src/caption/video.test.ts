// r4-06, the page side: the main video, the description's lines, YouTube's whole description from the data the page was
// served with (only for the video in the address bar), seeking. Real players: e2e/caption-video-product.spec.ts and
// e2e/live/probes/video-product.live.ts.
import { afterEach, describe, expect, it } from "vitest";
import { descriptionText, mainVideo, readVideo, seek, servedDescription, textWithLines } from "./video";
import { readProductFacts, showProduct } from "./product";

const parse = (html: string, url = "https://example.test/video") => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  Object.defineProperty(doc, "location", { value: new URL(url) });
  return doc;
};

afterEach(() => { document.body.innerHTML = ""; });

describe("the description's lines", () => {
  it("<br> and blocks are new lines; textContent alone would join them", () => {
    const doc = parse(`<div id="d">0:00 Úvod<br>1:10 Těsto<p>2:00 Smažení</p><span>3:00 Konec</span></div>`);
    expect(textWithLines(doc.getElementById("d") as Element).split("\n").map((s) => s.trim()).filter(Boolean)).toEqual(["0:00 Úvod", "1:10 Těsto", "2:00 Smažení", "3:00 Konec"]);
  });
});

describe("readVideo", () => {
  it("chapters from #description, with the video's length and time; null without a video or without chapters", () => {
    const doc = parse(`<video id="v"></video><div id="description">0:00 Úvod\n1:00 Sponzor dílu\n2:00 Vaření</div>`);
    const v = doc.getElementById("v") as HTMLVideoElement;
    Object.defineProperty(v, "duration", { value: 300 });
    v.currentTime = 70;
    expect(readVideo(doc)).toEqual({ chapters: [{ start: 0, title: "Úvod" }, { start: 60, title: "Sponzor dílu", sponsor: true }, { start: 120, title: "Vaření" }], duration: 300, currentTime: 70 });
    expect(readVideo(parse(`<div id="description">0:00 A\n1:00 B</div>`))).toBeNull();
    expect(readVideo(parse(`<video></video><div id="description">Bez časů.</div>`))).toBeNull();
  });

  it("while the site plays its own advert, no time and no length are given (they are the advert's)", () => {
    const doc = parse(`<div id="movie_player" class="ad-showing"><video></video></div><div id="description">0:00 A\n1:00 B</div>`);
    const v = doc.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(v, "duration", { value: 15 });
    expect(readVideo(doc)).toEqual({ chapters: [{ start: 0, title: "A" }, { start: 60, title: "B" }] });
    expect(seek(doc, 60)).toBe(false);
  });

  it("the site's own player first; a video Clean hid is not the main one", () => {
    const doc = parse(`<div data-distill-hide="ad"><video id="ad"></video></div><div id="movie_player"><video id="main"></video></div>`);
    expect(mainVideo(doc)?.id).toBe("main");
  });
});

describe("YouTube's whole description", () => {
  const data = (id: string, text: string) => `<script>var ytInitialPlayerResponse = {"responseContext":{},"videoDetails":{"videoId":"${id}","title":"X","shortDescription":${JSON.stringify(text)}}};</script>`;
  it("is read from the served data for the video in the address bar, never for another one", () => {
    const full = "Recept.\n0:00 Úvod\n0:45 Reklama\n2:00 \"Vaření\"";
    const doc = parse(`${data("abcdefghijk", full)}<ytd-watch-metadata><div id="description">Recept. …více</div></ytd-watch-metadata>`, "https://www.youtube.com/watch?v=abcdefghijk");
    expect(servedDescription(doc)).toBe(full);
    expect(descriptionText(doc)).toBe(full);
    // After YouTube moved to another video without loading a page, the script is stale: the folded DOM text is used.
    const moved = parse(`${data("abcdefghijk", full)}<div id="description">Jiné video.</div>`, "https://www.youtube.com/watch?v=zzzzzzzzzzz");
    expect(servedDescription(moved)).toBe("");
    expect(descriptionText(moved)).toContain("Jiné video.");
  });
});

describe("seek", () => {
  it("sets the main video's time, within its length", () => {
    const doc = parse(`<video></video>`);
    const v = doc.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(v, "duration", { value: 100 });
    expect(seek(doc, 42)).toBe(true);
    expect(v.currentTime).toBe(42);
    expect(seek(doc, 500)).toBe(true);
    expect(v.currentTime).toBe(99.75);
    expect(seek(doc, Number.NaN)).toBe(false);
    expect(seek(parse("<p>no video</p>"), 1)).toBe(false);
  });
});

describe("product facts, the page side", () => {
  it("Show me finds the place a fact was read; a data fact and a fact Clean hid have none", () => {
    document.body.innerHTML = `<script type="application/ld+json">{"@type":"Product","name":"Hrnek","offers":{"@type":"Offer","price":149,"priceCurrency":"CZK","availability":"InStock"}}</script>
      <h1>Hrnek</h1><p id="w">Záruka: 2 roky</p><div data-distill-hide="ad" id="hid"><p>Doprava: 59 Kč</p></div>`;
    const facts = readProductFacts(document);
    expect(facts?.facts.map((f) => [f.id, f.kind, f.from])).toEqual([["p0", "price", "data"], ["p1", "stock", "data"], ["p2", "warranty", "page"]]);
    expect(showProduct(document, "p0")).toBe(false);
    expect(showProduct(document, "p2")).toBe(true);
    expect(showProduct(document, "p9")).toBe(false);
  });
});
