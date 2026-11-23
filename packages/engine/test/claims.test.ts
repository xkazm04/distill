import { describe, expect, it } from "vitest";
import { claimWhy, findClaimCandidates, findSentence, GIST_POINTS, MAX_CLAIMS, parseClaims, parseGist, prompts, route, schemas, splitSentences, type Claim, type TranslateBlock } from "../src/index.js";

const CZ: TranslateBlock[] = [
  { id: "t0", text: "Inflace v říjnu zpomalila na 2,8 procenta, uvedl ve čtvrtek Český statistický úřad." },
  { id: "t1", text: "Podle ČSÚ za to mohou hlavně levnější potraviny a pohonné hmoty. Ceny elektřiny ale dál rostou." },
  { id: "t2", text: "„Očekáváme, že se inflace do konce roku udrží pod třemi procenty,“ řekl hlavní ekonom banky Jan Novák." },
  { id: "t3", text: "Zákon o podpoře bydlení začne platit od 1. ledna 2026 a týká se zhruba 200 tisíc domácností." },
  { id: "t4", text: "Studie Univerzity Karlovy ukázala, že kvůli drahým energiím šetří na topení každá třetí rodina." },
  { id: "t5", text: "Co to znamená pro vás? Přečtěte si více." },
  { id: "t6", text: "Tel.: 549 211 296, e-mail: info@obec.cz" },
  { id: "t7", text: "Krásný podzimní den." },
];

const EN: TranslateBlock[] = [
  { id: "t0", text: "Unemployment fell to 3.9% in October, according to the Bureau of Labor Statistics." },
  { id: "t1", text: "A new study published in Nature found that the ice sheet lost 270 billion tonnes a year. The authors were cautious." },
  { id: "t2", text: "\"We have never seen anything like this before,\" said Dr. Maria Lopez, who led the research team." },
  { id: "t3", text: "The bridge closed on March 3 because of cracks found during a routine inspection by engineers." },
  { id: "t4", text: "What does this mean for your family? Read on to find out more." },
  { id: "t5", text: "Share this article with your friends and family today." },
];

describe("splitSentences", () => {
  it("cuts at the end of a sentence but not after an abbreviation, an initial, a day or an ordinal", () => {
    expect(splitSentences("Platí od 1. ledna 2026. Týká se např. Prahy a Brna. Řekl to J. Novák.")).toEqual([
      "Platí od 1. ledna 2026.", "Týká se např. Prahy a Brna.", "Řekl to J. Novák.",
    ]);
    expect(splitSentences("Dne 25. 11. 2026 vláda schválila rozpočet. Opozice protestovala!")).toEqual([
      "Dne 25. 11. 2026 vláda schválila rozpočet.", "Opozice protestovala!",
    ]);
    expect(splitSentences("Prices rose, e.g. for bread. Mr. Smith agreed.")).toEqual(["Prices rose, e.g. for bread.", "Mr. Smith agreed."]);
  });
  it("keeps every sentence exactly as the text has it, closing quotes included", () => {
    const text = "„Je to rekord,“ řekl. Další věta je tady.";
    for (const s of splitSentences(text)) expect(text).toContain(s);
    expect(splitSentences(text)[0]).toBe("„Je to rekord,“ řekl.");
  });
});

describe("findClaimCandidates (Czech)", () => {
  const found = findClaimCandidates(CZ);
  const by = (blockId: string) => found.filter((c) => c.blockId === blockId);
  it("finds numbers, sources, quotes, dates and causes", () => {
    expect(by("t0")[0]?.why).toBe("source"); // "uvedl ... úřad": who said it
    expect(by("t1").map((c) => c.why)).toEqual(["source"]);
    expect(by("t2")[0]?.why).toBe("quote");
    expect(by("t3")[0]?.why).toBe("number"); // 200 tisíc: a number with a unit comes before the date
    expect(by("t4")[0]?.why).toBe("source");
  });
  it("leaves out questions, pointers, contact lines, short sentences and plain descriptions", () => {
    expect(by("t5")).toEqual([]);
    expect(by("t6")).toEqual([]);
    expect(by("t7")).toEqual([]);
    expect(found.some((c) => c.text.startsWith("Ceny elektřiny"))).toBe(false); // short, nothing checkable
  });
  it("gives ids c0, c1, ... in document order, each sentence as it is in its block", () => {
    expect(found.map((c) => c.id)).toEqual(found.map((_, i) => `c${i}`));
    for (const c of found) expect(CZ.find((b) => b.id === c.blockId)?.text).toContain(c.text);
  });
  it("stops at max", () => {
    expect(findClaimCandidates(CZ, 2)).toHaveLength(2);
  });
});

describe("findClaimCandidates (English)", () => {
  const found = findClaimCandidates(EN);
  it("finds the checkable sentences", () => {
    expect(found.map((c) => [c.blockId, c.why])).toEqual([
      ["t0", "source"], ["t1", "source"], ["t2", "quote"], ["t3", "date"],
    ]);
  });
  it("skips the short second sentence, the question and the share line", () => {
    expect(found.some((c) => c.text === "The authors were cautious.")).toBe(false);
    expect(found.some((c) => c.blockId === "t4" || c.blockId === "t5")).toBe(false);
  });
  it("leaves out a headline (no full stop) and a picture's credit", () => {
    expect(claimWhy("Příspěvek na bydlení 2024: Jak podat žádost, kdo na něj má nárok, jaká je výše")).toBeNull();
    expect(claimWhy("Ilustrační foto | Foto: ČTK / Švancara Petr, pořízeno v Praze 12. března 2024.")).toBeNull();
    expect(claimWhy("Photo: Reuters, taken at the summit in Brussels on 12 March 2024.")).toBeNull();
    expect(claimWhy("„Je to rekord, jaký jsme tu ještě nezažili ani v roce 2002,“")).toBe("quote"); // ends with a closing quote
  });
  it("reads a cause on its own", () => {
    expect(claimWhy("The flights were cancelled because of a strike by the air traffic controllers union.")).toBe("cause");
    expect(claimWhy("Lety byly zrušeny kvůli stávce řídících letového provozu na celém letišti.")).toBe("cause");
  });
  it("sees Czech words with diacritics at their start (a Unicode word boundary)", () => {
    expect(claimWhy("Ministr na tiskové konferenci řekl, že vláda návrh znovu projedná.")).toBe("source");
  });
});

const CANDIDATES: Claim[] = [
  { id: "c0", blockId: "t0", text: "A", why: "number" },
  { id: "c1", blockId: "t1", text: "B", why: "source" },
  { id: "c2", blockId: "t2", text: "C", why: "quote" },
];

describe("parseClaims (the door for findClaims)", () => {
  it("keeps candidates by id, in document order, with the model's reason from the closed set", () => {
    const r = parseClaims({ claims: [{ id: "c2", why: "quote" }, { id: "c0", why: "date" }] }, CANDIDATES);
    expect(r).toEqual({ claims: [{ id: "c0", blockId: "t0", text: "A", why: "date" }, { id: "c2", blockId: "t2", text: "C", why: "quote" }], dropped: 0 });
  });
  it("drops an unknown id, a repeat, a reason outside the set, and a non-object; counts each", () => {
    const r = parseClaims({ claims: [{ id: "c9", why: "number" }, { id: "c1", why: "source" }, { id: "c1", why: "source" }, { id: "c0", why: "opinion" }, "c2", { id: "c2" }] }, CANDIDATES);
    expect(r.claims.map((c) => c.id)).toEqual(["c1"]);
    expect(r.dropped).toBe(5);
  });
  it("never takes text from the model", () => {
    const r = parseClaims({ claims: [{ id: "c0", why: "number", text: "<b>made up</b>" }] }, CANDIDATES);
    expect(r.claims[0]?.text).toBe("A");
  });
  it("reads a bare list; anything else is nothing (counted once)", () => {
    expect(parseClaims([{ id: "c1", why: "source" }], CANDIDATES).claims).toHaveLength(1);
    expect(parseClaims("c1", CANDIDATES)).toEqual({ claims: [], dropped: 1 });
    expect(parseClaims(null, CANDIDATES)).toEqual({ claims: [], dropped: 0 });
  });
  it("keeps at most MAX_CLAIMS", () => {
    const many: Claim[] = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, blockId: "t0", text: String(i), why: "number" }));
    const r = parseClaims({ claims: many.map((c) => ({ id: c.id, why: "number" })) }, many);
    expect(r.claims).toHaveLength(MAX_CLAIMS);
    expect(r.dropped).toBe(20 - MAX_CLAIMS);
  });
});

const ARTICLE: TranslateBlock[] = [
  { id: "t0", text: "Inflace v říjnu zpomalila na 2,8 procenta. Statistici to oznámili ve čtvrtek." },
  { id: "t1", text: "„Očekáváme pokles,“ řekl ekonom  Jan Novák – a dodal, že sazby se nezmění." },
  { id: "t2", text: "Vláda chce schodek snížit o 50 miliard korun." },
];

describe("findSentence", () => {
  it("finds a sentence with other quotes, dashes and spaces, and gives the page's own words", () => {
    expect(findSentence(ARTICLE[1]!.text, "\"Očekáváme pokles,\" řekl ekonom Jan Novák - a dodal, že sazby se nezmění."))
      .toBe("„Očekáváme pokles,“ řekl ekonom  Jan Novák – a dodal, že sazby se nezmění.");
  });
  it("finds nothing for different words or a scrap", () => {
    expect(findSentence(ARTICLE[0]!.text, "Inflace v říjnu zrychlila na 2,8 procenta.")).toBeNull();
    expect(findSentence(ARTICLE[0]!.text, "Inflace")).toBeNull();
  });
});

describe("parseGist (the door for gist)", () => {
  const point = (blockId: string, sentence: string, text = "A point.") => ({ text, blockId, sentence });
  it("keeps points whose sentence is in their block, with the page's sentence", () => {
    const r = parseGist({ points: [
      point("t0", "Inflace v říjnu zpomalila na 2,8 procenta.", "Inflation slowed to 2.8% in October."),
      point("t2", "Vláda chce schodek snížit o 50 miliard korun.", "The government wants a smaller deficit."),
    ] }, ARTICLE);
    expect(r.dropped).toBe(0);
    expect(r.points).toEqual([
      { text: "Inflation slowed to 2.8% in October.", blockId: "t0", sentence: "Inflace v říjnu zpomalila na 2,8 procenta." },
      { text: "The government wants a smaller deficit.", blockId: "t2", sentence: "Vláda chce schodek snížit o 50 miliard korun." },
    ]);
  });
  it("drops an unknown block, a made-up sentence, a sentence from another block, and HTML; counts each", () => {
    const r = parseGist({ points: [
      point("t9", "Inflace v říjnu zpomalila na 2,8 procenta."),
      point("t0", "Inflace v říjnu vyskočila na 9 procent."),
      point("t2", "Inflace v říjnu zpomalila na 2,8 procenta."),
      point("t0", "Inflace v říjnu zpomalila na 2,8 procenta.", "<b>Inflation</b> slowed"),
      point("t0", "Inflace v říjnu zpomalila na 2,8 procenta.", "&lt;img src=x onerror=alert(1)&gt;"),
      point("t0", "Statistici to oznámili ve čtvrtek.", "Statisticians said so on Thursday."),
    ] }, ARTICLE);
    expect(r.points.map((p) => p.sentence)).toEqual(["Statistici to oznámili ve čtvrtek."]);
    expect(r.dropped).toBe(5);
  });
  it("drops an empty, a missing or an over-long point", () => {
    const r = parseGist([
      point("t0", "Inflace v říjnu zpomalila na 2,8 procenta.", "  "),
      { blockId: "t0", sentence: "Inflace v říjnu zpomalila na 2,8 procenta." },
      point("t0", "Inflace v říjnu zpomalila na 2,8 procenta.", "x".repeat(300)),
    ], ARTICLE);
    expect(r).toEqual({ points: [], dropped: 3 });
  });
  it("keeps at most GIST_POINTS", () => {
    const s = "Inflace v říjnu zpomalila na 2,8 procenta.";
    const r = parseGist({ points: Array.from({ length: 5 }, () => point("t0", s)) }, ARTICLE);
    expect(r.points).toHaveLength(GIST_POINTS);
    expect(r.dropped).toBe(5 - GIST_POINTS);
  });
  it("reads nothing from a shape it does not know", () => {
    expect(parseGist("three points", ARTICLE)).toEqual({ points: [], dropped: 1 });
    expect(parseGist(undefined, ARTICLE)).toEqual({ points: [], dropped: 0 });
  });
});

describe("findClaims and gist: page tasks, on device first", () => {
  it("route as page class with the contract's schemas", () => {
    expect(route("findClaims").promptClass).toBe("page");
    expect(route("gist").promptClass).toBe("page");
    expect(schemas.claims).toBeTruthy();
    expect(schemas.gist).toBeTruthy();
  });
  it("prompts carry the candidates and blocks by id", () => {
    expect(prompts.findClaims([{ id: "c0", text: "Inflace zpomalila na 2,8 %." }])).toContain("[c0] Inflace zpomalila na 2,8 %.");
    expect(prompts.gist(ARTICLE, "en")).toContain("[t2] Vláda chce");
  });
});
