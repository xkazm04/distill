// From PDF fields to the fields of a FormStructure: a label a person can read, the right kind, and pieces that belong
// together read as one answer (a date in three boxes, a postcode in five). PDF field names are often cryptic
// ("Text12", "ctl00_f1"), so the label comes from the field's tooltip when it has a usable one, else from the text
// printed beside its box: on its left, above it, inside its top edge, or (for a tick box) on its right.
import type { FieldKind, FieldOption, FieldStructure } from "@distill/engine";
import type { RawField } from "./fields.js";
import { bottom, collapse, fold, isHeading, bodySize, top, type Run } from "./text.js";
import type { Box, DatePart, PdfBinding } from "./types.js";

// ---------------------------------------------------------------- words and names

/** Trailing ":" and "*", dot leaders and underscores for handwriting go; a leading "*" too. */
export function cleanLabel(s: string): string {
  return collapse(s)
    .replace(/[\s.…_]{3,}$/u, "")
    .replace(/\s*[*:]+\s*$/u, "")
    .replace(/^\*\s*/u, "")
    .trim();
}

const marksRequired = (s: string): boolean => /\*\s*:?\s*$/u.test(collapse(s)) || /^\*/u.test(collapse(s));

/** The last part of a fully qualified name, without XFA-style indexes: "form1[0].p1[0].Jmeno[0]" -> "Jmeno". */
export const shortName = (name: string): string => (name.split(".").pop() ?? name).replace(/\[\d+\]/g, "").trim();

/**
 * A name a form tool gave a field, not a person: "Text12", "Text Field 3", "Check Box2", "ctl00_f1", "f1_23",
 * "Group1", "untitled5", "Pole12", "undefined_2" (what automatic field detection writes when it found no name),
 * or nothing but digits and punctuation.
 */
export function isCryptic(name: string): boolean {
  const n = shortName(name);
  if (!/\p{L}{2,}/u.test(n)) return true;
  return /^(text|textfield|text ?field|text ?box|field|txt|tf|t|fill|fill_text|check ?box|checkbox|cb|chk|radio|radio ?button|rb|group|combo ?box|combobox|list ?box|dropdown|drop ?down|untitled|unnamed|undefined|null|none|pole|textov[eé] ?pole|button|btn|ctl\d*|f|p\d+|page\d*|form\d*|topmostsubform|subform)[\s_.-]*[\d_.-]*$/iu.test(n) ||
    /^ctl\d+/iu.test(n) || /^f\d+[_\d-]*$/iu.test(n);
}

const PARTS: DatePart[] = ["day", "month", "year"];
/** Words that name a date part, folded (no diacritics), in the corridor's languages and their neighbours. */
const PART_WORDS: Record<DatePart, Set<string>> = {
  day: new Set(["day", "dd", "den", "dag", "tag", "tt", "jour", "jj", "dia", "dzien", "день", "d"]),
  month: new Set(["month", "mm", "mesic", "monat", "mois", "mes", "miesiac", "місяць", "месяц", "m"]),
  year: new Set(["year", "yyyy", "yy", "rok", "rrrr", "rr", "jahr", "jjjj", "annee", "ano", "rik", "рік", "год", "r"]),
};
const words = (s: string): string[] =>
  s.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function partIn(s: string): DatePart | "" {
  const found = new Set(words(s).flatMap((w) => PARTS.filter((p) => PART_WORDS[p].has(w) && (w.length > 1 || s.trim().length <= 2))));
  return found.size === 1 ? ([...found][0] as DatePart) : "";
}
const onlyPartWords = (s: string): boolean => {
  const w = words(s);
  return w.length > 0 && w.every((x) => PARTS.some((p) => PART_WORDS[p].has(x)));
};
/** A label that speaks of a date: "Datum narození", "Platnost do", "Date of birth". */
const DATEISH = /(datum|date|narozen|platnost|dne\b|od\b|do\b|ode dne|termin|termín|birth|дата)/iu;

/** "1.", "a)", "(3)", "II." printed before a label: a number, not a name. */
const ENUMERATOR = /^\(?([0-9]{1,3}|[a-z]|[ivx]{1,4})[.)]\)?$/iu;

// ---------------------------------------------------------------- geometry

const vOverlap = (r: Run, b: Box): number => Math.min(top(r), b.y2) - Math.max(bottom(r), b.y1);
const sameLine = (r: Run, b: Box): boolean => {
  const h = top(r) - bottom(r);
  const mid = (r.y + top(r)) / 2;
  return vOverlap(r, b) >= 0.5 * Math.min(h, b.y2 - b.y1) || (mid >= b.y1 - 1 && mid <= b.y2 + 1);
};

interface Geo {
  runs: Run[];
  /** Every visible widget of every fillable field, with the field it belongs to. */
  widgets: { box: Box; name: string; tick: boolean }[];
  /** Lazily: the printed text of each tick box and radio option (with the lines it wraps onto), and whose it is. */
  tickText?: Map<Run, Set<string>>;
}

/** True when some other widget sits between x0 and x1 on the line of `b`. */
function widgetBetweenX(g: Geo, b: Box, x0: number, x1: number, self: string): boolean {
  return g.widgets.some((w) => w.name !== self && w.box.page === b.page && w.box.x1 >= x0 - 0.5 && w.box.x2 <= x1 + 0.5 &&
    Math.min(w.box.y2, b.y2) - Math.max(w.box.y1, b.y1) > 0.3 * Math.min(w.box.y2 - w.box.y1, b.y2 - b.y1));
}
/** True when some other widget sits between y0 (lower) and y1 (upper) under or over the columns of `b`. */
function widgetBetweenY(g: Geo, b: Box, y0: number, y1: number, self: string): boolean {
  return g.widgets.some((w) => w.name !== self && w.box.page === b.page && w.box.y1 >= y0 - 0.5 && w.box.y2 <= y1 + 0.5 &&
    w.box.x1 < b.x2 && w.box.x2 > b.x1);
}

/** Printed underscores or dots for handwriting: what a field drawn over a printed line covers. */
const FILLER = /[_.…]{3,}/gu;
const hasWords = (s: string): boolean => /[\p{L}\p{N}]/u.test(s.replace(FILLER, ""));

/** The runs printed left of the box, on its line, with no other field between, nearest first. Runs with no letter
 *  (underscores, dots, a printed prefix such as "+ 420") are not labels. */
function leftRuns(g: Geo, b: Box, self: string, maxGap = 320): { run: Run; gap: number }[] {
  const out: { run: Run; gap: number }[] = [];
  for (const r of g.runs) {
    if (r.page !== b.page || r.x1 > b.x1 + 2 || !sameLine(r, b)) continue;
    const gap = b.x1 - r.x1;
    if (gap > maxGap || ENUMERATOR.test(r.text) || !/\p{L}/u.test(r.text.replace(FILLER, ""))) continue; // "+ 420", "____": not a label
    if (widgetBetweenX(g, b, r.x1, b.x1, self)) continue;
    out.push({ run: r, gap });
  }
  return out.sort((p, q) => p.gap - q.gap);
}

/** The run printed just left of the box, on its line, with no other field between. */
const leftOf = (g: Geo, b: Box, self: string, maxGap = 320): { run: Run; gap: number } | null => leftRuns(g, b, self, maxGap)[0] ?? null;

/**
 * A label printed on the box's line that runs into the box: "Sídlo: ______" where the field is drawn over the
 * underscores. The label is the text just before the stretch of underscores or dots under the box, and must end
 * before the box starts. Positions inside a run are estimated from character counts.
 */
function inlineOf(g: Geo, b: Box): string {
  for (const r of g.runs) {
    if (r.page !== b.page || r.x0 >= b.x1 - 2 || r.x1 <= b.x1 + 2 || !sameLine(r, b)) continue;
    const text = r.text;
    const at = (i: number): number => r.x0 + ((r.x1 - r.x0) * i) / text.length;
    let from = 0;
    for (const m of text.matchAll(FILLER)) {
      const s = m.index ?? 0;
      const e = s + m[0].length;
      if (at(e) > b.x1 && at(s) < b.x2) {
        const label = text.slice(from, s);
        if (hasWords(label) && at(s) <= b.x1 + 0.5 * r.size) return label;
        break;
      }
      from = e;
    }
  }
  return "";
}

/**
 * A label printed inside its own box, at its left and on its middle line: a field drawn over its label (what automatic
 * field detection does to a table cell that holds the label and the space for the answer).
 */
function insideLeftOf(g: Geo, b: Box): Run | null {
  const w = b.x2 - b.x1;
  const inside = g.runs.filter((r) => {
    const mid = (r.y + top(r)) / 2;
    return r.page === b.page && r.x0 >= b.x1 - 1 && r.x0 <= b.x1 + Math.max(12, 0.1 * w) && r.x1 <= b.x1 + 0.7 * w &&
      mid >= b.y1 && mid <= b.y2 && r.size <= b.y2 - b.y1 && hasWords(r.text) && !ENUMERATOR.test(r.text);
  });
  return inside.sort((p, q) => q.y - p.y)[0] ?? null;
}

/**
 * The text printed right of each tick box and radio option, with the lines it wraps onto (runs below it that start
 * where it starts, closely spaced, until a line that has a box of its own), mapped to the fields it belongs to.
 */
function tickTexts(g: Geo): Map<Run, Set<string>> {
  if (g.tickText) return g.tickText;
  const out = new Map<Run, Set<string>>();
  const add = (r: Run, name: string) => (out.get(r) ?? out.set(r, new Set()).get(r) as Set<string>).add(name);
  const startsOwnLine = (r: Run): boolean => g.widgets.some((w) => w.tick && w.box.page === r.page && sameLine(r, w.box) && w.box.x2 <= r.x0 + 2 && r.x0 - w.box.x2 <= 60);
  for (const w of g.widgets) {
    if (!w.tick) continue;
    const first = rightOf(g, w.box, w.name);
    if (!first) continue;
    add(first, w.name);
    let cur = first;
    for (let k = 0; k < 6; k++) {
      const next = g.runs.find((r) => r !== cur && r.page === cur.page && Math.abs(r.x0 - first.x0) <= 3 && cur.y - r.y > 0.5 * cur.size &&
        cur.y - r.y <= 1.5 * cur.size && !startsOwnLine(r));
      if (!next) break;
      add(next, w.name);
      cur = next;
    }
  }
  g.tickText = out;
  return out;
}

/**
 * True when the run is already the label of another field: the text of another tick box or radio option, or
 * printed on that field's line just left of its box or
 * running into it, or printed tightly above its box and aligned with its left edge (a box-style form). Such a run is
 * not the label of another box near it; taking it would ask the other field's question.
 */
function ownedByOther(g: Geo, r: Run, self: string): boolean {
  const ticks = tickTexts(g).get(r);
  if (ticks && [...ticks].some((n) => n !== self)) return true;
  return g.widgets.some((w) => {
    if (w.name === self || w.box.page !== r.page) return false;
    const b = w.box;
    if (sameLine(r, b) && r.x0 < b.x1 + 2 && (r.x1 > b.x1 - 2 || b.x1 - r.x1 <= 24) && !widgetBetweenX(g, b, r.x1, b.x1, w.name)) return true;
    const gap = bottom(r) - b.y2;
    return Math.abs(r.x0 - b.x1) <= 10 && r.x0 < b.x2 && gap >= -0.6 * r.size && gap <= 0.8 * r.size + 3;
  });
}

/** The run printed just right of the box, close to it, with no other field between. */
function rightOf(g: Geo, b: Box, self: string, maxGap = 60): Run | null {
  let best: { run: Run; gap: number } | null = null;
  for (const r of g.runs) {
    if (r.page !== b.page || r.x0 < b.x2 - 2 || !sameLine(r, b)) continue;
    const gap = r.x0 - b.x2;
    if (gap > maxGap || ENUMERATOR.test(r.text)) continue;
    if (widgetBetweenX(g, b, b.x2, r.x0, self)) continue;
    if (!best || gap < best.gap) best = { run: r, gap };
  }
  return best?.run ?? null;
}

/** The run printed just above the box, starting within its width, with no other field between. */
function aboveOf(g: Geo, b: Box, self: string): { run: Run; gap: number; aligned: boolean } | null {
  let best: { run: Run; gap: number; aligned: boolean } | null = null;
  for (const r of g.runs) {
    if (r.page !== b.page) continue;
    const gap = bottom(r) - b.y2;
    if (gap < -0.35 * r.size || gap > Math.max(14, 1.8 * r.size)) continue;
    if (r.x0 < b.x1 - 8 || r.x0 > b.x2 - 4) continue;
    if (ENUMERATOR.test(r.text) || widgetBetweenY(g, b, b.y2, bottom(r), self) || ownedByOther(g, r, self)) continue;
    const aligned = Math.abs(r.x0 - b.x1) <= 10;
    if (!best || gap < best.gap - 0.5 || (Math.abs(gap - best.gap) <= 0.5 && Math.abs(r.x0 - b.x1) < Math.abs(best.run.x0 - b.x1))) best = { run: r, gap, aligned };
  }
  return best;
}

/**
 * The label above the box with the lines it wraps from: runs above it, closely spaced, that start where it starts, or
 * that form one block with it over the box (a column header on two lines, each line placed on its own).
 */
function aboveLabel(g: Geo, first: Run, b: Box): string {
  const parts = [first];
  let cur = first;
  const overBox = (r: Run): boolean => r.x0 >= b.x1 - 8 && r.x1 <= b.x2 + 8;
  const block = (r: Run, c: Run): boolean => overBox(r) && overBox(c) && Math.min(r.x1, c.x1) - Math.max(r.x0, c.x0) >= 0.5 * Math.min(r.x1 - r.x0, c.x1 - c.x0);
  for (;;) {
    const prev = g.runs.find((r) => r !== cur && r.page === cur.page && (Math.abs(r.x0 - first.x0) <= 3 || block(r, cur)) && r.y - cur.y > 0.5 * cur.size &&
      r.y - cur.y <= 1.5 * cur.size && Math.abs(r.size - cur.size) < 0.6);
    if (!prev || parts.length >= 3) break;
    parts.unshift(prev);
    cur = prev;
  }
  return parts.map((r) => r.text).join(" ");
}

/**
 * The short run printed just under the box (a signature line: "Místo", "Dne" under it), unless that run sits right
 * above another box, whose label it then is.
 */
function belowOf(g: Geo, b: Box, self: string): Run | null {
  const near = g.runs.filter((r) => r.page === b.page && top(r) <= b.y1 + 1 && b.y1 - top(r) <= Math.max(8, 1.2 * r.size) &&
    r.x0 >= b.x1 - 4 && r.x0 < b.x2 && r.text.length <= 40 && !ENUMERATOR.test(r.text) && !onlyPartWords(r.text))
    .sort((p, q) => q.y - p.y);
  for (const r of near) {
    const owns = g.widgets.some((w) => w.name !== self && w.box.page === r.page && w.box.y2 <= bottom(r) + 1 && bottom(r) - w.box.y2 <= Math.max(14, 1.8 * r.size) &&
      w.box.x1 < r.x1 && w.box.x2 > r.x0);
    if (!owns) return r;
  }
  return null;
}

/** A small caption printed inside the box near its top-left corner (box-style forms). */
function captionIn(g: Geo, b: Box): Run | null {
  const h = b.y2 - b.y1;
  const inside = g.runs.filter((r) => r.page === b.page && r.x0 >= b.x1 - 1 && r.x0 <= b.x1 + Math.max(40, 0.3 * (b.x2 - b.x1)) &&
    bottom(r) >= b.y1 + 0.35 * h && top(r) <= b.y2 + 2 && r.size <= 0.6 * h);
  return inside.sort((p, q) => q.y - p.y)[0] ?? null;
}

/** The short run printed just under a box (a "den", "měsíc", "rok" under the pieces of a date). */
function underOf(g: Geo, b: Box): Run | null {
  const near = g.runs.filter((r) => r.page === b.page && top(r) <= b.y1 + 2 && b.y1 - top(r) <= 10 && r.x0 < b.x2 && r.x1 > b.x1 && r.text.length <= 12);
  return near.sort((p, q) => q.y - p.y)[0] ?? null;
}

/**
 * The left label, with the lines of a label that wraps: further runs that start where it starts, follow it closely
 * downwards, and still sit beside the box.
 */
function leftLabel(g: Geo, b: Box, first: Run): string {
  const parts = [first];
  let cur = first;
  for (;;) {
    const next = g.runs.find((r) => r !== cur && r.page === cur.page && Math.abs(r.x0 - first.x0) <= 3 && cur.y - r.y > 0.5 * cur.size &&
      cur.y - r.y <= 1.5 * cur.size && r.y >= b.y1 - 2 && r.x1 <= b.x1 + 2);
    if (!next || parts.length >= 3) break;
    parts.push(next);
    cur = next;
  }
  return parts.map((r) => r.text).join(" ");
}

// ---------------------------------------------------------------- labels

/** Where a label was found: the tooltip, printed text beside the box, a column header, or only the field's name. */
type Source = "tooltip" | "left" | "right" | "above" | "caption" | "below" | "column" | "name";

interface Labelled {
  label: string;
  required: boolean;
  hint?: string;
  from: Source;
}

/** The tooltip when it is a usable label: not empty, not the field's own name, not cryptic, not a long instruction. */
function usableTooltip(f: RawField): string {
  const t = f.tooltip;
  if (!t || t === f.name || t === shortName(f.name) || isCryptic(t)) return "";
  return t;
}

function finish(raw: string, f: RawField, from: Source, extraRequired = false): Labelled {
  const label = cleanLabel(raw);
  return { label, required: f.required || extraRequired || marksRequired(raw), from };
}

/** The field's own name as a last resort: a readable name as it is, a cryptic one only because nothing else names it. */
const byName = (f: RawField): Labelled => finish(isCryptic(f.name) ? f.name : shortName(f.name).replace(/[_]+/g, " "), f, "name");

/** A tooltip the form tool cut short: a "(" that is never closed ("Jméno (First name"). */
const cutShort = (t: string): boolean => (t.match(/\(/g)?.length ?? 0) > (t.match(/\)/g)?.length ?? 0);

/** The label of a text or choice field (one box). */
function boxLabel(g: Geo, f: RawField, b: Box): Labelled {
  const tip = usableTooltip(f);
  if (tip && tip.length <= 80) {
    // A tooltip cut short gives way to the printed label it is the start of.
    if (cutShort(tip)) {
      const printed = printedLabel(g, f, b);
      if (printed.from !== "name" && cleanLabel(printed.raw).startsWith(cleanLabel(tip))) return finish(printed.raw, f, printed.from);
    }
    return finish(tip, f, "tooltip");
  }
  const hint = tip ? { hint: tip } : {};
  const { raw, from } = printedLabel(g, f, b);
  if (cleanLabel(raw)) return { ...finish(raw, f, from), ...hint };
  return { ...byName(f), ...hint };
}

/** The label printed around a box, and where it was found ("name" and "" when none). */
function printedLabel(g: Geo, f: RawField, b: Box): { raw: string; from: Source } {
  const left = leftOf(g, b, f.name);
  const above = aboveOf(g, b, f.name);
  const caption = captionIn(g, b);
  const inline = inlineOf(g, b);
  const inside = insideLeftOf(g, b);
  // Box-style forms print the label tightly above the box, aligned with its left edge; a label on the left wins
  // otherwise, as it does on most forms. A label in the box's own line (before the underscores the box covers, or
  // inside the box at its left) is the box's own and beats one above, which may be another row's. A label printed
  // under the box (a signature line) comes last. Text above that is already another field's label is never taken
  // (aboveOf): with nothing else, the field keeps its own name rather than ask another field's question.
  const tightAbove = above && above.aligned && above.gap <= 0.8 * above.run.size + 3;
  let raw = "";
  let from: Source = "name";
  if (left && left.gap <= 24) { raw = leftLabel(g, b, left.run); from = "left"; }
  else if (inline) { raw = inline; from = "left"; }
  else if (caption) { raw = caption.text; from = "caption"; }
  else if (inside) { raw = inside.text; from = "left"; }
  else if (tightAbove) { raw = aboveLabel(g, above.run, b); from = "above"; }
  else if (left) { raw = leftLabel(g, b, left.run); from = "left"; }
  else if (above) { raw = aboveLabel(g, above.run, b); from = "above"; }
  else {
    const below = belowOf(g, b, f.name);
    if (below) { raw = below.text; from = "below"; }
  }
  return cleanLabel(raw) ? { raw, from } : { raw: "", from: "name" };
}

/** The label of a tick box: tooltip, then the text on its right (how tick boxes are printed), then left, then above. */
function tickLabel(g: Geo, f: RawField, b: Box): Labelled {
  const tip = usableTooltip(f);
  if (tip && tip.length <= 120) return finish(tip, f, "tooltip");
  const right = rightOf(g, b, f.name);
  const left = leftOf(g, b, f.name, 200);
  // "[ ] Ano  [ ] Ne" and "Ano [ ]  Ne [ ]" are both printed: the text nearer the box is its label.
  const rightGap = right ? right.x0 - b.x2 : Infinity;
  if (right && (!left || rightGap <= left.gap)) return finish(right.text, f, "right");
  if (left) return finish(left.run.text, f, "left");
  const above = aboveOf(g, b, f.name);
  return above && cleanLabel(above.run.text) ? finish(above.run.text, f, "above") : byName(f);
}

/** The label of each option of a radio group: the text on its right, else on its left, else the export value. */
function optionLabels(g: Geo, f: RawField): FieldOption[] {
  const seen = new Set<string>();
  const out: FieldOption[] = [];
  f.widgets.forEach((w, i) => {
    const value = f.options?.[i]?.value ?? w.onValue ?? "";
    if (!value || seen.has(value)) return;
    seen.add(value);
    const right = rightOf(g, w.box, f.name);
    const left = leftOf(g, w.box, f.name, 60);
    const useRight = right && (!left || right.x0 - w.box.x2 <= left.gap);
    out.push({ value, label: cleanLabel(useRight ? right.text : left?.run.text ?? "") || value });
  });
  return out;
}

/** The label of a radio group: its tooltip, the text before the first option that is not an option's own label, or
 *  the text above it. */
function groupLabel(g: Geo, f: RawField, options: FieldOption[]): Labelled {
  const tip = usableTooltip(f);
  if (tip && tip.length <= 80) return finish(tip, f, "tooltip");
  const optionTexts = new Set(options.map((o) => o.label));
  const first = [...f.widgets].sort((p, q) => p.box.page - q.box.page || q.box.y2 - p.box.y2 || p.box.x1 - q.box.x1)[0];
  if (!first) return byName(f);
  const b = first.box;
  // On the left: the nearest run that is not an option's own label ("Question?  Ano [ ]  Ne [ ]": past the "Ano").
  const left = leftRuns(g, b, f.name).find((c) => !optionTexts.has(cleanLabel(c.run.text)));
  if (left) return finish(left.run.text, f, "left");
  const above = aboveOf(g, b, f.name);
  if (above && !optionTexts.has(cleanLabel(above.run.text))) return finish(aboveLabel(g, above.run, b), f, "above");
  // Above the whole group: the nearest run over the topmost widget, wherever it starts.
  const topW = Math.max(...f.widgets.map((w) => w.box.y2));
  const over = g.runs.filter((r) => r.page === b.page && bottom(r) >= topW - 1 && bottom(r) - topW <= 2 * r.size && r.x0 <= b.x1 + 4 &&
    !optionTexts.has(cleanLabel(r.text)) && !ownedByOther(g, r, f.name))
    .sort((p, q) => bottom(p) - bottom(q) || q.x0 - p.x0)[0]; // the lowest; of two on one line, the nearer one
  if (over) return finish(over.text, f, "above");
  return byName(f);
}

// ---------------------------------------------------------------- pieces that belong together

const single = (f: RawField): Box | null => (f.type === "text" && !f.multiline && f.widgets.length === 1 ? (f.widgets[0] as { box: Box }).box : null);
const lineMates = (a: Box, b: Box): boolean => a.page === b.page && Math.abs((a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2) <= 0.4 * Math.min(a.y2 - a.y1, b.y2 - b.y1);

/** A one-character box: maxLen 1, or a narrow box with no limit that sits in a row of equal boxes. */
const charBox = (f: RawField, b: Box): boolean => f.maxLen === 1 || (!f.maxLen && b.x2 - b.x1 <= 1.6 * (b.y2 - b.y1) && b.x2 - b.x1 <= 26);

/** Printed text between two boxes on a line that is only a separator ("/", "-", "."). */
function separatorBetween(g: Geo, a: Box, b: Box): boolean {
  return g.runs.some((r) => r.page === a.page && r.x0 >= a.x2 - 1 && r.x1 <= b.x1 + 1 && sameLine(r, a) && /^[/.\-–]$/u.test(r.text));
}

interface Group {
  members: RawField[];
  via: "chars" | "date";
  parts?: DatePart[];
}

/**
 * Runs of adjacent one-line text fields that are one answer: three boxes for day, month and year (named so by their
 * tooltip, name or the word printed under them, or sized 2-2-4 under a label that speaks of a date), and rows of
 * one-character boxes (a postcode, a birth number; a printed "/" between two rows joins them).
 */
function groups(g: Geo, fields: RawField[]): Group[] {
  const out: Group[] = [];
  const used = new Set<RawField>();
  const order = fields.filter((f) => single(f)).sort((p, q) => {
    const a = single(p) as Box, b = single(q) as Box;
    return a.page - b.page || (lineMates(a, b) ? a.x1 - b.x1 : b.y2 - a.y2);
  });
  // Dates first: three neighbours on one line.
  for (let i = 0; i + 2 < order.length; i++) {
    const trio = order.slice(i, i + 3);
    if (trio.some((f) => used.has(f))) continue;
    const boxes = trio.map((f) => single(f) as Box);
    if (!lineMates(boxes[0] as Box, boxes[1] as Box) || !lineMates(boxes[1] as Box, boxes[2] as Box)) continue;
    const gaps = [(boxes[1] as Box).x1 - (boxes[0] as Box).x2, (boxes[2] as Box).x1 - (boxes[1] as Box).x2];
    if (gaps.some((gap) => gap < -1 || gap > 40)) continue;
    if (trio.some((f, k) => widgetBetweenX(g, boxes[k] as Box, (boxes[k] as Box).x2, (boxes[k + 1] ?? boxes[k] as Box).x1, f.name) && k < 2)) continue;
    let parts = trio.map((f, k) => partIn(f.tooltip) || partIn(shortName(f.name)) || partIn(underOf(g, boxes[k] as Box)?.text ?? ""));
    if (parts.includes("") || new Set(parts).size !== 3) {
      const lens = trio.map((f) => f.maxLen ?? 0).join(",");
      const left = leftOf(g, boxes[0] as Box, (trio[0] as RawField).name);
      const tip = (trio[0] as RawField).tooltip;
      const speaksOfDate = DATEISH.test(left?.run.text ?? "") || DATEISH.test(tip) || DATEISH.test(aboveOf(g, boxes[0] as Box, (trio[0] as RawField).name)?.run.text ?? "");
      if (lens === "2,2,4" && speaksOfDate) parts = ["day", "month", "year"];
      else if (lens === "4,2,2" && speaksOfDate) parts = ["year", "month", "day"];
      else continue;
    }
    trio.forEach((f) => used.add(f));
    out.push({ members: trio, via: "date", parts: parts as DatePart[] });
    i += 2;
  }
  // Rows of one-character boxes.
  let row: RawField[] = [];
  const flush = () => {
    if (row.length >= 2) {
      row.forEach((f) => used.add(f));
      out.push({ members: row, via: "chars" });
    }
    row = [];
  };
  for (const f of order) {
    if (used.has(f)) { flush(); continue; }
    const b = single(f) as Box;
    if (!charBox(f, b)) { flush(); continue; }
    const prev = row[row.length - 1];
    if (prev) {
      const a = single(prev) as Box;
      const gap = b.x1 - a.x2;
      const w = Math.max(a.x2 - a.x1, b.x2 - b.x1);
      const close = lineMates(a, b) && gap >= -1 && (gap <= Math.max(6, 0.8 * w) || (gap <= 3 * w && separatorBetween(g, a, b)));
      if (!close) flush();
    }
    row.push(f);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- the structure

/** A field id the UI can use as an element id: the PDF name with whitespace replaced, unique in the form. */
function idMaker(): (name: string) => string {
  const used = new Set<string>();
  return (name) => {
    const base = name.replace(/\s+/g, "_") || "f";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return id;
  };
}

/** The nearest heading printed above a box on its page, or the last one on an earlier page. */
function sectionOf(g: Geo, b: Box, body: number, title: string): string | undefined {
  const heads = g.runs.filter((r) => isHeading(r, body) && (r.page < b.page || (r.page === b.page && bottom(r) >= b.y2 - 1)));
  const h = heads.sort((p, q) => p.page - q.page || q.y - p.y).pop();
  const text = h ? cleanLabel(h.text) : "";
  return text && text !== title ? text : undefined;
}

/** Reading order: page, then line (top to bottom), then left to right. */
function byReading(a: Box, b: Box): number {
  if (a.page !== b.page) return a.page - b.page;
  if (lineMates(a, b)) return a.x1 - b.x1;
  return b.y2 - a.y2;
}

/**
 * The FormStructure fields and their bindings to PDF fields, in reading order. Structure only: labels come from
 * tooltips and printed text, options from the form's own lists; a value the file holds is never read here.
 */
export function buildFields(fields: RawField[], runs: Run[], title: string): { fields: FieldStructure[]; bindings: PdfBinding[] } {
  const g: Geo = { runs, widgets: fields.flatMap((f) => f.widgets.map((w) => ({ box: w.box, name: f.name, tick: f.type === "checkbox" || f.type === "radio" }))) };
  const body = bodySize(runs);
  const grouped = groups(g, fields);
  const groupOf = new Map<RawField, Group>();
  for (const gr of grouped) for (const m of gr.members) groupOf.set(m, gr);

  interface Item { first: Box; field: Omit<FieldStructure, "fieldId">; binding: Omit<PdfBinding, "fieldId">; name: string; from: Source }
  const items: Item[] = [];
  const done = new Set<Group>();
  for (const f of fields) {
    const gr = groupOf.get(f);
    if (gr) {
      if (done.has(gr)) continue;
      done.add(gr);
      const boxes = gr.members.map((m) => single(m) as Box);
      const first = boxes[0] as Box;
      const lead = gr.members[0] as RawField;
      let lab: Labelled;
      if (gr.via === "date") {
        const left = leftOf(g, first, lead.name);
        const above = aboveOf(g, first, lead.name);
        const tipRest = collapse(lead.tooltip.replace(/[-–:,()]/g, " ").split(/\s+/).filter((w) => !onlyPartWords(w)).join(" "));
        // As for one box: a label close on the left, else one tightly above and aligned, else further left, else above.
        const l = left && !onlyPartWords(left.run.text) ? left : null;
        const a = above && !onlyPartWords(above.run.text) ? above : null;
        const tight = a && a.aligned && a.gap <= 0.8 * a.run.size + 3;
        const raw = l && l.gap <= 24 ? l.run.text : tight ? a.run.text : l ? l.run.text : a ? a.run.text : tipRest;
        lab = raw ? finish(raw, lead, "left", gr.members.some((m) => m.required)) : byName(lead);
      } else {
        lab = boxLabel(g, { ...lead, tooltip: lead.tooltip }, first);
        lab = { ...lab, required: lab.required || gr.members.some((m) => m.required) };
      }
      const field: Omit<FieldStructure, "fieldId"> = { kind: gr.via === "date" ? "date" : "text", label: lab.label, required: lab.required };
      if (gr.via === "chars") field.maxLength = gr.members.length;
      if (lab.hint) field.hint = lab.hint;
      items.push({
        first, name: lead.name, field, from: lab.from,
        binding: { via: gr.via, names: gr.members.map((m) => m.name), ...(gr.parts ? { parts: gr.parts } : {}), boxes },
      });
      continue;
    }
    const sorted = [...f.widgets].sort((p, q) => byReading(p.box, q.box));
    const first = (sorted[0] as { box: Box }).box;
    const boxes = f.widgets.map((w) => w.box);
    if (f.type === "text") {
      const lab = boxLabel(g, f, first);
      const kind: FieldKind = f.multiline ? "textarea" : "text";
      const field: Omit<FieldStructure, "fieldId"> = { kind, label: lab.label, required: lab.required };
      if (f.maxLen) field.maxLength = f.maxLen;
      if (lab.hint) field.hint = lab.hint;
      items.push({ first, name: f.name, field, from: lab.from, binding: { via: "text", names: [f.name], boxes } });
    } else if (f.type === "checkbox") {
      const lab = tickLabel(g, f, first);
      items.push({ first, name: f.name, from: lab.from, field: { kind: "checkbox", label: lab.label, required: lab.required }, binding: { via: "checkbox", names: [f.name], boxes } });
    } else if (f.type === "radio") {
      const options = optionLabels(g, f);
      const lab = groupLabel(g, f, options);
      items.push({ first, name: f.name, from: lab.from, field: { kind: "radio", label: lab.label, required: lab.required, options }, binding: { via: "radio", names: [f.name], boxes } });
    } else {
      const lab = boxLabel(g, f, first);
      const field: Omit<FieldStructure, "fieldId"> = { kind: "select", label: lab.label, required: lab.required };
      if (f.options?.length) field.options = f.options;
      if (lab.hint) field.hint = lab.hint;
      items.push({ first, name: f.name, field, from: lab.from, binding: { via: "choice", names: [f.name], boxes } });
    }
  }
  items.sort((a, b) => byReading(a.first, b.first));
  // A table: a box with nothing printed beside it, under a box of the same column, shares that box's header.
  for (const it of items) {
    if (it.from !== "name" || !["text", "textarea", "select", "date"].includes(it.field.kind)) continue;
    const b = it.first;
    const over = items.filter((o) => o !== it && (o.from === "above" || o.from === "column") && o.first.page === b.page &&
      Math.abs(o.first.x1 - b.x1) <= 4 && Math.abs(o.first.x2 - b.x2) <= 4 && o.first.y1 >= b.y2 - 1 && o.first.y1 - b.y2 <= 3 * (b.y2 - b.y1))
      .sort((p, q) => p.first.y1 - q.first.y1)[0];
    if (over) { it.field = { ...it.field, label: over.field.label }; it.from = "column"; }
  }
  const idFor = idMaker();
  const outFields: FieldStructure[] = [];
  const outBindings: PdfBinding[] = [];
  for (const it of items) {
    const fieldId = idFor(it.name);
    const section = sectionOf(g, it.first, body, title);
    const field: FieldStructure = { fieldId, ...it.field };
    if (section) field.section = section;
    // Key order as the engine writes it: id, kind, label, required, then the optional facts.
    const ordered: FieldStructure = { fieldId, kind: field.kind, label: field.label || fieldId, required: field.required };
    if (field.options) ordered.options = field.options;
    if (field.maxLength) ordered.maxLength = field.maxLength;
    if (field.hint) ordered.hint = field.hint;
    if (field.section) ordered.section = field.section;
    outFields.push(ordered);
    outBindings.push({ fieldId, ...it.binding });
  }
  return { fields: outFields, bindings: outBindings };
}

/** Folded text, for comparing labels loosely in tests and the benchmark. */
export const foldLabel = fold;
