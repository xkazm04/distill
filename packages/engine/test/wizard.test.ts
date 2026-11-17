import { describe, expect, it } from "vitest";
import { parseWizard, type FormStructure } from "../src/index.js";

const structure: FormStructure = {
  fingerprint: "fp",
  url: "https://x.example/",
  lang: "cs",
  title: "T",
  fields: [
    { fieldId: "a", kind: "text", label: "Jméno", required: true },
    { fieldId: "b", kind: "text", label: "Příjmení", required: true },
    { fieldId: "c", kind: "text", label: "Poznámka", required: false },
    { fieldId: "d", kind: "date", label: "Datum", required: true },
  ],
};

describe("parseWizard", () => {
  it("keeps valid steps, drops unknown fieldIds and steps with none left", () => {
    const w = parseWizard(
      {
        steps: [
          { stepId: "s1", fieldIds: ["a", "zzz"], question: "What is your first name?", explanation: "As in your passport.", example: "Anna" },
          { stepId: "s2", fieldIds: ["nope"], question: "?", explanation: "?" },
        ],
      },
      structure,
      "en",
    );
    expect(w.steps.find((s) => s.stepId === "s1")?.fieldIds).toEqual(["a"]);
    expect(w.steps.some((s) => s.stepId === "s2")).toBe(false);
    expect(w.fingerprint).toBe("fp");
    expect(w.readerLang).toBe("en");
  });

  it("adds a plain fallback step for every required field the model missed, in form order", () => {
    const w = parseWizard({ steps: [{ stepId: "x", fieldIds: ["b"], question: "Surname?", explanation: "Family name." }] }, structure, "en");
    expect(w.steps.map((s) => s.fieldIds)).toEqual([["a"], ["b"], ["d"]]);
    expect(w.steps[0]).toMatchObject({ stepId: "a", question: "Jméno" });
    const covered = new Set(w.steps.flatMap((s) => s.fieldIds));
    for (const f of structure.fields.filter((f) => f.required)) expect(covered.has(f.fieldId)).toBe(true);
  });

  it("does not add steps for optional fields and survives garbage", () => {
    for (const bad of [null, "x", 3, {}, { steps: "x" }, { steps: [null, 1, "s"] }]) {
      const w = parseWizard(bad, structure, "en");
      expect(w.steps.map((s) => s.fieldIds[0])).toEqual(["a", "b", "d"]);
    }
  });

  it("strips HTML, drops script links, never covers a field twice", () => {
    const w = parseWizard(
      {
        steps: [
          { stepId: "s1", fieldIds: ["a"], question: "<b>Name?</b>", explanation: "ok" },
          { stepId: "s2", fieldIds: ["a", "b"], question: "Again", explanation: "x" },
          { stepId: "s3", fieldIds: ["d"], question: "Date", explanation: "javascript:alert(1)" },
        ],
      },
      structure,
      "en",
    );
    expect(w.steps[0]?.question).toBe("Name?");
    expect(w.steps.flatMap((s) => s.fieldIds).filter((id) => id === "a")).toHaveLength(1);
    expect(w.steps.find((s) => s.stepId === "s3")).toBeUndefined();
    expect(w.steps.find((s) => s.fieldIds.includes("d"))?.question).toBe("Datum");
  });
});
