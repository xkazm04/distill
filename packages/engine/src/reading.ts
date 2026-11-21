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
  // `normal` follows the font size by itself, and is about 1.2: cramped for a paragraph.
  if (m.lineHeight === null) return m.paragraph ? round(READING.lineHeight * newSize) : null;
  let lh = m.lineHeight * m.scale;
  if (m.paragraph && lh / newSize < READING.lineHeightFloor) lh = READING.lineHeight * newSize;
  return Math.abs(lh - m.lineHeight) < 0.5 ? null : round(lh);
}

/** A max-width (px) for a block whose lines run past `longLine` characters, or null when its lines are fine. */
export function measureFor(m: { width: number; avgChar: number }): number | null {
  if (!(m.avgChar > 0)) return null;
  return m.width / m.avgChar > READING.longLine ? Math.round(READING.maxMeasure * m.avgChar) : null;
}
