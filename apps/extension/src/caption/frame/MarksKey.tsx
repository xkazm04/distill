// Round 5, card 7 (r5-07): "What the marks mean", one small line in More, in the section whose marks it names (the
// claims' underlines, the wash on things to do), with the active mark both share. Kept minimal and self-contained so
// wave B can move it. The samples are drawn as the page draws them (caption/marks.ts): underlines in the text's colour,
// the wash and the active mark in the system's find-in-page colours (Mark/MarkText: CSS system colours, not literals).
import type { CSSProperties } from "react";
import { CLAIM_LINE, WASH_MAX, type LineStyle } from "../marks";

/** `seen`: how the sample looks, said for a screen reader (the sample itself is hidden from it). */
interface Item { mark: string; label: string; seen: string; style?: CSSProperties; cls?: string }

const line = (s: LineStyle): CSSProperties => ({ textDecorationLine: "underline", textDecorationStyle: s });

const CLAIMS: Item[] = [
  { mark: "claim", label: "a claim to check", seen: "dotted underline", style: line(CLAIM_LINE.unchecked) },
  { mark: "supported", label: "supported", seen: "solid underline", style: line(CLAIM_LINE.supported) },
  { mark: "disputed", label: "disputed", seen: "wavy underline", style: line(CLAIM_LINE.disputed) },
  { mark: "mixed", label: "mixed", seen: "dashed underline", style: line(CLAIM_LINE.mixed) },
  { mark: "notFound", label: "nothing found", seen: "double underline", style: line(CLAIM_LINE.notFound) },
];
const ACTIONS: Item[] = [
  { mark: "action", label: "something it asks of you", seen: "light highlight", style: { backgroundColor: `color-mix(in srgb, Mark ${WASH_MAX}%, transparent)` } },
];
const ACTIVE: Item = { mark: "active", label: "Show me, a tour's step", seen: "full highlight", cls: "mk-active" };

export function MarksKey(props: { kind: "claims" | "actions" }) {
  const items = [...(props.kind === "claims" ? CLAIMS : ACTIONS), ACTIVE];
  return (
    <p className="note marks-key" data-testid="cap-marks-key" data-kind={props.kind}>
      <span className="mk-head">On the page:</span>
      {items.map((it) => (
        <span key={it.mark} className="mk-item" data-mark={it.mark}>
          <span className={it.cls ? `mk-sample ${it.cls}` : "mk-sample"} style={it.style} aria-hidden="true">text</span>
          <span className="mk-seen">{it.seen}: </span>{it.label}
        </span>
      ))}
    </p>
  );
}
