// #6 Comfortable to read: the switch in More. Shown once the page needed the layer; it stays (switched off) so the
// person can turn it back on.
import { useState } from "react";
import type { CleanReport } from "../../messages";
import { Note, Section, Switch } from "./kit";
import { send } from "./send";

/** How many parts of the page the layer changes when on. Kept for the frame's life: off, the report says 0. */
let known = 0;
/** The page needed the layer (r2-08: Remember turns it off before More ever showed it, and the switch must stay). */
export const knowComfort = (n: number): void => { if (n > 0) known = n; };

export function ComfortSection(props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const { report, setReport } = props;
  if (report.comfort > 0) known = report.comfort;
  const [busy, setBusy] = useState(false);
  if (known === 0) return null;
  const on = report.comfort > 0;
  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      const { comfort } = await send<"distill:caption:comfort">({ type: "distill:caption:comfort", on: next });
      setReport({ ...report, comfort });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section id="cap-comfort-h" title="Reading" testid="cap-comfort-section" className="k-switches">
      <Switch checked={on} disabled={busy} onChange={(next) => void toggle(next)} label="Easier to read" testid="cap-comfort" />
      <Note>Easier-to-read text on {known === 1 ? "1 part" : `${known} parts`} of the page</Note>
    </Section>
  );
}
