// Round 3, card r3-05: who wrote this and when. The page side reads the byline from the page's own data (engine
// readByline: structured data, meta tags, then the visible byline; nothing is fetched). The strip's status line says
// "Published 3 years ago, updated yesterday" when the two dates are more than a week apart (withByline); More shows the
// rest. The web check (ClaimCheck.tsx) sends the published day with a claim, nothing else of the byline.
import { useEffect, useState } from "react";
import { bylineAgo, bylineDay, bylineLine, type Byline } from "@distill/engine";
import type { CleanReport } from "../../messages";
import { Empty, FactRow, Facts, Note, Section, type IconKind } from "./kit";
import { send } from "./send";
import "./byline.css";

/** Read once per strip (one page): the status line, More and the web check share it. */
let once: Promise<Byline> | null = null;
export function bylineOnce(): Promise<Byline> {
  once ??= send<"distill:caption:byline">({ type: "distill:caption:byline" }).catch((): Byline => ({ from: "none" }));
  return once;
}

/** The published day (YYYY-MM-DD) the web check may send, or undefined. */
export function publishedDay(b: Byline): string | undefined {
  return /^\d{4}-\d{2}-\d{2}/.exec(b.published ?? "")?.[0];
}

/** The byline once the report is in (null until then). */
export function useByline(report: CleanReport | null): Byline | null {
  const [b, setB] = useState<Byline | null>(null);
  const ready = report !== null;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void bylineOnce().then((x) => { if (live) setB(x); });
    return () => { live = false; };
  }, [ready]);
  return b;
}

/** The status line with the byline part added, when it has one worth saying. */
export function withByline(line: string, b: Byline | null, now = new Date()): string {
  const part = b ? bylineLine(b, now) : null;
  return part ? `${line} · ${part}` : line;
}

const FROM: Record<Byline["from"], string> = {
  data: "From the page's structured data.",
  meta: "From the page's meta tags.",
  text: "From the page's own text.",
  none: "",
};

/** "15 March 2024, 10:30 (3 years ago)" from an ISO date or date-time as the page states it. */
export function dateWords(iso: string, now = new Date()): string {
  const day = bylineDay(iso);
  if (day === undefined) return iso;
  const d = new Date(day * 86_400_000);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const time = /T(\d{2}):(\d{2})/.exec(iso);
  return `${date}${time ? `, ${time[1]}:${time[2]}` : ""} (${bylineAgo(day, now)})`;
}

export function BylineSection(props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const b = useByline(props.report);
  if (!b) return null;
  const rows: [string, string, string, IconKind][] = [];
  if (b.published) rows.push(["Published", dateWords(b.published), "published", "published"]);
  if (b.updated) rows.push(["Updated", dateWords(b.updated), "updated", "updated"]);
  if (b.author) rows.push(["Author", b.author, "author", "author"]);
  if (b.publisher) rows.push(["Publisher", b.publisher, "publisher", "author"]);
  const dated = !!(b.published || b.updated);
  return (
    <Section id="cap-byline-h" title="Who wrote this and when" testid="cap-byline" className="byline" attrs={{ "data-from": b.from }}>
      {rows.length > 0 && (
        <Facts className="byline-rows">
          {rows.map(([k, v, id, icon]) => <FactRow key={id} testid={`cap-byline-${id}`} icon={icon} label={k} value={v} />)}
        </Facts>
      )}
      {!dated && <Empty testid="cap-byline-nodate">No date on this page.</Empty>}
      {dated && <Note>{FROM[b.from]} Nothing was fetched.</Note>}
    </Section>
  );
}
