// Round 5, r5-02: What was removed, its own part of More, on the kit: the list of removed items (each with Show), then
// the Distill links (the full panel, Close Distill on this page, the model line). Was inline in main.tsx until round 5.
import type { LocalModelState } from "@distill/engine";
import type { CleanReport } from "../../messages";
import { Empty, ListHeader, Note, Rows, Section } from "./kit";

const MODEL_WORDS: Record<LocalModelState, string> = {
  available: "AI model on this device: ready.",
  downloadable: "AI model on this device: not downloaded yet.",
  downloading: "AI model on this device: downloading.",
  unavailable: "This computer cannot run the AI model on the device.",
};

export function RemovedSection(props: { report: CleanReport; restore: (id: string) => void }) {
  const { report } = props;
  const removed = report.items.length - report.restored.length;
  return (
    <Section id="cap-removed-h" title={`What was removed (${removed} of ${report.items.length})`} testid="cap-removed" className="removed-part">
      {report.items.length === 0 ? <Empty>Nothing on this page looked like clutter.</Empty> : (
        <Rows className="removed" label="Removed from the page">
          {report.items.map((it) => {
            const back = report.restored.includes(it.id);
            // The kit's plain row, kept flat (the label is the row's first span, as the e2e specs and probes read it).
            return (
              <li key={it.id} className={`k-row k-row-plain${back ? " back" : ""}`} data-testid="cap-removed-item">
                <span className="k-text">{it.label}</span>
                {back ? <span className="note removed-back">Back on the page</span> : (
                  <span className="k-acts">
                    <button type="button" className="btn sm quiet" onClick={() => props.restore(it.id)} aria-label={`Show ${it.label} again`}>Show</button>
                  </span>
                )}
              </li>
            );
          })}
        </Rows>
      )}
      {removed > 1 && <button type="button" className="link" onClick={() => props.restore("all")}>Show everything again</button>}
      {report.unlockedScroll && <Note>The page could not scroll while its pop-up was up. Distill let it scroll again.</Note>}
    </Section>
  );
}

export function DistillLinks(props: {
  model: LocalModelState | "checking"; modelBlocked: boolean; download: () => void; openPanel: () => void; close: () => void; onDeviceOnly: string | null;
}) {
  const { model } = props;
  return (
    <section className="k-section links" aria-labelledby="cap-distill-h" data-testid="cap-distill">
      <ListHeader id="cap-distill-h" title="Distill" />
      <button type="button" className="link" onClick={props.openPanel}>Open the full Distill panel</button>
      <button type="button" className="link" onClick={props.close} data-testid="cap-close">Close Distill on this page</button>
      <p className="model" data-testid="cap-model" data-state={model}>
        {model === "checking" ? "Checking the AI model on this device..." : MODEL_WORDS[model]}
        {model === "downloadable" && !props.modelBlocked && <> <button type="button" className="link" onClick={props.download}>Download the model</button></>}
      </p>
      {props.onDeviceOnly && <Note>{props.onDeviceOnly}</Note>}
    </section>
  );
}
