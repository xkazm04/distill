// #6 Comfortable to read: the switch in More. Shown once the page needed the layer; it stays (switched off) so the
// person can turn it back on.
import { useState } from "react";
import type { CleanReport } from "../../messages";
import { send } from "./send";

/** How many parts of the page the layer changes when on. Kept for the frame's life: off, the report says 0. */
let known = 0;

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
    <section aria-labelledby="cap-comfort-h" data-testid="cap-comfort-section">
      <h2 id="cap-comfort-h">Reading</h2>
      <p className="note">Larger, darker text on {known === 1 ? "1 part" : `${known} parts`} of the page</p>
      <label className="switch">
        <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={(e) => void toggle(e.currentTarget.checked)}
          data-testid="cap-comfort" />
        <span>Easier to read</span>
      </label>
    </section>
  );
}
