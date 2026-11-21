import { describe, expect, it } from "vitest";
import { READING, columnWidth, dominantSize, isLargeText, lineHeightFor, measureFor, sizeScale } from "../src/index.js";

describe("columnWidth (fill the hole Clean leaves)", () => {
  it("grows a squeezed column towards 70 characters, inside the free room", () => {
    // 480 px of text at 9 px a character: 53 characters a line. 70 characters is 630 px of text.
    expect(columnWidth({ box: 520, text: 480, avgChar: 9, room: 1000 })).toBe(520 + 150);
    // Not past the room.
    expect(columnWidth({ box: 520, text: 480, avgChar: 9, room: 600 })).toBe(600);
  });

  it("never narrows a column, and leaves one that already reads at 70 characters", () => {
    expect(columnWidth({ box: 640, text: 640, avgChar: 9, room: 968 })).toBe(640); // 71 characters
    expect(columnWidth({ box: 900, text: 900, avgChar: 7.5, room: 1200 })).toBe(900); // 120 characters: Comfort's job, not this one
    expect(columnWidth({ box: 640, text: 600, avgChar: 9, room: 500 })).toBe(640);
  });

  it("does nothing it cannot measure", () => {
    expect(columnWidth({ box: 500, text: 0, avgChar: 9, room: 900 })).toBe(500);
    expect(columnWidth({ box: 500, text: 480, avgChar: 0, room: 900 })).toBe(500);
  });
});

describe("comfort decisions", () => {
  it("takes the size most characters are set in", () => {
    expect(dominantSize([{ size: 10, chars: 400 }, { size: 13, chars: 30 }, { size: 16, chars: 20 }])).toBe(10);
    expect(dominantSize([])).toBe(0);
  });

  it("raises text under 16 px to 16 px, and leaves 16 px and up alone", () => {
    expect(sizeScale(12)).toBeCloseTo(16 / 12, 5);
    expect(sizeScale(10)).toBeCloseTo(1.6, 5);
    expect(sizeScale(15.6)).toBe(1);
    expect(sizeScale(18)).toBe(1);
    expect(sizeScale(0)).toBe(1);
  });

  it("gives cramped paragraphs 1.5, keeps the proportion of grown text, and leaves good spacing alone", () => {
    expect(lineHeightFor({ size: 16, lineHeight: 18, scale: 1, paragraph: true })).toBe(24);
    expect(lineHeightFor({ size: 16, lineHeight: null, scale: 1, paragraph: true })).toBe(24);
    expect(lineHeightFor({ size: 18, lineHeight: 28, scale: 1, paragraph: true })).toBeNull(); // Deník: 1.56
    expect(lineHeightFor({ size: 16, lineHeight: 23, scale: 1, paragraph: true })).toBeNull(); // 1.44: fine as it is
    // A heading of 20 px on a page whose 12 px text grows to 16 px: 24 px lines become 32 px.
    expect(lineHeightFor({ size: 20, lineHeight: 24, scale: 16 / 12, paragraph: false })).toBe(32);
    expect(lineHeightFor({ size: 20, lineHeight: null, scale: 16 / 12, paragraph: false })).toBeNull();
  });

  it("limits lines past 85 characters to 75", () => {
    expect(measureFor({ width: 900, avgChar: 7.5 })).toBe(Math.round(READING.maxMeasure * 7.5)); // 120 characters
    expect(measureFor({ width: 640, avgChar: 9 })).toBeNull(); // 71 characters
    expect(measureFor({ width: 640, avgChar: 0 })).toBeNull();
  });

  it("knows WCAG's large text", () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(19, 700)).toBe(true);
    expect(isLargeText(19, 400)).toBe(false);
    expect(isLargeText(16, 700)).toBe(false);
  });
});
