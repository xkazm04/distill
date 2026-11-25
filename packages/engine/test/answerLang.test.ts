// When "Put into Czech" (L2) may be offered: free text only, never a name, number, date, address or formatted field,
// and only when the form's language differs from the reader's.
import { describe, expect, it } from "vitest";
import { canOfferTranslation, type FieldStructure } from "../src/index.js";

const f = (label: string, more: Partial<FieldStructure> = {}): FieldStructure => ({ fieldId: "x", kind: "text", label, required: false, ...more });

describe("canOfferTranslation", () => {
  it("offers it for free text on a Czech form read in English or Ukrainian", () => {
    expect(canOfferTranslation(f("Účel pobytu"), "cs", "en")).toBe(true);
    expect(canOfferTranslation(f("Poznámka", { kind: "textarea" }), "cs", "uk")).toBe(true);
    expect(canOfferTranslation(f("Zaměstnání"), "cs-CZ", "en-GB")).toBe(true);
  });

  it("never when the form is in the reader's language or its language is unknown", () => {
    expect(canOfferTranslation(f("Účel pobytu"), "cs", "cs")).toBe(false);
    expect(canOfferTranslation(f("Purpose"), "und", "en")).toBe(false);
    expect(canOfferTranslation(f("Purpose"), "", "en")).toBe(false);
  });

  it("never for names, numbers, dates, e-mail, phone, birth number, addresses or choices", () => {
    for (const label of ["Příjmení", "Jméno", "Jméno a příjmení", "Rodné číslo", "Datum změny pobytu", "Telefon", "E-mail", "Ulice", "Obec",
      "Adresa trvalého pobytu", "Číslo dokladu o pobytu", "Státní příslušnost", "Podpis", "PSČ"]) {
      expect(canOfferTranslation(f(label), "cs", "en"), label).toBe(false);
    }
    for (const kind of ["email", "tel", "number", "date", "select", "radio", "checkbox", "file"] as const) {
      expect(canOfferTranslation(f("Poznámka", { kind }), "cs", "en"), kind).toBe(false);
    }
  });

  it("never when a pattern, a format placeholder or the step's expectedFormat says what to write", () => {
    expect(canOfferTranslation(f("Poznámka", { pattern: "[A-Z]+" }), "cs", "en")).toBe(false);
    expect(canOfferTranslation(f("Poznámka", { placeholder: "123 45" }), "cs", "en")).toBe(false);
    expect(canOfferTranslation(f("Poznámka"), "cs", "en", "DD.MM.YYYY")).toBe(false);
  });
});
