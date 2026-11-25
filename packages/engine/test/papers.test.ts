// Papers by label (L1): which identity fact a field asks for (structure only), and the device-side join that proposes a
// saved fact in each field's own format. No model anywhere.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalPaper, conceptOf, conceptsOf, formatPaper, guideStructure, papersFrom, proposeFromPapers,
  type FieldStructure, type FormGuide, type FormStructure,
} from "../src/index.js";

const guide = (id: string): FormGuide => JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../../../guides/cz/${id}.json`), "utf8")) as FormGuide;
const f = (fieldId: string, label: string, more: Partial<FieldStructure> = {}): FieldStructure => ({ fieldId, kind: "text", label, required: false, ...more });
const form = (fields: FieldStructure[], lang = "cs"): FormStructure => ({ fingerprint: "fp", url: "https://x.example/f", lang, title: "F", fields });

describe("conceptOf: which identity fact a field asks for", () => {
  it("the mother's insured-number field of the VZP form gets no concept (vzp-prihlaska-a-evidencni-list.json)", () => {
    const s = guideStructure(guide("vzp-prihlaska-a-evidencni-list"));
    const mother = s.fields.find((x) => x.fieldId === "Číslo_pojištěnce_-_rodné_číslo_matky")!;
    expect(mother.label).toBe("U novorozenců uvést číslo pojištěnce matky (RČ)");
    expect(conceptOf(mother, s.lang, s.fields)).toBeNull();
    // Not only because it is split into two boxes: the same field alone, with the person's own label, is still the mother's.
    const alone = { ...mother, label: "Číslo pojištěnce (rodné číslo)" };
    expect(conceptOf(alone, "cs", [alone])).toBeNull();
    expect(conceptOf({ ...alone, fieldId: "rc" }, "cs", [{ ...alone, fieldId: "rc" }])).toBe("birthNumber");
  });

  it("a field under a zástupce section gets none, and the person's own field keeps its fact", () => {
    const own = f("prijmeni", "Příjmení", { section: "Pojištěnec" });
    const rep = f("prijmeni2", "Příjmení", { section: "Zákonný zástupce" });
    const s = form([own, rep]);
    expect(conceptOf(rep, "cs", s.fields)).toBeNull();
    expect(conceptOf(own, "cs", s.fields)).toBe("surname");
    for (const section of ["Údaje o matce", "Mother", "Employer", "Представник", "Údaje o dítěti", "Manžel / manželka"]) {
      const x = f("x", "Příjmení", { section });
      expect(conceptOf(x, "cs", [x]), section).toBeNull();
    }
  });

  it("two fields that would take the same fact take none", () => {
    const s = form([f("a", "Telefon"), f("b", "Telefon", { section: "Kontakt" })]);
    expect(conceptsOf(s)).toEqual({});
  });

  it("a kind that does not fit gets none; addresses never get one", () => {
    expect(conceptOf(f("x", "Příjmení", { kind: "select" }), "cs", [])).toBeNull();
    expect(conceptOf(f("x", "E-mail", { kind: "email" }), "cs", [])).toBe("email");
    expect(conceptOf(f("x", "Datum narození", { kind: "date" }), "cs", [])).toBe("birthDate");
    for (const label of ["Ulice", "Obec", "PSČ", "Adresa trvalého pobytu", "Address", "Адреса"]) expect(conceptOf(f("x", label), "cs", [])).toBeNull();
  });

  it("a trilingual ministry label names one fact in all three languages, even with a Latin T in the Cyrillic", () => {
    expect(conceptOf(f("x", "Datum narození / Date of birth / Дата народження", { kind: "date" }), "cs", [])).toBe("birthDate");
    expect(conceptOf(f("x", "Telefon / Telephone / Tелефон"), "cs", [])).toBe("phone");
    expect(conceptOf(f("x", "Jméno a příjmení / Name and surname Ім’я та прізвище"), "cs", [])).toBeNull();
    expect(conceptOf(f("x", "Прізвище"), "uk", [])).toBe("surname");
    expect(conceptOf(f("x", "Surname"), "en", [])).toBe("surname");
  });

  it("exact labels only, never a substring", () => {
    for (const label of ["Příjmení podnikatele", "Jméno a příjmení", "Datum změny pobytu", "Číslo dokladu o pobytu", "E-mail pro notifikace"]) {
      expect(conceptOf(f("x", label), "cs", []), label).toBeNull();
    }
  });
});

describe("papers: canonical facts and proposals in each field's format", () => {
  it("one stored ISO birth date lands as ISO in a type=date field and as D.M.YYYY / DD.MM.RRRR in text fields", () => {
    const papers = { birthDate: "1987-06-09" };
    expect(proposeFromPapers(form([f("d", "Datum narození", { kind: "date" })]), papers)).toEqual({ d: "1987-06-09" });
    expect(proposeFromPapers(form([f("d", "Datum narození", { placeholder: "D.M.YYYY" })]), papers)).toEqual({ d: "9.6.1987" });
    expect(proposeFromPapers(form([f("d", "Datum narození", { placeholder: "DD.MM.RRRR" })]), papers)).toEqual({ d: "09.06.1987" });
    expect(proposeFromPapers(form([f("d", "Datum narození", { placeholder: "RRRR-MM-DD" })]), papers)).toEqual({ d: "1987-06-09" });
    // No format given: a Czech form writes DD.MM.RRRR; an English one is not guessed.
    expect(proposeFromPapers(form([f("d", "Datum narození")]), papers)).toEqual({ d: "09.06.1987" });
    expect(proposeFromPapers(form([f("d", "Date of birth")], "en"), papers)).toEqual({});
    expect(proposeFromPapers(form([f("d", "Date of birth", { placeholder: "MM/DD/YYYY" })], "en"), papers)).toEqual({});
  });

  it("proposes only into empty fields, and only facts it holds", () => {
    const s = form([f("p", "Příjmení"), f("j", "Jméno"), f("t", "Telefon", { kind: "tel" }), f("u", "Ulice")]);
    const papers = { surname: "Kovalenko", givenName: "Olena", phone: "+420777123456" };
    expect(proposeFromPapers(s, papers, { j: "Olha" })).toEqual({ p: "Kovalenko", t: "+420777123456" });
  });

  it("formats a birth number and a phone the way the field shows, and never overflows maxLength", () => {
    expect(formatPaper("birthNumber", "8706194321", f("r", "Rodné číslo", { placeholder: "900101/1234" }), "cs")).toBe("870619/4321");
    expect(formatPaper("birthNumber", "8706194321", f("r", "Rodné číslo", { maxLength: 10 }), "cs")).toBe("8706194321");
    expect(formatPaper("birthNumber", "8706194321", f("r", "Rodné číslo", { kind: "number" }), "cs")).toBe("8706194321");
    expect(formatPaper("phone", "+420777123456", f("t", "Telefon", { hint: "ve formátu +420 123 456 789" }), "cs")).toBe("+420 777 123 456");
    expect(formatPaper("phone", "+420777123456", f("t", "Telefon", { maxLength: 9 }), "cs")).toBeNull();
    const sel = f("s", "Státní příslušnost", { kind: "select", options: [{ value: "", label: "--" }, { value: "UA", label: "Ukrajina" }] });
    expect(formatPaper("nationality", "Ukrajina", sel, "cs")).toBe("UA");
    expect(formatPaper("nationality", "Vietnam", sel, "cs")).toBeNull();
  });

  it("keeps only answers the page read back as written, in canonical form", () => {
    const sel = f("s", "Státní příslušnost", { kind: "select", options: [{ value: "UA", label: "Ukrajina" }] });
    const s = form([f("p", "Příjmení"), f("d", "Datum narození"), f("r", "Rodné číslo"), f("t", "Telefon"), sel, f("e", "E-mail"), f("u", "Ulice")]);
    const readBack = { p: " Kovalenko ", d: "9.6.1987", r: "870619/4321", t: "00420 777 123 456", s: "UA", e: "o@example.cz", u: "Vinohradská 1" };
    expect(papersFrom(s, readBack, ["p", "d", "r", "t", "s", "e", "u"])).toEqual({
      surname: "Kovalenko", birthDate: "1987-06-09", birthNumber: "8706194321", phone: "+420777123456", nationality: "Ukrajina", email: "o@example.cz",
    });
    // A field the write did not confirm is not saved.
    expect(papersFrom(s, readBack, ["p"])).toEqual({ surname: "Kovalenko" });
  });

  it("refuses an answer that is not a sound value of its fact", () => {
    expect(canonicalPaper("birthDate", "31.02.1990")).toBeNull();
    expect(canonicalPaper("birthNumber", "12345")).toBeNull();
    expect(canonicalPaper("email", "o@")).toBeNull();
    expect(canonicalPaper("surname", "123")).toBeNull();
    expect(canonicalPaper("passportNumber", " fa 123 456 ")).toBe("FA123456");
  });

  it("health-insurance to address-change: surname, first name and phone are proposed, the address stays empty", () => {
    const health = form([f("prijmeni", "Příjmení", { section: "Pojištěnec" }), f("jmeno", "Jméno", { section: "Pojištěnec" }),
      f("narozeni", "Datum narození", { kind: "date", section: "Pojištěnec" }), f("email", "E-mail", { kind: "email" }), f("telefon", "Telefon", { kind: "tel" })]);
    const papers = papersFrom(health, { prijmeni: "Kovalenko", jmeno: "Olena", narozeni: "1990-03-14", email: "o@example.cz", telefon: "777123456" },
      ["prijmeni", "jmeno", "narozeni", "email", "telefon"]);
    const move = form([f("prijmeni", "Příjmení"), f("jmeno", "Jméno"), f("doklad", "Číslo dokladu o pobytu"), f("telefon", "Telefon"),
      f("ulice", "Ulice", { section: "Nová adresa pobytu" }), f("obec", "Obec", { section: "Nová adresa pobytu" }), f("psc", "PSČ", { section: "Nová adresa pobytu" })]);
    expect(proposeFromPapers(move, papers)).toEqual({ prijmeni: "Kovalenko", jmeno: "Olena", telefon: "777123456" });
  });
});
