// Designed waits: while something is read or an AI task runs, each view shows the shape of what is coming (skeleton
// bars with a gentle shimmer) and a plain-words status line. The skeletons are decoration (aria-hidden); the status
// line is what a screen reader hears. The shimmer and the entrance use the shared motion vocabulary, so reduced motion
// turns them off. Content that arrives enters with `enter(i)`: a short rise and fade, staggered by its index.
import type { CSSProperties } from "react";
import type { Block } from "@distill/engine";

/** Stagger index for an entering element (the CSS reads --i). Capped, so a long page does not wait for its tail. */
export const enter = (i: number): CSSProperties => ({ "--i": Math.min(i, 10) }) as CSSProperties;

function Bar({ w, h = "line", i = 0 }: { w: number; h?: "line" | "head" | "tall"; i?: number }) {
  return <span className={`sk sk-${h}`} style={{ width: `${w}%`, ...enter(i) }} />;
}

/** How many lines a paragraph of this length takes, roughly, at the reading measure. */
const linesFor = (text: string): number => Math.min(Math.max(Math.ceil(text.length / 85), 1), 5);
const WIDTHS = [96, 92, 98, 88, 94];

/** The page's own blocks as bars: headings thick, paragraphs as lines, lists with bullets. Known before the AI answers. */
export function BlocksSkeleton({ blocks }: { blocks: Block[] }) {
  return (
    <div className="sk-blocks" aria-hidden="true" data-testid="skeleton">
      {blocks.slice(0, 14).map((b, i) => {
        switch (b.kind) {
          case "heading":
            return <div key={b.id} className="sk-heading"><Bar w={Math.min(30 + b.text.length, 70)} h="head" i={i} /></div>;
          case "list":
            return (
              <div key={b.id} className="sk-list">
                {b.text.split("\n").slice(0, 5).map((t, j) => <div key={j} className="sk-li"><Bar w={Math.min(25 + t.length * .8, 90)} i={i} /></div>)}
              </div>
            );
          case "table":
          case "image":
          case "code":
            return <div key={b.id} className="sk-para"><Bar w={100} h="tall" i={i} /></div>;
          default: {
            const n = linesFor(b.text);
            return (
              <div key={b.id} className="sk-para">
                {Array.from({ length: n }, (_, j) => <Bar key={j} w={j === n - 1 && n > 1 ? 55 : WIDTHS[j % WIDTHS.length] as number} i={i} />)}
              </div>
            );
          }
        }
      })}
    </div>
  );
}

/** A page that is still being read: a title and a few paragraphs. */
export function PageSkeleton() {
  return (
    <div className="sk-blocks" aria-hidden="true" data-testid="skeleton">
      <div className="sk-heading"><Bar w={62} h="head" /></div>
      {[3, 2, 4].map((n, k) => (
        <div key={k} className="sk-para">{Array.from({ length: n }, (_, j) => <Bar key={j} w={j === n - 1 ? 60 : WIDTHS[j] as number} i={k} />)}</div>
      ))}
    </div>
  );
}

/** The form guide while it is being built: the stepper and a step card. */
export function WizardSkeleton() {
  return (
    <div className="wf-grid" aria-hidden="true" data-testid="skeleton">
      <div className="wf-steps sk-steps">
        {[70, 85, 60, 78, 66, 82].map((w, i) => (
          <div key={i} className="sk-step"><span className="sk sk-dot" style={enter(i)} /><Bar w={w} i={i} /></div>
        ))}
      </div>
      <div className="wf-main">
        <div className="card wf-card sk-card">
          <Bar w={22} />
          <div className="sk-heading"><Bar w={70} h="head" /></div>
          <div className="sk-para"><Bar w={96} /><Bar w={64} /></div>
          <Bar w={34} />
          <span className="sk sk-input" />
          <div className="sk-actions"><span className="sk sk-btn" /><span className="ws-grow" /><span className="sk sk-btn" /></div>
        </div>
      </div>
    </div>
  );
}

/** The new layout while it is being built: cards in the two-column grid. */
export function LayoutSkeleton() {
  return (
    <div className="layout-grid" aria-hidden="true" data-testid="skeleton">
      {[false, false, true, false].map((wide, i) => (
        <div key={i} className={wide ? "node node-wide sk-card" : "node sk-card"}>
          <Bar w={18} i={i} />
          <div className="sk-heading"><Bar w={45} h="head" i={i} /></div>
          <div className="sk-para"><Bar w={95} i={i} /><Bar w={88} i={i} />{wide && <Bar w={92} i={i} />}<Bar w={50} i={i} /></div>
        </div>
      ))}
    </div>
  );
}
