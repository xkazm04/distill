// What makes running text comfortable to read (spark universal-core #1 "Fill the hole Clean leaves" and #6
// "Comfortable to read"): a measure of about 70 characters, text of at least 16 px, room between lines, contrast.
// Pure decisions from numbers the extension measures on the page; the page side applies them through CSS.

export const READING = {
  /** Text below this (px) is raised to `minSize`; a hair under 16 (15.5) counts as 16. */
  sizeFloor: 15.5,
  minSize: 16,
  /** Paragraphs with less room between lines than this (line-height / font-size) get `lineHeight`. */
  lineHeightFloor: 1.4,
  lineHeight: 1.5,
  /** r5-05: paragraphs with more room than this between lines read as separate lines: they get `leadingFor`. */
  lineHeightCeiling: 2.2,
  /** Characters per line: the target, the most a column is widened to, and when a line is too long. */
  measure: 70,
  maxMeasure: 75,
  longLine: 85,
  /** WCAG 2 AA: normal text, and large text (24 px, or 18.66 px bold). */
  contrast: 4.5,
  contrastLarge: 3,
} as const;

/** WCAG's large text: 18 pt (24 px), or 14 pt (18.66 px) bold. */
export const isLargeText = (sizePx: number, weight: number): boolean => sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);

/**
 * The width (px) a column box should take once the room beside it is free. `box`: its width now; `text`: the width of
 * its running text (the box minus its padding and insets); `avgChar`: the text's average character width; `room`: the
 * free band it may grow into. The text grows towards `measure` characters, never past `maxMeasure`, never past the
 * room, and the box never gets narrower than it is.
 */
export function columnWidth(m: { box: number; text: number; avgChar: number; room: number }): number {
  if (!(m.avgChar > 0) || m.text <= 0) return m.box;
  const inset = Math.max(0, m.box - m.text);
  const want = READING.measure * m.avgChar;
  if (m.text >= want) return m.box;
  const w = Math.min(m.box + (want - m.text), m.room, READING.maxMeasure * m.avgChar + inset);
  return Math.max(m.box, Math.floor(w));
}

/** The font size carrying most of the characters (the block's running text, not its footnotes). */
export function dominantSize(samples: readonly { size: number; chars: number }[]): number {
  const by = new Map<number, number>();
  for (const s of samples) if (s.chars > 0 && s.size > 0) by.set(Math.round(s.size * 10) / 10, (by.get(Math.round(s.size * 10) / 10) ?? 0) + s.chars);
  let best = 0, most = -1;
  for (const [size, chars] of by) if (chars > most || (chars === most && size < best)) { best = size; most = chars; }
  return best;
}

/** How much a block's text grows: 1 when its running text is large enough. */
export const sizeScale = (dominant: number): number => (dominant > 0 && dominant < READING.sizeFloor ? READING.minSize / dominant : 1);

/**
 * The line height (px) a run of text should get, or null to leave it. `lineHeight` is the computed px value (null for
 * `normal`, about 1.2). Paragraph text gets `READING.lineHeight` when it is cramped; any text whose size grew by
 * `scale` keeps at least its own proportion, so bigger text never overlaps its lines.
 */
export function lineHeightFor(m: { size: number; lineHeight: number | null; scale: number; paragraph: boolean }): number | null {
  const newSize = m.size * m.scale;
  const round = (n: number) => Math.round(n * 10) / 10;
  const want = leadingFor(newSize);
  // `normal` follows the font size by itself, and is about 1.2: cramped for a paragraph.
  if (m.lineHeight === null) return m.paragraph ? round(want * newSize) : null;
  let lh = m.lineHeight * m.scale;
  const ratio = lh / newSize;
  if (m.paragraph && (ratio < want - (READING.lineHeight - READING.lineHeightFloor) || ratio > READING.lineHeightCeiling)) lh = want * newSize;
  return Math.abs(lh - m.lineHeight) < 0.5 ? null : round(lh);
}

/**
 * r5-05: the room between lines (line-height / font-size) running text of `size` px reads best with: 1.5 up to 18 px,
 * less as the text grows (a large line needs less room to be followed), 1.3 from 32 px. Headings use `headingLeading`.
 */
export function leadingFor(size: number): number {
  if (!(size > 18)) return READING.lineHeight;
  if (size >= 32) return 1.3;
  return Math.round((READING.lineHeight - ((size - 18) / 14) * 0.2) * 1000) / 1000;
}

/** A heading's room between lines: tighter than text (it is read as one unit), 1.25 at most. */
export const headingLeading = (size: number): number => Math.min(1.25, leadingFor(size));

/** A heading's line height is outside the comfortable range (ratio of line-height to size) once it wraps. */
export const headingLeadingOff = (ratio: number): boolean => ratio < 1.0 || ratio > 1.7;

/**
 * r5-05: the space around a heading in the main text, or null when its rhythm is fine. `above` and `below`: the gaps
 * (px) to the text before and after it as laid out now; `text`: the size (px) of the running text. A heading belongs to
 * the text it opens: the space above it is at least the space below it, there is some room above, and it does not
 * touch its text. Out of that range it gets about 1.6 lines of text above and half a line below (never less above
 * than it had, never more below).
 */
export function headingSpace(m: { above: number | null; below: number | null; text: number }): { above: number | null; below: number | null } | null {
  if (!(m.text > 0)) return null;
  const { above, below, text } = m;
  const cramped = above !== null && above < 0.5 * text;
  const touching = below !== null && below < 0.15 * text;
  const apart = above !== null && below !== null && above < below - 1;
  if (!cramped && !touching && !apart) return null;
  const wantAbove = Math.round(1.6 * text);
  const wantBelow = Math.round(0.5 * text);
  const a = above === null ? null : Math.max(above, cramped || apart ? wantAbove : above);
  let b = below === null ? null : below;
  if (b !== null && (touching || apart)) b = touching ? wantBelow : Math.min(b, wantBelow);
  // Whatever was changed, the heading ends closer to its own text than to the text before it.
  if (a !== null && b !== null && a < b) b = Math.min(b, Math.round(a / 2));
  return { above: a === above ? null : a, below: b === below ? null : b };
}

/** r5-05: the gap (px) to give between two paragraphs of `size` px text that (almost) touch, or null when they don't. */
export function paragraphGap(m: { size: number; gap: number }): number | null {
  return m.size > 0 && m.gap < 0.4 * m.size ? Math.round(0.8 * m.size) : null;
}

/** r5-05: a table cell holding a number (an amount, a count, a share, a measurement, a price): "1 250 Kč", "-3,5 %", "€12.40". */
const NUMBER = /^[\s(]*(?:[-+\u2212\u2013]\s?)?(?:\p{Sc}\s?)?\d[\d\s.,'\u00a0\u202f]*(?:\s?(?:%|\u2030|\p{Sc}|K\u010d|CZK|EUR|USD|kg|g|km|m|cm|mm|m2|m\u00b2|l|ks|h|hod\.?|min|s|\u00b0C|tis\.?|mil\.?|mld\.?|,-|,\u2013|\.-))?[\s)*]*$/u;
export const numericText = (s: string): boolean => s.length <= 40 && NUMBER.test(s.trim());

/** r5-05: which columns of a data table hold numbers: at least two cells with text, and 80% of them numbers. */
export function numericColumns(columns: readonly (readonly string[])[]): boolean[] {
  return columns.map((cells) => {
    // A dash is an empty cell (nothing there), not a word.
    const filled = cells.map((c) => c.trim()).filter((c) => c && !/^[-–—]$/.test(c));
    return filled.length >= 2 && filled.filter(numericText).length >= 0.8 * filled.length;
  });
}

/** A max-width (px) for a block whose lines run past `longLine` characters, or null when its lines are fine. */
export function measureFor(m: { width: number; avgChar: number }): number | null {
  if (!(m.avgChar > 0)) return null;
  return m.width / m.avgChar > READING.longLine ? Math.round(READING.maxMeasure * m.avgChar) : null;
}
