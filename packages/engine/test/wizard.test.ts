import { describe, expect, it } from "vitest";
import { mergeWizards, parseWizard, prompts, readWizard, type FormStructure } from "../src/index.js";

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

describe("readWizard: option labels in the reader's language", () => {
  const form: FormStructure = {
    ...structure,
    fields: [
      { fieldId: "duvod", kind: "select", label: "Důvod přihlášky", required: true, options: [{ value: "1", label: "Zahájení zaměstnání" }, { value: "2", label: "Změna zdravotní pojišťovny" }] },
      { fieldId: "pohlavi", kind: "radio", label: "Pohlaví", required: true, options: [{ value: "Z", label: "žena" }, { value: "M", label: "muž" }] },
    ],
  };

  it("keeps an entry that names a field of the step and one of its option values, cleaned of HTML", () => {
    const r = readWizard({ steps: [{ stepId: "s1", fieldIds: ["duvod"], question: "Why?", explanation: "", options: [
      { fieldId: "duvod", value: "1", label: "<b>Starting a job</b>" },
      { fieldId: "duvod", value: "2", label: "Changing health insurer" },
    ] }] }, form, "en");
    expect(r.wizard.steps[0]?.options).toEqual([
      { fieldId: "duvod", value: "1", label: "Starting a job" },
      { fieldId: "duvod", value: "2", label: "Changing health insurer" },
    ]);
    expect(r.droppedOptions).toBe(0);
  });

  it("drops and counts a foreign value, a field of another step, an empty label, a repeat and a non-list", () => {
    const r = readWizard({ steps: [
      { stepId: "s1", fieldIds: ["duvod"], question: "Why?", explanation: "", options: [
        { fieldId: "duvod", value: "5", label: "Retiring" }, // not an option of the form
        { fieldId: "pohlavi", value: "Z", label: "female" }, // a field of another step
        { fieldId: "duvod", value: "1", label: "<i></i>" }, // nothing left once cleaned
        { fieldId: "duvod", value: "2", label: "Changing insurer" },
        { fieldId: "duvod", value: "2", label: "Changing insurer again" }, // a repeat
        "x",
      ] },
      { stepId: "s2", fieldIds: ["pohlavi"], question: "Sex?", explanation: "", options: "female, male" },
    ] }, form, "en");
    expect(r.wizard.steps[0]?.options).toEqual([{ fieldId: "duvod", value: "2", label: "Changing insurer" }]);
    expect(r.wizard.steps[1]).not.toHaveProperty("options");
    expect(r.droppedOptions).toBe(6);
    expect(parseWizard({ steps: [{ stepId: "s1", fieldIds: ["duvod"], question: "Why?", explanation: "", options: [] }] }, form, "en").steps[0]).not.toHaveProperty("options");
  });

  it("mergeWizards keeps a step's option labels only for the fields the step still covers", () => {
    const guide = { fingerprint: "fp", readerLang: "en", steps: [{ stepId: "g", fieldIds: ["pohlavi"], question: "Sex?", explanation: "" }] };
    const rest = { fingerprint: "fp", readerLang: "en", steps: [{ stepId: "s", fieldIds: ["duvod", "pohlavi"], question: "Why?", explanation: "", options: [
      { fieldId: "duvod", value: "1", label: "Starting a job" }, { fieldId: "pohlavi", value: "Z", label: "female" },
    ] }] };
    const step = mergeWizards(form, guide, rest).wizard.steps.find((st) => st.stepId === "s");
    expect(step?.fieldIds).toEqual(["duvod"]);
    expect(step?.options).toEqual([{ fieldId: "duvod", value: "1", label: "Starting a job" }]);
  });

  it("the prompt asks for options in the reader's language, by the form's own values", () => {
    const p = prompts.buildWizard(form, "uk");
    expect(p).toContain('options: only for a field of the step that lists options: [{"fieldId", "value", "label"}]');
    expect(p).toContain("plainly in Ukrainian");
    expect(p).toContain('options=[{"value":"1","label":"Zahájení zaměstnání"}');
  });
});
