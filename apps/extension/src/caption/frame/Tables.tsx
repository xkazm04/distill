// Spark universal-core round 2, cards 5 and 7: the switches for readable tables and link notes, in More. Both are on
// from the start; the tables row shows only when the page has a data table in its main text.
import { useState } from "react";
import type { CleanReport } from "../../messages";
import { send } from "./send";

/** Kept for the frame's life: how many tables the page has (off, the page answers 0), and each switch. */
let known = 0;
let tablesOn = true;
let linksOn = true;

export function TablesLinksSection(props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const { report, setReport } = props;
  if (report.tables > 0) known = report.tables;
  const [tables, setTablesState] = useState(tablesOn);
  const [links, setLinksState] = useState(linksOn);
  const [busy, setBusy] = useState(false);

  const toggleTables = async (on: boolean) => {
    setBusy(true);
    try {
      const { tables: n } = await send<"distill:caption:tables">({ type: "distill:caption:tables", on });
      tablesOn = on;
      setTablesState(on);
      if (on && n > 0) known = n;
      setReport({ ...report, tables: n });
    } finally {
      setBusy(false);
    }
  };
  const toggleLinks = async (on: boolean) => {
    setBusy(true);
    try {
      await send<"distill:caption:links">({ type: "distill:caption:links", on });
      linksOn = on;
      setLinksState(on);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="cap-tables-h" data-testid="cap-tables-section">
      <h2 id="cap-tables-h">Tables and links</h2>
      {known > 0 && (
        <label className="switch">
          <input type="checkbox" role="switch" checked={tables} disabled={busy} onChange={(e) => void toggleTables(e.currentTarget.checked)}
            data-testid="cap-tables" />
          <span>Readable tables ({known})</span>
        </label>
      )}
      <label className="switch" title="Point at a link of the text to see where it goes. Distill reads the address only: nothing is fetched.">
        <input type="checkbox" role="switch" checked={links} disabled={busy} onChange={(e) => void toggleLinks(e.currentTarget.checked)}
          data-testid="cap-links" />
        <span>Link notes</span>
      </label>
    </section>
  );
}
