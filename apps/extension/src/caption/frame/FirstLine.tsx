// Round 5, r5-03: the first line the eye reads, a short sentence plus chips (firstLine.ts). The full status text stays
// in the status element (cap-status: visually hidden, read out, and what the e2e specs read), so nothing is lost; the
// visible line carries the same text in its title. Chips that do not fit fold into one "+n" chip, measured, never cut.
import { useLayoutEffect, useRef, useState } from "react";
import "./more.css";
import { fit, type FactChip, type Sentence } from "./lineParts";
import type { Part } from "./parts";

/** The room the line has: the row's width less what else sits on the same visual line (the mark, the AI chip, and on
 *  a wide strip the buttons). */
function roomFor(line: HTMLElement): number {
  const row = line.parentElement;
  if (!row) return line.clientWidth;
  const cs = getComputedStyle(row);
  const gap = parseFloat(cs.columnGap) || 0;
  const lr = line.getBoundingClientRect();
  let used = 0;
  let others = 0;
  for (const el of Array.from(row.children) as HTMLElement[]) {
    if (el === line || el.classList.contains("sp") || el.classList.contains("fl-measure") || el.classList.contains("vh")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.top < lr.bottom - 2 && r.bottom > lr.top + 2) { used += r.width; others++; }
  }
  return Math.floor(row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - used - gap * others);
}

export function FirstLine(props: { sentence: Sentence; chips: FactChip[]; full: string; open: (part: Part) => void; wrap?: boolean }) {
  const line = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<{ short: boolean; shown: number }>({ short: false, shown: props.chips.length });
  const key = `${props.sentence.long}|${props.sentence.short}|${props.chips.map((c) => c.text).join("|")}`;

  useLayoutEffect(() => {
    const el = line.current;
    const m = measure.current;
    if (!el || !m) return;
    const run = () => {
      const w = (sel: string) => Math.ceil((m.querySelector<HTMLElement>(sel)?.getBoundingClientRect().width) ?? 0);
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const chipW = Array.from(m.querySelectorAll<HTMLElement>(".fl-m-chip")).map((c) => Math.ceil(c.getBoundingClientRect().width));
      const phone = matchMedia("(max-width: 560px)").matches;
      const next = fit(roomFor(el), { long: w(".fl-m-long"), short: w(".fl-m-short"), chips: chipW, plus: w(".fl-m-plus"), gap }, phone);
      setLayout((l) => (l.short === next.short && l.shown === next.shown ? l : next));
    };
    run();
    const ro = new ResizeObserver(run);
    const row = el.parentElement;
    if (row) { ro.observe(row); for (const c of Array.from(row.children)) if (c !== el) ro.observe(c); }
    void document.fonts.ready.then(run);
    return () => ro.disconnect();
  }, [key]);

  const shown = props.chips.slice(0, layout.shown);
  const folded = props.chips.slice(layout.shown);
  return (
    <>
      <span className="first-line" ref={line} title={props.full} data-testid="cap-line" data-short={layout.short ? "" : undefined} data-wrap={props.wrap ? "" : undefined}>
        <span className="fl-sentence" aria-hidden="true" data-testid="cap-sentence">{layout.short ? props.sentence.short : props.sentence.long}</span>
        {shown.map((c) => (
          <button key={c.id} type="button" className="fact" data-testid="cap-fact" data-fact={c.id} data-part={c.part} title={c.title}
            aria-label={c.title} onClick={() => props.open(c.part)}><span className="fact-in">{c.text}</span></button>
        ))}
        {folded.length > 0 && (
          <button type="button" className="fact fact-more" data-testid="cap-fact-more" data-part={folded[0]?.part}
            title={folded.map((c) => c.text).join(", ")} aria-label={`${folded.length} more: ${folded.map((c) => c.text).join(", ")}. Open More.`}
            onClick={() => props.open(folded[0]?.part ?? "page")}><span className="fact-in">+{folded.length}</span></button>
        )}
      </span>
      {/* The same pieces, unseen, to measure them (fonts and sizes as drawn). */}
      <span className="fl-measure" ref={measure} aria-hidden="true">
        <span className="fl-sentence fl-m-long">{props.sentence.long}</span>
        <span className="fl-sentence fl-m-short">{props.sentence.short}</span>
        {props.chips.map((c) => <span key={c.id} className="fact fl-m-chip"><span className="fact-in">{c.text}</span></span>)}
        <span className="fact fl-m-plus"><span className="fact-in">+{props.chips.length}</span></span>
      </span>
    </>
  );
}
