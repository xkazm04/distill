import { describe, expect, it } from "vitest";
import { findActions, type FoundAction } from "../src/index.js";
import { sentencesOf } from "../src/actions.js";
import { contactsInText } from "../src/contact.js";

const find = (texts: string[], lang = "cs") => findActions(texts.map((text, i) => ({ id: `m${i}`, text })), lang);
const brief = (items: FoundAction[]) => items.map((a) => [a.kind, a.text]);

describe("findActions: deadlines", () => {
  it("reads Czech deadlines: 'do 31. 3.', 'nejpozději do 15. března 2024', 'lhůta ... 30 dnů'", () => {
    const items = find([
      "Žádost je nutné podat do 31. 3. na podatelně obecního úřadu.",
      "Přihlášky zasílejte nejpozději do 15. března 2024.",
      "Odvolání lze podat do 15 dnů od doručení rozhodnutí.",
    ]);
    expect(brief(items)).toEqual([
      ["deadline", "By 31. 3."],
      ["deadline", "By 15. března 2024"],
      ["deadline", "Within 15 dnů"],
    ]);
    expect(items[0]).toMatchObject({ id: "a0", blockId: "m0", quote: "Žádost je nutné podat do 31. 3. na podatelně obecního úřadu.", value: "31. 3." });
    expect(items.map((i) => i.id)).toEqual(["a0", "a1", "a2"]);
  });

  it("a 'do' date without anything asked of the reader is no deadline; 'nejpozději' always is", () => {
    expect(find(["Výstava potrvá do 31. 3. 2025 v galerii."])).toEqual([]);
    expect(brief(find(["Splatnost faktury: 14. 4. 2025."]))).toEqual([["deadline", "By 14. 4. 2025"]]);
  });

  it("reads English deadlines", () => {
    expect(brief(find(["Please submit the form by 15 March 2025.", "The deadline is April 30."], "en"))).toEqual([
      ["deadline", "By 15 March 2025"], ["deadline", "By April 30"],
    ]);
  });
});

describe("findActions: sums to pay", () => {
  it("reads a sum, the account number, the variable symbol and the deadline as one item", () => {
    const items = find(["Poplatek 500 Kč uhraďte převodem na účet 123456789/0100, variabilní symbol 1337, nejpozději do 30. 6. 2025."]);
    expect(brief(items)).toEqual([["payment", "Pay 500 Kč to 123456789/0100, variable symbol 1337 by 30. 6. 2025"]]);
    expect(items[0]?.value).toBe("123456789/0100");
  });

  it("reads a prefix account, an IBAN and Czech thousands", () => {
    expect(brief(find(["Částku 1 250,- Kč zaplaťte na č. ú. 19-2000145399/0800."]))).toEqual([["payment", "Pay 1 250,- Kč to 19-2000145399/0800"]]);
    expect(brief(find(["Platbu 2.500 Kč pošlete na IBAN CZ65 0800 0000 1920 0014 5399."]))).toEqual([["payment", "Pay 2.500 Kč to CZ65 0800 0000 1920 0014 5399"]]);
  });

  it("a price list is not a payment; a reference number with a year is not an account", () => {
    expect(find(["Přívěsný vozík: 1 den 300 Kč, víkend 800 Kč."])).toEqual([]);
    expect(find(["Rozhodnutí č. j. 123456/2024 nabylo právní moci."])).toEqual([]);
  });
});

describe("findActions: what to bring", () => {
  it("reads 's sebou', 'doložte' and 'předložte'", () => {
    expect(brief(find([
      "S sebou si vezměte občanský průkaz a kartičku pojištěnce.",
      "K žádosti doložte potvrzení o příjmech za poslední 3 měsíce.",
      "Při převzetí předložte doklad totožnosti.",
    ]))).toEqual([
      ["bring", "Bring: občanský průkaz a kartičku pojištěnce"],
      ["bring", "Provide: potvrzení o příjmech za poslední 3 měsíce"],
      ["bring", "Show: doklad totožnosti"],
    ]);
  });
});

describe("findActions: contacts and opening hours", () => {
  it("reads office hours, a phone and an e-mail, each with its link, in reading order", () => {
    const items = find(["Úřední hodiny: Po, St 8:00 - 17:00. Informace na tel. 377 912 345 nebo e-mailem obec@stahlavy.cz."]);
    expect(brief(items)).toEqual([
      ["hours", "Hours: Po, St 8:00 - 17:00"],
      ["contact", "Call 377 912 345"],
      ["contact", "Write to obec@stahlavy.cz"],
    ]);
    expect(items[1]).toMatchObject({ href: "tel:+420377912345", quote: "377 912 345", value: "377 912 345" });
    expect(items[2]).toMatchObject({ href: "mailto:obec@stahlavy.cz" });
  });

  it("hours written one range after another are one item, quoting the page's exact words", () => {
    const text = "Po - Pá: 7.00 - 16.30 So: 8.00 - 11.00 (jen pneuservis)";
    const items = find([text]);
    expect(brief(items)).toEqual([["hours", "Hours: Po - Pá: 7.00 - 16.30; So: 8.00 - 11.00"]]);
    expect(text).toContain(items[0]?.quote ?? "?");
  });

  it("a bank account, a price and a date are not phones; the same number twice is listed once", () => {
    expect(find(["IČO: 12345678, č. ú. 1234567890/0800."])).toEqual([]);
    expect(find(["Volejte 602 123 456.", "Nebo znovu 602 123 456."]).length).toBe(1);
  });

  it("contactsInText keeps each item's exact words", () => {
    const t = "Kontakt: tel.: 377 912 345, e-mail: servis(at)novak-example.cz, Po-Pá 7:30 - 16:30";
    for (const c of contactsInText(t, true)) expect(t.slice(c.at, c.at + c.quote.length)).toBe(c.quote);
  });
});

describe("findActions: reading order and limits", () => {
  it("one item per sentence (the payment wins over its deadline); quotes are exact pieces of their block", () => {
    const blocks = [
      "Vážení občané, poplatek za psa ve výši 200 Kč je splatný do 31. 3. 2025 na účet 123456789/0100. Doklad o zaplacení předložte na úřadě.",
    ];
    const items = find(blocks);
    expect(items.map((i) => i.kind)).toEqual(["payment", "bring"]);
    for (const i of items) expect(blocks[0]).toContain(i.quote);
  });

  it("a long sentence is cut around what was found, still the page's exact words", () => {
    const long = `${"Obec připravila pro své občany řadu novinek a změn, o kterých vás budeme informovat. ".repeat(1).trim().replace(/\.$/, "")}, a proto vás prosíme, abyste ${"si přečetli všechny informace pečlivě a ".repeat(4)}přihlášky podali nejpozději do 15. 4. 2025, jinak ${"nebude možné žádosti vyhovět a ".repeat(4)}konec.`;
    const [item] = find([long]);
    expect(item?.kind).toBe("deadline");
    expect(item?.quote.length).toBeLessThanOrEqual(240);
    expect(long).toContain(item?.quote ?? "?");
    expect(item?.quote).toContain("15. 4. 2025");
  });

  it("news text says little: no deadline from a report of events, no payment from a quoted sum", () => {
    const items = find([
      "Vláda ve středu schválila návrh, podle kterého by se příspěvek na bydlení od 1. července zvýšil o 500 korun.",
      "Ministr řekl, že změna platí do konce roku 2025 a týká se zhruba 200 tisíc domácností.",
      "Podle statistiků se ceny energií v březnu meziročně zvýšily o 12 procent.",
    ]);
    expect(items).toEqual([]);
    // "due to start in March 2027" is no deadline of the reader's, and "March 20" is not in it.
    expect(find(["Construction is due to start in March 2027 and the first trams should run by the end of 2030."], "en")).toEqual([]);
  });

  it("sentences: a date's dots never end one", () => {
    expect(sentencesOf("Podejte do 31. 3. 2025 na úřadě. Pak čekejte.").map((s) => s.text)).toEqual(["Podejte do 31. 3. 2025 na úřadě.", "Pak čekejte."]);
    expect(sentencesOf("Kontaktujte Mgr. Nováka. Děkujeme.").map((s) => s.text)).toEqual(["Kontaktujte Mgr. Nováka.", "Děkujeme."]);
  });
});
