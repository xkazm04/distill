import { useEffect, useRef, useState } from "react";
import type { FormStructure, HandrailProposal } from "@distill/engine";
import type { PageHost } from "./host";
import { newId, type HandrailPort, type ToolError } from "./handrailTypes";
import { getGuide } from "./guide";
import { basicWizard } from "./Wayfill";

type Decided = HandrailProposal & { verdict: "accepted" | "rejected" };

const err = (e: unknown, code: string, fallback: string): { ok: false; error: ToolError } => ({
  ok: false,
  error: { code, message: e instanceof Error ? e.message : fallback },
});

/**
 * Proposals from the person's own agent (PROTOCOL.md section 3). Nothing changes in the form until the person presses
 * Accept; only then does this panel call writeValues, and only then does it send `proposal.verdict`.
 */
export function HandrailPanel({ host, port }: { host: PageHost; port: HandrailPort | null }) {
  const [pending, setPending] = useState<HandrailProposal[]>([]);
  const [decided, setDecided] = useState<Decided[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const [structure, setStructure] = useState<FormStructure | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const structureRef = useRef<FormStructure | null>(null);

  async function ensureStructure(): Promise<FormStructure> {
    const open = getGuide();
    if (open) { structureRef.current = open.structure; setStructure(open.structure); return open.structure; }
    if (structureRef.current) return structureRef.current;
    const s = await host.getForm(0);
    structureRef.current = s;
    setStructure(s);
    return s;
  }

  useEffect(() => { structureRef.current = null; setStructure(null); }, [host]);

  useEffect(() => {
    if (!port) return;
    return port.onMessage((e) => {
      if (e.type === "status") { setConnected(e.payload.connected); setReason(e.payload.reason); return; }
      setConnected(true);
      const reply = (r: Parameters<typeof port.post>[0]["payload"]) => port.post({ id: e.id, type: "tool.result", payload: r as never });
      switch (e.type) {
        case "proposal.create":
          setPending((p) => (p.some((x) => x.proposalId === e.payload.proposalId) ? p : [...p, e.payload]));
          void ensureStructure().catch(() => undefined);
          reply({ ok: true, result: {} });
          break;
        case "page.read":
          host.getPage().then(
            (page) => reply({ ok: true, result: page }),
            (x: unknown) => reply(err(x, "extension_error", "Could not read the page.")),
          );
          break;
        case "form.schema":
          ensureStructure().then(
            (s) => {
              const open = getGuide();
              // Structure and wizard only. A person's values are never part of this answer.
              reply({ ok: true, result: { structure: s, wizard: open?.wizard ?? basicWizard(s, "en") } });
            },
            (x: unknown) => reply(err(x, "extension_error", "No form on this page.")),
          );
          break;
        case "wizard.next": {
          const step = getGuide()?.advance();
          reply(step ? { ok: true, result: step } : { ok: false, error: { code: "extension_error", message: 'Open "Fill a form" in Distill first.' } });
          break;
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, host]);

  async function decide(p: HandrailProposal, verdict: "accepted" | "rejected") {
    setMessage(null);
    if (verdict === "accepted") {
      try {
        const s = await ensureStructure();
        const r = await host.writeValues(s, { [p.fieldId]: p.value });
        if (r.failed.length) throw new Error("The field could not be filled. Please type it in the original form.");
        await host.highlight([p.fieldId]);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not fill the field.");
        return; // nothing was written, so the proposal stays pending
      }
    }
    port?.post({ id: newId(), type: "proposal.verdict", payload: { proposalId: p.proposalId, verdict } });
    setPending((x) => x.filter((y) => y.proposalId !== p.proposalId));
    setDecided((d) => [{ ...p, verdict }, ...d]);
  }

  const label = (fieldId: string) => structure?.fields.find((f) => f.fieldId === fieldId)?.label ?? fieldId;

  if (!port) {
    return <p className="notice" role="status" data-testid="handrail-none">The agent bridge is only in the Chrome extension.</p>;
  }

  return (
    <section aria-labelledby="hr-h" className="handrail">
      <h2 id="hr-h">Agent suggestions</h2>
      <p className="muted">A helper program on your computer can suggest answers. Nothing is filled in until you press Accept.</p>
      {connected === false && (
        <p className="notice notice-warn" role="status" data-testid="handrail-offline">
          The helper program is not running{reason ? ` (${reason})` : ""}. Start it, and suggestions will appear here.
        </p>
      )}
      {message && <p className="notice notice-warn" role="alert">{message}</p>}
      {pending.length === 0 && connected !== false && <p role="status" data-testid="handrail-empty">No suggestions waiting.</p>}
      <ul className="proposals">
        {pending.map((p) => (
          <li key={p.proposalId} className="card" data-testid="proposal">
            <h3>{label(p.fieldId)}</h3>
            <p><strong>Suggested answer:</strong> <span className="proposed-value">{p.value}</span></p>
            <p className="muted">Why: {p.rationale}</p>
            <div className="nav">
              <button type="button" className="btn" onClick={() => void decide(p, "rejected")}>Reject</button>
              <button type="button" className="btn btn-primary" onClick={() => void decide(p, "accepted")}>Accept</button>
            </div>
          </li>
        ))}
      </ul>
      {decided.length > 0 && (
        <details>
          <summary>Decided ({decided.length})</summary>
          <ul>{decided.map((d) => <li key={d.proposalId}>{label(d.fieldId)}: {d.verdict}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
