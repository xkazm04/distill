import { describe, expect, it } from "vitest";
import { keepsFacts, parsePlain, prompts, type TranslateBlock } from "../src/index.js";
import { compareWords, missingFacts, misspelled, notPlainer, numberValues } from "../src/plain.js";

const kinds = (src: string, rw: string) => missingFacts(src, rw).map((f) => f.kind);

describe("numberValues: one number however it is written", () => {
  it("reads Czech and English digit groups and decimals", () => {
    expect(numberValues("1 234,5")[0]).toEqual(["1234.5"]);
    expect(numberValues("1,234.5")).toEqual([["1234.5"]]);
    expect(numberValues("1.234,5")).toEqual([["1234.5"]]);
    expect(numberValues("12,50")).toEqual([["12.5"]]);
    expect(numberValues("007")).toEqual([["7"]]);
    expect(numberValues("1.234.567")).toEqual([["1234567"]]);
  });
  it("keeps both meanings of an ambiguous group", () => {
    expect(numberValues("1,234")).toEqual([["1234"], ["1.234"]]);
    expect(numberValues("1.500")).toEqual([["1500"], ["1.500"]]);
  });
});

describe("keepsFacts: Czech", () => {
  const src = "Žádost podejte do 15. března 2026 na úřadě v Benešově. Poplatek činí 1 234,50 Kč a sleva je 15 %.";

  it("passes a plain rewrite that keeps every fact", () => {
    expect(keepsFacts(src, "Podejte žádost do 15. 3. 2026. Kde? Na úřadě v Benešově. Zaplatíte 1234,50 Kč. Sleva je 15 procent.")).toBe(true);
    // The same date in other spellings, the amount with CZK, the name with another case ending.
    expect(keepsFacts(src, "Termín je 2026-03-15. Úřad: Benešov. Poplatek 1 234,5 CZK, sleva 15 %.")).toBe(true);
    expect(keepsFacts(src, "Do 15.3.2026 jděte na úřad v Benešově a zaplaťte 1234,5 Kč. Sleva: 15 %.")).toBe(true);
  });

  it("refuses a changed or dropped amount, date, percentage or name", () => {
    expect(kinds(src, "Podejte žádost do 15. 3. 2026 v Benešově. Poplatek je 1 243,50 Kč, sleva 15 %.")).toEqual(["amount"]);
    expect(kinds(src, "Podejte žádost do 15. 3. 2026 v Benešově. Poplatek je 1 234,50 €, sleva 15 %.")).toEqual(["amount"]);
    expect(kinds(src, "Podejte žádost do 16. 3. 2026 v Benešově. Poplatek je 1 234,50 Kč, sleva 15 %.")).toEqual(["date"]);
    expect(kinds(src, "Podejte žádost do 15. 3. 2025 v Benešově. Poplatek je 1 234,50 Kč, sleva 15 %.")).toEqual(["date"]);
    expect(kinds(src, "Podejte žádost v březnu v Benešově. Poplatek je 1 234,50 Kč, sleva 15 %.")).toEqual(["date"]);
    expect(kinds(src, "Podejte žádost do 15. 3. 2026 v Benešově. Poplatek je 1 234,50 Kč a dostanete slevu.")).toEqual(["number"]);
    expect(kinds(src, "Podejte žádost do 15. 3. 2026 na úřadě. Poplatek je 1 234,50 Kč, sleva 15 %.")).toEqual(["name"]);
    expect(kinds(src, "Poplatek je 1 234,50 Kč, sleva 15 %.")).toEqual(["date", "name"]);
  });

  it("does not count the first word of a sentence as a name", () => {
    expect(keepsFacts("Žádost podáte osobně. Formulář je na webu.", "Žádost podejte sami. Tiskopis najdete na internetu.")).toBe(true);
    expect(keepsFacts("„Poprvé se dostanete do nemocnice,“ uvedla starostka.", "Starostka řekla: do nemocnice se dostanete bez auta.")).toBe(true);
    expect(keepsFacts("Lhůta: Do pátku.", "Lhůta je do pátku.")).toBe(true);
  });

  it("keeps a name inside a sentence and an organisation's short name", () => {
    expect(kinds("Formulář vydává Finanční správa a ČSSZ.", "Formulář vydává úřad.")).toEqual(["name", "name"]);
    expect(keepsFacts("Formulář vydává Finanční správa a ČSSZ.", "Formulář dává Finanční správa. Také ČSSZ.")).toBe(true);
    expect(keepsFacts("Spoje jezdí do Nádraží Benešov.", "Autobus jede na nádraží v Benešově.")).toBe(true);
    // Too different an ending is no longer the same name.
    expect(keepsFacts("Úřad sídlí v Praze.", "Úřad je v Brně.")).toBe(false);
  });

  it("keeps times, phone numbers and plain numbers", () => {
    expect(keepsFacts("Linka 14 pojede každých 30 minut mezi 6:00 a 20:00.", "Linka 14 jezdí od 6:00 do 20:00. Jede každých 30 minut.")).toBe(true);
    expect(kinds("Linka 14 pojede každých 30 minut mezi 6:00 a 20:00.", "Linka 14 jezdí od 6:00 do 21:00 každých 30 minut.")).toEqual(["number"]);
    expect(kinds("Linka 14 pojede každých 30 minut.", "Linka jezdí každých 30 minut.")).toEqual(["number"]);
    expect(keepsFacts("Volejte na 549 211 296 ve všední dny.", "Zavolejte na číslo 549 211 296. Jen ve všední dny.")).toBe(true);
    expect(keepsFacts("Volejte na 549 211 296 ve všední dny.", "Zavolejte na 549211296.")).toBe(true);
    expect(keepsFacts("Volejte na 549 211 296.", "Zavolejte na 549 211 269.")).toBe(false);
  });

  it("keeps a date without a year, and lets the rewrite add one", () => {
    expect(keepsFacts("Připomínky posílejte do 15. ledna.", "Pošlete připomínky do 15. 1.")).toBe(true);
    expect(keepsFacts("Připomínky posílejte do 15. ledna.", "Pošlete připomínky do 15. 1. 2027.")).toBe(true);
    expect(keepsFacts("Připomínky posílejte do 15. ledna.", "Pošlete připomínky do 15. února.")).toBe(false);
  });

  it("keeps a link and an e-mail address", () => {
    expect(keepsFacts("Pište na podatelna@obec-lhota.cz nebo jděte na www.obec-lhota.cz.", "Napište na podatelna@obec-lhota.cz. Web: www.obec-lhota.cz.")).toBe(true);
    expect(kinds("Pište na podatelna@obec-lhota.cz.", "Napište nám e-mail.")).toEqual(["link"]);
  });
});

describe("keepsFacts: English", () => {
  const src = "Applicants must submit the form by March 15, 2026 to the Brno office, paying $1,234.50 and a fee of 2.5%.";

  it("passes a rewrite in other spellings", () => {
    expect(keepsFacts(src, "Send the form by 15 March 2026. Send it to the Brno office. Pay $1234.50. The fee is 2.5 percent.")).toBe(true);
    expect(keepsFacts(src, "Send the form by 2026-03-15 to the office in Brno. Pay USD 1,234.5 plus 2.5 %.")).toBe(true);
  });

  it("refuses a changed number, date, amount or name", () => {
    expect(kinds(src, "Send the form by March 15, 2026 to the Brno office. Pay $1,243.50 and 2.5%.")).toEqual(["amount"]);
    expect(kinds(src, "Send the form by March 16, 2026 to the Brno office. Pay $1,234.50 and 2.5%.")).toEqual(["date"]);
    expect(kinds(src, "Send the form by March 15, 2026 to the office. Pay $1,234.50 and 2.5%.")).toEqual(["name"]);
    expect(kinds(src, "Send the form by March 15, 2026 to the Brno office. Pay $1,234.50 and 25%.")).toEqual(["number"]);
  });

  it("is not fooled by sentence starts, months as words or 'I'", () => {
    expect(keepsFacts("The office is closed. Please call again tomorrow.", "The office is shut. Call tomorrow.")).toBe(true);
    expect(keepsFacts("We think I may come back in May 2026.", "I might return in May 2026.")).toBe(true);
    expect(keepsFacts("Payments in March are due on the 1st.", "Pay in March. It is due on the 1st.")).toBe(true);
  });

  it("reads thousands separators both ways", () => {
    expect(keepsFacts("There are 12,500 residents.", "12 500 people live here.")).toBe(true);
    expect(keepsFacts("There are 12,500 residents.", "12500 people live here.")).toBe(true);
    expect(keepsFacts("There are 12,500 residents.", "12.5 people live here.")).toBe(false);
    expect(keepsFacts("Inflation was 1.5 points.", "Prices rose by 1.5 points.")).toBe(true);
  });

  it("checks the source's facts, not the rewrite's: a rewrite may add a word in capitals", () => {
    expect(keepsFacts("Pay the fee by Friday.", "[PLAIN] Pay the fee. Do it by Friday.")).toBe(true);
    expect(keepsFacts("[EN] Pay 500 CZK by Friday.", "[PLAIN] [EN] Pay 500 CZK. Do it by Friday.")).toBe(true);
  });
});

describe("parsePlain (the one door for plain words)", () => {
  const SOURCE: TranslateBlock[] = [
    { id: "t0", text: "Žádost je nutno podat nejpozději do 15. března 2026, a to osobně na podatelně Městského úřadu Benešov." },
    { id: "t1", text: "Správní poplatek ve výši 500 Kč se hradí v hotovosti nebo převodem na účet obce." },
    { id: "t2", text: "Úřední hodiny jsou v pondělí a ve středu od 8:00 do 17:00." },
  ];

  it("keeps rewrites that keep the facts, in the source's order", () => {
    const r = parsePlain({ blocks: [
      { id: "t1", text: "Poplatek je 500 Kč. Zaplaťte ho v hotovosti nebo na účet obce." },
      { id: "t0", text: "Žádost podejte do 15. 3. 2026. Přineste ji osobně na podatelnu. Je to Městský úřad Benešov." },
    ] }, SOURCE);
    expect(r).toEqual({
      blocks: [
        { id: "t0", text: "Žádost podejte do 15. 3. 2026. Přineste ji osobně na podatelnu. Je to Městský úřad Benešov." },
        { id: "t1", text: "Poplatek je 500 Kč. Zaplaťte ho v hotovosti nebo na účet obce." },
      ],
      lostFacts: 0, lostKinds: [], lostIds: [], dropped: 0,
    });
  });

  it("refuses and counts a rewrite that lost a fact; its block stays as written", () => {
    const r = parsePlain({ blocks: [
      { id: "t0", text: "Žádost podejte do března na podatelnu Městského úřadu Benešov." },
      { id: "t1", text: "Poplatek je 50 Kč." },
      { id: "t2", text: "Úřad je otevřen v pondělí a ve středu od 8:00 do 17:00." },
    ] }, SOURCE);
    expect(r.blocks.map((b) => b.id)).toEqual(["t2"]);
    expect(r.lostFacts).toBe(2);
    expect(r.lostKinds).toEqual(["date", "amount"]);
    expect(r.lostIds).toEqual(["t0", "t1"]);
    expect(r.dropped).toBe(0);
  });

  it("passes the translation door first: unknown ids, repeats, HTML and far too long text", () => {
    const r = parsePlain({ blocks: [
      { id: "t9", text: "Neznámý blok." },
      { id: "t2", text: "<b>Úřad</b> je otevřen v pondělí a ve středu od 8:00 do 17:00." },
      { id: "t2", text: "Podruhé." },
      { id: "t1", text: "x".repeat(1000) },
      { id: "t0", text: 42 },
    ] }, SOURCE);
    expect(r.blocks).toEqual([{ id: "t2", text: "Úřad je otevřen v pondělí a ve středu od 8:00 do 17:00." }]);
    expect(r.dropped).toBe(4);
    expect(r.lostFacts).toBe(0);
  });

  it("answers nothing for an answer of the wrong shape", () => {
    expect(parsePlain(null, SOURCE)).toEqual({ blocks: [], lostFacts: 0, lostKinds: [], lostIds: [], dropped: 0 });
    expect(parsePlain("Sure!", SOURCE)).toEqual({ blocks: [], lostFacts: 0, lostKinds: [], lostIds: [], dropped: 1 });
  });

  // r4-03: the real run of 2026-11-23 on Deník (gemini-3.5-flash-lite, plain words in Czech) answered with near copies
  // that misspelled the page; the facts check passed all of them.
  const DENIK: TranslateBlock[] = [
    { id: "t1", text: "Řada lidí nechává peníze ležet na ulici. Jde například o příspěvek na bydlení, který může dosáhnout i několik tisíc korun. Nárok na něj mají ti, jimž náklady na bydlení stojí víc než 30 procent čistých příjmů. O příspěvek přitom nemusí žádat jen nájemník, ale třeba i majitel domu, OSVČ nebo lidé, kteří splácejí hypotéku." },
    { id: "t2", text: "Požádat o příspěvek na bydlení není ostuda. Tvrdí to ministr práce a sociálních věcí Marian Jurečka (KDU-ČSL). „Nejvíce se zdražování dotkne jednočlenných a dvoučlenných domácností s nízkým příjmem, které vydají většinu peněz právě za bydlení a náklady s ním související. Typicky se jedná o samoživitele, osamělé seniory nebo lidi s handicapem,“ řekl nedávno ministr." },
    { id: "t0", text: "Příspěvek na bydlení 2024: Jak podat žádost, kdo na něj má nárok, jaká je výše" },
  ];
  const REAL = { blocks: [
    { id: "t0", text: "Příspěvek na bydlení 2024: Jak podat žádost, kdo na něj má nárok, jaká je výše" },
    { id: "t1", text: "Řada lidí nechává peníze ležet na ulici. Jde například o příspěvek na bydlení, kter½ může dosáhnout i několik tísíc korun. Nárok na něj mávají ti, jimž náklady na bydlení stojí víc než 30 procent čistých příjmů. O příspěvek přitom nemusí žádat jen nájemník, ale třeba i majitel domu, OSVČ nebo lidí, kteří splácejí hypotéku." },
    { id: "t2", text: "Požádat o příspěvek na bydlení nensí ostuda. Tvrdí to ministr práce a sociálních věci Marian Jurečka (KDU-ČSL). Nejvíce se zdražování dotkne jednočlenných a dvoučlenných domácností s nízkým příjmem, které vydají většinu penězi právě za bydlení a náklady s ním související. Typicky se jedná o samoživitele, osamělé seniory nebo lidi s handicapem, řekl nedávno ministr." },
  ] };

  it("refuses a near copy that misspells the page, and one with a symbol the page does not have (the real Deník answer)", () => {
    expect(keepsFacts(DENIK[0]!.text, REAL.blocks[1]!.text)).toBe(true); // the facts door alone let it through
    expect(notPlainer(DENIK[0]!.text, REAL.blocks[1]!.text)).toBe("odd");
    expect(notPlainer(DENIK[1]!.text, REAL.blocks[2]!.text)).toBe("misspelled");
    const r = parsePlain(REAL, DENIK);
    expect(r.blocks).toEqual([]);
    expect(r.dropped).toBe(2); // the unchanged headline is left alone, not counted
    expect(r.lostFacts).toBe(0);
  });

  it("tells a misspelling from grammar: the start and the end stay, a letter or two inside changes", () => {
    expect(misspelled("tisíc", "tísíc")).toBe(true);
    expect(misspelled("mají", "mávají")).toBe(true);
    expect(misspelled("není", "nensí")).toBe(true);
    expect(misspelled("lidé", "lidí")).toBe(false); // another case ending
    expect(misspelled("peněz", "penězi")).toBe(false);
    expect(misspelled("benešov", "benešově")).toBe(false);
    expect(misspelled("poplatek", "platba")).toBe(false); // another word
    expect(compareWords("a b c d", "a b c d").similarity).toBe(1);
  });

  it("passes a near copy that swaps a hard word for an easy one, and a real rewrite", () => {
    const src = SOURCE[1]!.text;
    expect(parsePlain({ blocks: [{ id: "t1", text: "Správní poplatek ve výši 500 Kč se platí v hotovosti nebo převodem na účet obce." }] }, SOURCE).blocks).toHaveLength(1);
    expect(notPlainer(src, "Poplatek je 500 Kč. Zaplaťte ho v hotovosti nebo na účet obce.")).toBeNull();
    // The e2e stand-in ("[PLAIN] " + the block) is a near copy without misspellings: it passes.
    expect(notPlainer(src, `[PLAIN] ${src}`)).toBeNull();
  });

  it("the prompt asks for correct words and lets a plain block stay as it is", () => {
    const p = prompts.plainBlocks(DENIK, "cs");
    expect(p).toContain("correct spelling");
    expect(p).toContain("already plain");
  });

  it("the prompt asks for the facts to stay and the blocks to stay apart", () => {
    const p = prompts.plainBlocks(SOURCE, "cs");
    expect(p).toContain("Keep every number, date, amount, name and address exactly as written");
    expect(p).toContain("[t1] Správní poplatek ve výši 500 Kč");
  });
});
