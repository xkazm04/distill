// The script check (S3): an answer in letters a Latin-script form does not take is stopped, with one sentence.
import { describe, expect, it } from "vitest";
import { checkScript, formTakesLatin, type FieldStructure } from "../src/index.js";

const text: Pick<FieldStructure, "kind" | "label"> = { kind: "text", label: "Příjmení" };

describe("checkScript", () => {
  it("stops Cyrillic on a Czech form with one plain sentence", () => {
    const p = checkScript(text, "cs", "Коваленко");
    expect(p).toMatchObject({ script: "Cyrillic" });
    expect(p?.message).toBe("Write this in Latin letters (A-Z), as in your passport: this form does not take Cyrillic letters.");
    expect(checkScript(text, "cs", "Коваленко", "uk")?.message).toMatch(/латинськими літерами/);
    // One Cyrillic letter in a Latin word (a lookalike typed on a Ukrainian keyboard) is caught too.
    expect(checkScript(text, "cs", "Kovalenkо")?.letters).toBe("о");
    expect(checkScript({ kind: "textarea", label: "Poznámka" }, "cs-CZ", "Ελένη")?.script).toBe("Greek");
    expect(checkScript(text, "de", "محمد")?.script).toBe("Arabic");
  });

  it("allows Czech and other Latin letters with accents, digits and punctuation", () => {
    expect(checkScript(text, "cs", "ěščřžýáíéůú ĚŠČŘŽÝÁÍÉŮÚ ďťň")).toBeNull();
    expect(checkScript(text, "cs", "Müller-Łukasz, Straße 12/3")).toBeNull();
    expect(checkScript(text, "cs", "ě")).toBeNull(); // decomposed ě
  });

  it("leaves digits, e-mail, phone, number, date and choices alone", () => {
    for (const kind of ["email", "tel", "number", "date", "select", "radio", "checkbox"] as const) {
      expect(checkScript({ kind, label: "X" }, "cs", "Коваленко")).toBeNull();
    }
    expect(checkScript(text, "cs", "870619/4321")).toBeNull();
  });

  it("checks only forms in a Latin-script language, and not a field asking for the original script", () => {
    expect(formTakesLatin("cs")).toBe(true);
    expect(formTakesLatin("uk")).toBe(false);
    expect(checkScript(text, "uk", "Коваленко")).toBeNull();
    expect(checkScript(text, "und", "Коваленко")).toBeNull();
    expect(checkScript(text, "", "Коваленко")).toBeNull();
    expect(checkScript({ kind: "text", label: "Jméno v azbuce" }, "cs", "Олена")).toBeNull();
  });
});
