// The saved papers (L1): device only, opt-in by the caller, only read-back answers, one-call delete.
import { beforeEach, describe, expect, it } from "vitest";
import type { FieldStructure, FormStructure } from "@distill/engine";
import { clearPapers, loadPapers, PAPERS_KEY, proposePapers, rememberPapers } from "./papers";

const f = (fieldId: string, label: string, more: Partial<FieldStructure> = {}): FieldStructure => ({ fieldId, kind: "text", label, required: false, ...more });
const health: FormStructure = { fingerprint: "a", url: "https://vzp.example/p", lang: "cs", title: "Přihláška", fields: [
  f("prijmeni", "Příjmení"), f("jmeno", "Jméno"), f("narozeni", "Datum narození", { kind: "date" }), f("telefon", "Telefon", { kind: "tel" }), f("ulice", "Ulice"),
] };
const move: FormStructure = { fingerprint: "b", url: "https://mv.example/z", lang: "cs", title: "Oznámení", fields: [
  f("prijmeni", "Příjmení"), f("jmeno", "Jméno"), f("datum", "Datum narození", { placeholder: "D.M.YYYY" }), f("telefon", "Telefon"), f("ulice", "Ulice", { section: "Nová adresa" }),
] };

describe("saved papers", () => {
  beforeEach(() => localStorage.clear());

  it("saves only facts the page read back as written, keyed by fact, and proposes them on the next form", () => {
    const back = { prijmeni: "Kovalenko", jmeno: "Olena", narozeni: "1990-03-14", telefon: "777123456", ulice: "Vinohradská 1" };
    const saved = rememberPapers(health, back, ["prijmeni", "narozeni", "telefon", "ulice"]);
    expect(saved).toEqual({ surname: "Kovalenko", birthDate: "1990-03-14", phone: "777123456" });
    expect(JSON.parse(localStorage.getItem(PAPERS_KEY)!)).toEqual(saved);
    expect(proposePapers(move, { telefon: "602000000" })).toEqual({ prijmeni: "Kovalenko", datum: "14.3.1990" });
  });

  it("deletes everything in one call, and survives junk or blocked storage", () => {
    rememberPapers(health, { prijmeni: "Kovalenko" }, ["prijmeni"]);
    clearPapers();
    expect(loadPapers()).toEqual({});
    localStorage.setItem(PAPERS_KEY, JSON.stringify({ surname: "Kovalenko", address: "Vinohradská 1", phone: 5 }));
    expect(loadPapers()).toEqual({ surname: "Kovalenko" });
    localStorage.setItem(PAPERS_KEY, "not json");
    expect(loadPapers()).toEqual({});
  });
});
