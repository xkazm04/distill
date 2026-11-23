// Spark universal-core round 2, cards 5 and 7: the switches for readable tables and link notes, in More. Both are on
// from the start; the tables row shows only when the page has a data table in its main text.
import { useState } from "react";
import type { CleanReport } from "../../messages";
import { Section, Switch } from "./kit";
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
    <Section id="cap-tables-h" title="Tables and links" testid="cap-tables-section" className="k-switches">
      {known > 0 && (
        <Switch checked={tables} disabled={busy} onChange={(on) => void toggleTables(on)} label={`Readable tables (${known})`} testid="cap-tables" />
      )}
      <Switch checked={links} disabled={busy} onChange={(on) => void toggleLinks(on)} label="Link notes" testid="cap-links"
        title="Point at a link of the text to see where it goes. Distill reads the address only: nothing is fetched." />
    </Section>
  );
}
