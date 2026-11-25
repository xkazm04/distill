// verifyQuotes: is a guide's official quote word for word in the instructions as published? (guides:review, drift)
import { describe, expect, it } from "vitest";
import { verifyQuotes, QUOTE_CONTEXT_MAX } from "../src/index.js";

const QUOTE = "Spolu s oznámením předložte doklad, který změnu prokazuje (originál nebo úředně ověřenou kopii).";
const blocks = [
  { id: "b0", text: "Oznámení změn" },
  { id: "b1", text: `Formulář vyplňte čitelně. ${QUOTE} Oznámení podejte na pracovišti.` },
  { id: "b2", text: "The form must be filled in legibly, in block capitals and in Latin characters." },
];

describe("verifyQuotes", () => {
  it("finds a quote word for word and gives its block and paragraph", () => {
    const [v] = verifyQuotes(blocks, [QUOTE]);
    expect(v).toEqual({ verdict: "found", blockId: "b1", sentence: QUOTE, context: blocks[1]!.text });
  });

  it("a paraphrase is not found, nor a quote with one word changed", () => {
    expect(verifyQuotes(blocks, [
      "Spolu s oznámením předložte doklad prokazující změnu (originál nebo ověřenou kopii).",
      "The form must be filled in neatly, in block capitals and in Latin characters.",
    ])).toEqual([{ verdict: "not_found" }, { verdict: "not_found" }]);
  });

  it("the same words with other dashes, quotes and spacing are found, and the source's own spelling is kept", () => {
    const src = [{ id: "p1", text: "Lhůta – 30 dnů – běží ode dne „změny“.  Pak  už  ne." }];
    const [v] = verifyQuotes(src, ['Lhůta - 30 dnů — běží ode dne "změny". Pak už ne.']);
    expect(v).toMatchObject({ verdict: "found", blockId: "p1", sentence: "Lhůta – 30 dnů – běží ode dne „změny“.  Pak  už  ne." });
  });

  it("a sentence split across two neighbouring blocks is found, naming both", () => {
    const split = [
      { id: "b0", text: "Úvod." },
      { id: "b1", text: "Spolu s oznámením předložte doklad, který změnu" },
      { id: "b2", text: "prokazuje (originál nebo úředně ověřenou kopii). Další text." },
    ];
    const [v] = verifyQuotes(split, [QUOTE]);
    expect(v).toMatchObject({ verdict: "found", blockId: "b1", nextBlockId: "b2", sentence: QUOTE });
    // Two blocks that are not neighbours do not make a sentence.
    expect(verifyQuotes([split[1]!, { id: "x", text: "Mezi nimi." }, split[2]!], [QUOTE])).toEqual([{ verdict: "not_found" }]);
  });

  it("a source that could not be read, or holds no text, is unreadable and never found", () => {
    expect(verifyQuotes(null, [QUOTE, "anything at all here"])).toEqual([{ verdict: "unreadable" }, { verdict: "unreadable" }]);
    expect(verifyQuotes([], [QUOTE])).toEqual([{ verdict: "unreadable" }]);
    expect(verifyQuotes([{ id: "b0", text: "   " }], [QUOTE])).toEqual([{ verdict: "unreadable" }]);
  });

  it("a long paragraph is shortened around the quote", () => {
    const long = [{ id: "b0", text: `${"a ".repeat(800)}${QUOTE} ${"b ".repeat(800)}` }];
    const [v] = verifyQuotes(long, [QUOTE]);
    expect(v?.verdict).toBe("found");
    if (v?.verdict !== "found") return;
    expect(v.context).toContain(QUOTE);
    expect(v.context.length).toBeLessThanOrEqual(QUOTE_CONTEXT_MAX + 6);
    expect(v.context.startsWith("...") && v.context.endsWith("...")).toBe(true);
  });
});
