import { describe, expect, it } from "vitest";
import type { FieldStructure, FormStructure } from "@distill/engine";
import { basicFormat, basicWizard, originChip } from "./Wayfill";

const field = (f: Partial<FieldStructure> & Pick<FieldStructure, "fieldId" | "label">): FieldStructure => ({ kind: "text", required: false, ...f });

const structure: FormStructure = {
  fingerprint: "fp",
  url: "https://mv.example/zadost",
  lang: "cs",
  title: "Žádost",
  fields: [
    field({ fieldId: "jmeno", label: "Jméno", required: true, hint: "Jak je v pasu" }),
    field({ fieldId: "rc", label: "Rodné číslo", placeholder: "900101/1234", pattern: "[0-9]{6}/?[0-9]{3,4}" }),
    field({ fieldId: "psc", label: "PSČ", pattern: "[0-9]{5}" }),
    field({ fieldId: "datum", label: "Datum narození", kind: "date" }),
    field({ fieldId: "email", label: "E-mail", kind: "email" }),
  ],
};

describe("basicWizard (no AI)", () => {
  const w = basicWizard(structure, "en");

  it("quotes the form's own label as written and explains in plain English", () => {
    expect(w.steps.map((s) => s.question)).toEqual([
      'Fill in: "Jméno"', 'Fill in: "Rodné číslo"', 'Fill in: "PSČ"', 'Fill in: "Datum narození"', 'Fill in: "E-mail"',
    ]);
    for (const s of w.steps) {
      expect(s.explanation).toBe("This is the form's own label, as written on the page. Type what the form asks for.");
      expect(s.question).not.toMatch(/What is your/i);
    }
    expect(w.steps.map((s) => s.fieldIds)).toEqual(structure.fields.map((f) => [f.fieldId]));
  });

  it("keeps the expected format from the placeholder, the pattern or the kind", () => {
    expect(w.steps.map((s) => s.expectedFormat)).toEqual([undefined, "900101/1234", "5 digits", "A date", "An email address, like name@example.com"]);
    expect(w.steps[0]).not.toHaveProperty("expectedFormat");
    expect(w.steps[1]?.example).toBe("900101/1234");
    expect(basicFormat(field({ fieldId: "x", label: "x", pattern: "\\d{9,10}" }))).toBe("9 to 10 digits");
  });
});

describe("origin chip", () => {
  it("says no AI was used for basic steps and keeps the saved-guide wording", () => {
    expect(originChip({ kind: "basic", why: "AI is off." })).toEqual({ text: "No AI used", title: "AI is off. These steps use the form's own labels." });
    expect(originChip({ kind: "cache" }).text).toBe("Saved guide (no AI used)");
  });
});
