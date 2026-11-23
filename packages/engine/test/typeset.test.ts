// r5-05: the typesetter's numbers (engine reading.ts): line height by size, heading rhythm, paragraph gaps, numbers.
import { describe, expect, it } from "vitest";
import { headingLeading, headingLeadingOff, headingSpace, leadingFor, lineHeightFor, numericColumns, numericText, paragraphGap } from "../src/index.js";

describe("line height by size (r5-05)", () => {
  it("is 1.5 up to 18 px and closes to 1.3 at 32 px", () => {
    expect(leadingFor(12)).toBe(1.5);
    expect(leadingFor(18)).toBe(1.5);
    expect(leadingFor(25)).toBeCloseTo(1.4, 3);
    expect(leadingFor(32)).toBe(1.3);
    expect(leadingFor(60)).toBe(1.3);
    expect(headingLeading(16)).toBe(1.25);
    expect(headingLeading(40)).toBe(1.25);
  });

  it("gives large cramped text less than 1.5, and pulls apart lines that float", () => {
    // 24 px text at 1.2: cramped; it gets about 1.41, not 1.5.
    expect(lineHeightFor({ size: 24, lineHeight: 28.8, scale: 1, paragraph: true })).toBe(Math.round(leadingFor(24) * 24 * 10) / 10);
    // 24 px at 1.35 is fine for that size (the floor follows the size).
    expect(lineHeightFor({ size: 24, lineHeight: 32.4, scale: 1, paragraph: true })).toBeNull();
    // 16 px at 2.5: lines read as separate lines.
    expect(lineHeightFor({ size: 16, lineHeight: 40, scale: 1, paragraph: true })).toBe(24);
    expect(lineHeightFor({ size: 16, lineHeight: 32, scale: 1, paragraph: true })).toBeNull(); // 2.0: loose, still fine
    // Not running text: never touched for being loose.
    expect(lineHeightFor({ size: 16, lineHeight: 40, scale: 1, paragraph: false })).toBeNull();
  });

  it("knows a heading's line height out of range", () => {
    expect(headingLeadingOff(0.9)).toBe(true);
    expect(headingLeadingOff(1.2)).toBe(false);
    expect(headingLeadingOff(1.6)).toBe(false);
    expect(headingLeadingOff(1.9)).toBe(true);
  });
});

describe("heading rhythm (r5-05)", () => {
  it("leaves a heading with more room above than below alone, and equal room too", () => {
    expect(headingSpace({ above: 32, below: 8, text: 16 })).toBeNull();
    expect(headingSpace({ above: 21, below: 21, text: 17 })).toBeNull(); // the browser's own margins
    expect(headingSpace({ above: null, below: 10, text: 16 })).toBeNull();
  });

  it("moves a heading towards its own text when it sits closer to the text before it", () => {
    const fix = headingSpace({ above: 8, below: 30, text: 16 });
    expect(fix).toEqual({ above: 26, below: 8 });
    // Never less room above than it had.
    expect(headingSpace({ above: 30, below: 40, text: 16 })).toEqual({ above: null, below: 8 });
  });

  it("gives a cramped heading room above, and one that touches its text a little room below", () => {
    expect(headingSpace({ above: 2, below: 6, text: 16 })).toEqual({ above: 26, below: null });
    expect(headingSpace({ above: 30, below: 0, text: 16 })).toEqual({ above: null, below: 8 });
    expect(headingSpace({ above: 0, below: 0, text: 16 })).toEqual({ above: 26, below: 8 });
  });

  it("does nothing without a text size", () => {
    expect(headingSpace({ above: 0, below: 40, text: 0 })).toBeNull();
  });
});

describe("paragraph gaps (r5-05)", () => {
  it("opens paragraphs that touch and leaves spaced ones alone", () => {
    expect(paragraphGap({ size: 16, gap: 0 })).toBe(13);
    expect(paragraphGap({ size: 16, gap: 6 })).toBe(13);
    expect(paragraphGap({ size: 16, gap: 7 })).toBeNull();
    expect(paragraphGap({ size: 16, gap: 60 })).toBeNull();
  });
});

describe("numbers in tables (r5-05)", () => {
  it("reads amounts, counts, shares and measurements as numbers", () => {
    for (const s of ["12", "1 250 Kč", "1 250,50 Kč", "-3,5 %", "− 12", "€12.40", "$ 1,200", "350,-", "12 km", "(4)", "2024", "15 min", "3.5 m²", "12. 3. 2024"]) {
      expect(numericText(s), s).toBe(true);
    }
    for (const s of ["", "Praha", "12 jablek a hrušek", "ano", "A12", "do 12", "see p. 4", "1 250 Kč za den a více, podle délky výpůjčky"]) {
      expect(numericText(s), s).toBe(false);
    }
  });

  it("finds the columns that hold numbers", () => {
    expect(numericColumns([
      ["Přívěs malý", "Přívěs velký", "Vozík"],
      ["350 Kč", "550 Kč", ""],
      ["1", "2", "-"],
      ["5"],
    ])).toEqual([false, true, true, false]);
  });
});
