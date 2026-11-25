import { describe, expect, it } from "vitest";
import { account, type FormErrors, type FormStructure, type Wizard } from "../src/index.js";

const structure: FormStructure = {
  fingerprint: "fp",
  url: "https://forms.example/f",
  lang: "cs",
  title: "Přihláška",
  fields: [
    { fieldId: "jmeno", kind: "text", label: "Jméno", required: true },
    { fieldId: "narozeni", kind: "date", label: "Datum narození", required: true },
    { fieldId: "telefon", kind: "tel", label: "Telefon", required: false },
    { fieldId: "email", kind: "email", label: "E-mail", required: false },
    { fieldId: "duvod", kind: "select", label: "Důvod", required: true, options: [{ value: "1", label: "Zaměstnání" }, { value: "2", label: "Změna" }] },
    { fieldId: "prohlaseni", kind: "checkbox", label: "Prohlašuji", required: true },
    { fieldId: "doklad", kind: "file", label: "Doklad", required: false },
    { fieldId: "pozn", kind: "text", label: "Poznámka", required: false },
  ],
};
const wizard: Wizard = {
  fingerprint: "fp",
  readerLang: "en",
  steps: [
    { stepId: "name", fieldIds: ["jmeno"], question: "Your first name?", explanation: "" },
    { stepId: "birth", fieldIds: ["narozeni"], question: "Date of birth?", explanation: "" },
    { stepId: "contact", fieldIds: ["telefon", "email"], question: "How can they reach you?", explanation: "" },
    { stepId: "why", fieldIds: ["duvod"], question: "Why?", explanation: "" },
    { stepId: "declare", fieldIds: ["prohlaseni"], question: "Do you declare?", explanation: "" },
    { stepId: "doc", fieldIds: ["doklad"], question: "Your document", explanation: "" },
  ],
};
const NONE: FormErrors = { fields: {}, form: [] };
const status = (rows: ReturnType<typeof account>) => Object.fromEntries(rows.map((r) => [r.fieldId, r.status]));

describe("account: every field of the form, re-read at the end", () => {
  it("gives each field one status, in step order, with its step", () => {
    const rows = account(
      structure,
      wizard,
      { jmeno: "Olena", narozeni: "1.12.1990", telefon: "777 123 456", duvod: "1" },
      { jmeno: "Olena", narozeni: "1990-12-01", telefon: "", duvod: "1", email: "olena@example.com", prohlaseni: "false" },
      { fields: { duvod: { text: "Vyberte jinou možnost", source: "nearby" } }, form: [] },
    );
    expect(rows.map((r) => [r.fieldId, r.stepId])).toEqual([
      ["jmeno", "name"], ["narozeni", "birth"], ["telefon", "contact"], ["email", "contact"], ["duvod", "why"],
      ["prohlaseni", "declare"], ["doklad", "doc"], ["pozn", null],
    ]);
    expect(status(rows)).toEqual({
      jmeno: "ok",
      narozeni: "ok", // the browser's YYYY-MM-DD is the D.M.YYYY answer
      telefon: "changed", // written, then emptied by the page
      email: "ok", // a value the page holds of its own
      duvod: "page-error",
      prohlaseni: "required-empty", // an unticked required box
      doklad: "unconfirmed", // a file is chosen in the original
      pozn: "skipped-optional",
    });
  });

  it("a value the page changed after the write is changed; the same value laid out by a mask is ok", () => {
    const rows = account(structure, wizard, { jmeno: "Olena", telefon: "777123456" }, { jmeno: "Olga", telefon: "777 123 456" }, NONE);
    expect(status(rows)).toMatchObject({ jmeno: "changed", telefon: "ok" });
  });

  it("an answer typed but never written does not count: the field is empty, so required-empty", () => {
    expect(status(account(structure, wizard, {}, {}, NONE))).toMatchObject({ jmeno: "required-empty", narozeni: "required-empty", telefon: "skipped-optional" });
  });

  it("a failed re-read confirms nothing: every field is unconfirmed, except a page error already shown", () => {
    const rows = account(structure, wizard, { jmeno: "Olena" }, null, NONE);
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(["unconfirmed"]));
  });

  it("a host that keeps its own record (a print-only PDF) cannot confirm a held answer, but still knows what is empty", () => {
    const rows = account(structure, wizard, { jmeno: "Olena" }, { jmeno: "Olena" }, NONE, { confirms: false });
    expect(status(rows)).toMatchObject({ jmeno: "unconfirmed", narozeni: "required-empty", telefon: "skipped-optional" });
  });
});
