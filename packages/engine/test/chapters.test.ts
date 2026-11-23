// r4-06: video chapters and sponsor parts from a description. The two YouTube fixtures are the whole descriptions of the
// cooking videos of the live run (e2e/live/sites.json), as the watch pages served them on 2026-11-23: neither lists
// times, so neither has chapters (the honest answer). The chaptered shapes below are the ways real descriptions write
// them, Czech and English, with and without hours.
import { describe, expect, it } from "vitest";
import { chapterAt, chapterEnd, chapterTime, isSponsor, readChapters } from "../src/index.js";
import pohlreich from "./fixtures/youtube-pohlreich.txt?raw";
import kubicek from "./fixtures/youtube-kubicek.txt?raw";
// youtube-chapters.txt: the description of a Linus Tech Tips video (live probe, 2026-11-23), whose chapters list is real.
import techVideo from "./fixtures/youtube-chapters.txt?raw";

describe("readChapters: the live run's two cooking videos", () => {
  it("Pohlreich's potato pancakes: a recipe with numbered steps, no times, no chapters", () => {
    expect(readChapters(pohlreich)).toEqual([]);
    expect(readChapters(pohlreich, 542)).toEqual([]);
  });
  it("Kubíček's goulash: ingredients and links, no times, no chapters", () => {
    expect(readChapters(kubicek, 788)).toEqual([]);
  });
  it("the folded watch page's text: the channel's other videos' lengths are not chapters", () => {
    // As caption/video.ts read ytd-watch-metadata #description on the collapsed page (trimmed): the "Videa" shelf lists
    // other videos with their lengths, the first well past the start.
    const folded = "270 tis. zhlédnutí  před 4 r.\n\nGuláš je původně maďarský pokrm …více\n\nVidea\n\n9:52\n    9:52\nVýtečná HOVĚZÍ ROŠTĚNÁ\n8:02\n    8:02\nNaprosto nejlepší BUŘTGULÁŠ\n9:55\n10:04\n6:50\n";
    expect(readChapters(folded, 788)).toEqual([]);
  });
});

describe("readChapters: a real chaptered description", () => {
  it("the live probe's English tech video (CHAPTERS under a rule of dashes, after links and a promo code that is no chapter): 10 chapters, none a sponsor", () => {
    const ch = readChapters(techVideo);
    expect(ch.map((c) => c.start)).toEqual([0, 89, 333, 467, 571, 678, 728, 823, 862, 987]);
    expect(ch[1]?.title).toBe("DLSS 5 and FrameGen ON");
    expect(ch.some((c) => c.sponsor)).toBe(false);
    expect(ch[0]?.start).toBe(0);
    for (let i = 1; i < ch.length; i++) expect((ch[i] as { start: number }).start).toBeGreaterThan((ch[i - 1] as { start: number }).start);
    for (const c of ch) expect(c.title.length).toBeGreaterThan(0);
  });
});

describe("readChapters: shapes", () => {
  it("Czech, minutes only, with a sponsor part", () => {
    const d = "Dnes bramboráky!\n0:00 Úvod\n0:40 Suroviny\n2:10 Reklama – sponzor dílu: nože Ostrý\n3:05 Těsto\n5:30 Smažení\n7:45 Servírování\n\nVe 3:40 přidáváme mouku.";
    expect(readChapters(d, 540)).toEqual([
      { start: 0, title: "Úvod" },
      { start: 40, title: "Suroviny" },
      { start: 130, title: "Reklama – sponzor dílu: nože Ostrý", sponsor: true },
      { start: 185, title: "Těsto" },
      { start: 330, title: "Smažení" },
      { start: 465, title: "Servírování" },
    ]);
  });

  it("with hours, separators and brackets: 1:02:30 is 3750 s", () => {
    const d = "KAPITOLY\n(0:00) Začátek\n▶ 12:40 - Omáčka\n• 45:05 | Knedlíky\n1:02:30 Závěr";
    expect(readChapters(d).map((c) => [c.start, c.title])).toEqual([[0, "Začátek"], [760, "Omáčka"], [2705, "Knedlíky"], [3750, "Závěr"]]);
  });

  it("English, with the time at the end of the line, and 'Sponsored by' and 'Ad' as sponsors", () => {
    const d = "Intro - 0:00\nSponsored by Acme VPN - 1:15\nThe build - 2:30\nAd break: 9:00\nResults - 10:20";
    const ch = readChapters(d);
    expect(ch.map((c) => [c.start, c.title, !!c.sponsor])).toEqual([
      [0, "Intro", false], [75, "Sponsored by Acme VPN", true], [150, "The build", false], [540, "Ad break", true], [620, "Results", false],
    ]);
  });

  it("emoji and a leading zero hour: '00:00', '🔪 01:20'", () => {
    expect(readChapters("00:00 Start\n🔪 01:20 Krájení\n🍲 03:00 Vaření").map((c) => c.start)).toEqual([0, 80, 180]);
  });

  it("starting near 0:00 counts (a few seconds in); a list starting at 4:00 is not chapters", () => {
    expect(readChapters("0:05 Úvod\n1:00 Dál").length).toBe(2);
    expect(readChapters("4:00 Něco\n5:00 Dál")).toEqual([]);
  });

  it("one time is not a list; a time that goes back is skipped, not the end", () => {
    expect(readChapters("0:00 Jediný řádek")).toEqual([]);
    expect(readChapters("0:00 A\n2:00 B\n1:00 Překlep\n3:00 C").map((c) => c.title)).toEqual(["A", "B", "C"]);
  });

  it("times inside sentences are not chapters", () => {
    expect(readChapters("V 0:30 osolíme a ve 2:15 přidáme cibuli.\nAt 1:00 we start, at 3:00 we stop.")).toEqual([]);
  });

  it("duration drops times past the end", () => {
    expect(readChapters("0:00 A\n1:00 B\n9:00 C", 300).map((c) => c.title)).toEqual(["A", "B"]);
  });

  it("a time with nothing after it gets a plain name", () => {
    expect(readChapters("0:00\n1:00 Druhá").map((c) => c.title)).toEqual(["Part 1", "Druhá"]);
  });

  it("sponsor words, whole words only, Czech and English", () => {
    for (const t of ["Sponzor", "sponzorovaná část", "Reklama", "Spolupráce s Lidl", "Sponsored by X", "Our sponsor", "Ad", "Ads", "Paid promotion", "Promo kód"]) expect(isSponsor(t), t).toBe(true);
    for (const t of ["Adventura", "Hladká mouka", "Úvod", "Reklamace zboží", "Salad", "Downloads"]) expect(isSponsor(t), t).toBe(false);
  });
});

describe("chapter helpers", () => {
  const ch = readChapters("0:00 A\n1:00 B\n2:00 C");
  it("chapterAt and chapterEnd", () => {
    expect(chapterAt(ch, 0)).toBe(0);
    expect(chapterAt(ch, 61)).toBe(1);
    expect(chapterAt(ch, 500)).toBe(2);
    expect(chapterEnd(ch, 1)).toBe(120);
    expect(chapterEnd(ch, 2, 300)).toBe(300);
    expect(chapterEnd(ch, 2)).toBe(Infinity);
  });
  it("chapterTime", () => {
    expect(chapterTime(0)).toBe("0:00");
    expect(chapterTime(195)).toBe("3:15");
    expect(chapterTime(3750)).toBe("1:02:30");
  });
});
