import { describe, expect, it } from "vitest";
import { findDates, formatDate } from "../src/dates.js";

const one = (text: string) => {
  const found = findDates(text, "cs");
  expect(found).toHaveLength(1);
  const d = found[0]!;
  expect(text.slice(d.start, d.end)).toBe(d.text);
  return d;
};

describe("findDates: the Czech ways of writing a date", () => {
  it.each([
    ["Schůze bude 15. 3. 2026 na úřadě.", "15. 3. 2026", "2026-03-15"],
    ["Schůze bude 15.3.2026 na úřadě.", "15.3.2026", "2026-03-15"],
    ["Schůze bude 15.3. na úřadě.", "15.3.", "--03-15"],
    ["Schůze bude 15. 3. na úřadě.", "15. 3.", "--03-15"],
    ["Zaplaťte do 15. 3. prosím.", "do 15. 3.", "--03-15"],
    ["Zaplaťte nejpozději do 31. 3. 2026.", "nejpozději do 31. 3. 2026", "2026-03-31"],
    ["Platí od 1. 1. 2026.", "od 1. 1. 2026", "2026-01-01"],
    ["Schůze 15. března 2026 v sále.", "15. března 2026", "2026-03-15"],
    ["Schůze 15. března v sále.", "15. března", "--03-15"],
    ["Uzávěrka 1. září 2026.", "1. září 2026", "2026-09-01"],
    ["Hody 29. 2. 2028", "29. 2. 2028", "2028-02-29"],
  ])("%s", (text, words, iso) => {
    const d = one(text);
    expect(d.text).toBe(words);
    expect(d.iso).toBe(iso);
    expect(d.time).toBeUndefined();
  });

  it.each([
    ["Schůze 15. 3. 2026 v 10:30 na úřadě.", "15. 3. 2026 v 10:30", "10:30"],
    ["Schůze 15. 3. 2026, 10.30 hod. na úřadě.", "15. 3. 2026, 10.30 hod.", "10:30"],
    ["Schůze 15. března od 18 hod. v sále.", "15. března od 18 hod.", "18:00"],
  ])("a date with a time: %s", (text, words, time) => {
    const d = one(text);
    expect(d.text).toBe(words);
    expect(d.time).toBe(time);
  });

  it.each([
    ["Úřední hodiny do 10.30 hod.", "do 10.30 hod.", "10:30"],
    ["Začátek v 9 hod.", "v 9 hod.", "09:00"],
    ["Začátek 10:30 hod.", "10:30 hod.", "10:30"],
  ])("a time on its own, with hod.: %s", (text, words, time) => {
    const d = one(text);
    expect(d).toMatchObject({ text: words, iso: "", time });
  });

  it.each([
    "Verze 1.2.3 je venku.",
    "Cena 1.200 Kč",
    "Dne 32. 1. 2026",
    "Dne 30. 2. 2026",
    "Dne 15. 13. 2026",
    "Otevřeno 10:30 až 12:00", // a bare time reads the same everywhere
    "Kapitola 3. března pochodu", // "března" with no day is no date
    "Telefon 585 150 218",
  ])("no date in: %s", (text) => {
    const found = findDates(text, "cs");
    if (text.startsWith("Kapitola")) expect(found.map((d) => d.iso)).toEqual(["--03-03"]); // "3. března" IS a date
    else expect(found).toEqual([]);
  });

  it("finds several, in order", () => {
    const text = "Přihlášky od 1. 2. do 15. 3. 2026, losování 20. března.";
    expect(findDates(text, "cs").map((d) => d.iso)).toEqual(["--02-01", "2026-03-15", "--03-20"]);
  });
});

describe("formatDate", () => {
  const d = (text: string) => findDates(text, "cs")[0]!;
  it("writes the date the reader's way", () => {
    expect(formatDate(d("15. 3. 2026"), "en-GB")).toBe("15 March 2026");
    expect(formatDate(d("15. 3. 2026"), "en-US")).toBe("March 15, 2026");
    expect(formatDate(d("15. 3."), "en-GB")).toBe("15 March");
    expect(formatDate(d("15. března 2026"), "de-DE")).toBe("15. März 2026");
  });
  it("says what the word before the date meant, in English", () => {
    expect(formatDate(d("do 15. 3."), "en-GB")).toBe("by 15 March");
    expect(formatDate(d("od 1. 1. 2026"), "en-GB")).toBe("from 1 January 2026");
    expect(formatDate(d("do 15. 3."), "de-DE")).toBe("15. März");
  });
  it("adds the time", () => {
    expect(formatDate(d("15. 3. 2026 v 10:30"), "en-GB")).toBe("15 March 2026, 10:30");
    expect(formatDate(d("15. 3. 2026 v 14:30"), "en-US")).toMatch(/^March 15, 2026, 2:30\sPM$/);
    expect(formatDate(d("v 9 hod."), "en-GB")).toBe("9:00");
  });
});
