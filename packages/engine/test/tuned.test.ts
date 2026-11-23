// r4-03: the claims and the gist tuned from the real run of 2026-11-23 on the saved Deník page (gemini-3.5-flash-lite
// through Firebase AI Logic; the proof page's report, .spark/Spark/evidence/r4/r4-03-before.json). Each test is built
// from an answer that went wrong. Plain words' tests from the same run are in plain.test.ts.
import { describe, expect, it } from "vitest";
import { findClaimCandidates, parseClaims, prompts, quoteEnds, topClaims, wholeQuotes, type Claim, type TranslateBlock } from "../src/index.js";

const DENIK: TranslateBlock[] = [
  { id: "t2", text: "Požádat o příspěvek na bydlení není ostuda. Tvrdí to ministr práce a sociálních věcí Marian Jurečka (KDU-ČSL). „Nejvíce se zdražování dotkne jednočlenných a dvoučlenných domácností s nízkým příjmem, které vydají většinu peněz právě za bydlení a náklady s ním související. Typicky se jedná o samoživitele, osamělé seniory nebo lidi s handicapem,“ řekl nedávno ministr." },
  { id: "t3", text: "V podstatě s ním souhlasí i předseda Sdružení nájemníků Milan Taraba, který upozornil na to, že mnoho lidí o příspěvek nežádá, i když na něj mají nárok. „Považují to za jakousi žebračenku. Tím si ale zhoršují finanční situaci,“ podotkl Taraba." },
];

describe("claims tuned from the real run (r4-03)", () => {
  it("a quote over two sentences is one candidate with who said it, not its tail alone", () => {
    const found = findClaimCandidates(DENIK);
    const texts = found.map((c) => c.text);
    // The real answer kept the scrap "Typicky se jedná o samoživitele, ...,“ řekl nedávno ministr." as a claim.
    expect(texts).not.toContain("Typicky se jedná o samoživitele, osamělé seniory nebo lidi s handicapem,“ řekl nedávno ministr.");
    expect(texts).toContain("„Nejvíce se zdražování dotkne jednočlenných a dvoučlenných domácností s nízkým příjmem, které vydají většinu peněz právě za bydlení a náklady s ním související. Typicky se jedná o samoživitele, osamělé seniory nebo lidi s handicapem,“ řekl nedávno ministr.");
    expect(texts).toContain("„Považují to za jakousi žebračenku. Tím si ale zhoršují finanční situaci,“ podotkl Taraba.");
    // Each joined candidate is exactly in its block, so the page can find and mark it.
    for (const c of found) expect(DENIK.find((b) => b.id === c.blockId)?.text).toContain(c.text);
  });

  it("reads where a sentence's quotation marks open and close (Czech, English, straight)", () => {
    expect(quoteEnds("„Nejvíce se zdražování dotkne domácností.")).toEqual({ opens: true, closes: false });
    expect(quoteEnds("Typicky se jedná o samoživitele,“ řekl ministr.")).toEqual({ opens: false, closes: true });
    expect(quoteEnds("„Očekáváme pokles,“ řekl ekonom.")).toEqual({ opens: false, closes: false });
    expect(quoteEnds("He said: “It works.")).toEqual({ opens: true, closes: false });
    expect(quoteEnds("It is cheap,” he added.")).toEqual({ opens: false, closes: true });
    expect(quoteEnds("\"We won,\" she said.")).toEqual({ opens: false, closes: false });
    expect(wholeQuotes(["He said: “It works.", "It is cheap,” he added.", "Next."])).toEqual(["He said: “It works. It is cheap,” he added.", "Next."]);
    // Too long together: the tail stays as it is.
    expect(wholeQuotes([`„${"slovo ".repeat(80)}.`, "Konec,“ řekl."])).toHaveLength(2);
  });

  it("the prompt leaves out sentences that point back and worked examples, and puts the most important first", () => {
    const p = prompts.findClaims([{ id: "c0", text: "Tvrdí to ministr práce a sociálních věcí Marian Jurečka (KDU-ČSL)." }]);
    expect(p).toContain("must make sense on its own");
    expect(p).toContain("worked examples and sample calculations");
    expect(p).toContain("the most important first");
  });

  it("the automatic web check takes the model's top claims, not the first ones in the page", () => {
    const candidates: Claim[] = [
      { id: "c0", blockId: "t1", text: "Nárok na něj mají ti, jimž náklady na bydlení stojí víc než 30 procent čistých příjmů.", why: "number" },
      { id: "c1", blockId: "t2", text: "Tvrdí to ministr práce a sociálních věcí Marian Jurečka (KDU-ČSL).", why: "source" },
      { id: "c2", blockId: "t3", text: "V podstatě s ním souhlasí i předseda Sdružení nájemníků Milan Taraba.", why: "source" },
      { id: "c3", blockId: "t9", text: "Výši příspěvku lze zjistit v kalkulačce ministerstva práce a sociálních věcí.", why: "source" },
    ];
    const pick = parseClaims({ claims: [{ id: "c3", why: "source" }, { id: "c0", why: "number" }, { id: "c2", why: "source" }, { id: "c1", why: "quote" }] }, candidates);
    expect(pick.claims.map((c) => c.id)).toEqual(["c0", "c1", "c2", "c3"]); // shown in page order
    expect(topClaims(pick.claims, 3).map((c) => c.id)).toEqual(["c3", "c0", "c2"]);
    // Without a rank (an older answer): after the ranked ones, in page order.
    expect(topClaims([{ id: "a" }, { id: "b", rank: 0 }] as Claim[], 2).map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("gist tuned from the real run (r4-03)", () => {
  it("the prompt asks for a sentence that states the point itself, and no repeat of the headline", () => {
    const p = prompts.gist(DENIK, "en");
    expect(p).toContain("must itself state the point");
    expect(p).toContain("do not repeat the headline");
  });
});
