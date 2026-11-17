import { useCallback, useEffect, useRef, useState } from "react";
import type { FormStructure } from "@distill/engine";
import type { PageHost } from "./host";
import { newId, type HandrailPort, type ProposalCreate, type ToolError, type ToolResult } from "./handrailTypes";
import { getGuide } from "./guide";
import { basicWizard } from "./Wayfill";
import { accentColor } from "./dom";

type Decided = ProposalCreate & { verdict: "accepted" | "rejected" };

const err = (e: unknown, code: string, fallback: string): { ok: false; error: ToolError } => ({
  ok: false,
  error: { code, message: e instanceof Error ? e.message : fallback },
});

/** Agent-facing (the tool error text). */
export const STALE_FOR_AGENT = "The form on the page is not the one you read (the page changed). Read it again with wayfill_schema, then propose again.";
/** Person-facing. */
export const STALE_FOR_PERSON = "The page changed after the helper made this suggestion, so nothing was filled in. You can reject it; the helper can read the new page and suggest again.";
const NO_GUIDE = 'The step-by-step guide is not open. The person opens "Fill a form" in Distill to start it.';

export interface HandrailState {
  /** null: the bridge cannot exist here (not the extension). */
  port: HandrailPort | null;
  pending: ProposalCreate[];
  decided: Decided[];
  connected: boolean | null;
  reason: string | undefined;
  /** The form as last read from the page; its fingerprint decides whether a proposal still fits. */
  structure: FormStructure | null;
  message: string | null;
  decide(p: ProposalCreate, verdict: "accepted" | "rejected"): Promise<void>;
}

/**
 * The Handrail side of the panel (PROTOCOL.md section 3), alive for as long as the Workspace is, whichever tab is open.
 * It answers the host's requests and keeps the proposals; HandrailPanel only shows them. Nothing changes in the form
 * until the person presses Accept; only then is writeValues called, and only then is `proposal.verdict` sent.
 */
export function useHandrail(port: HandrailPort | null | undefined, host: PageHost): HandrailState {
  const [pending, setPending] = useState<ProposalCreate[]>([]);
  const [decided, setDecided] = useState<Decided[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const [structure, setStructure] = useState<FormStructure | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pendingRef = useRef<ProposalCreate[]>([]);
  pendingRef.current = pending;

  /** The form on the page right now. Always read fresh: a fingerprint check against a remembered form proves nothing. */
  const readForm = useCallback(async (): Promise<FormStructure> => {
    const s = await host.getForm(0);
    setStructure(s);
    return s;
  }, [host]);

  // A new page: forget the old form, and re-read it at once when proposals wait, so stale cards say so.
  useEffect(() => {
    setStructure(null);
    if (pendingRef.current.length) void readForm().catch(() => undefined);
  }, [readForm]);

  useEffect(() => {
    if (!port) return;
    return port.onMessage((e) => {
      if (e.type === "status") { setConnected(e.payload.connected); setReason(e.payload.reason); return; }
      setConnected(true);
      const reply = (r: ToolResult) => port.post({ id: e.id, type: "tool.result", payload: r });
      switch (e.type) {
        case "proposal.create": {
          const p = e.payload;
          if (typeof p?.fingerprint !== "string" || !p.fingerprint) {
            reply({ ok: false, error: { code: "bad_request", message: "The proposal has no form fingerprint. Read the form with wayfill_schema first." } });
            break;
          }
          readForm().then(
            (s) => {
              if (s.fingerprint !== p.fingerprint) { reply({ ok: false, error: { code: "stale_form", message: STALE_FOR_AGENT } }); return; }
              setPending((x) => (x.some((y) => y.proposalId === p.proposalId) ? x : [...x, p]));
              reply({ ok: true, result: {} });
            },
            () => reply({ ok: false, error: { code: "stale_form", message: STALE_FOR_AGENT } }),
          );
          break;
        }
        case "page.read":
          host.getPage().then(
            (page) => reply({ ok: true, result: page }),
            (x: unknown) => reply(err(x, "extension_error", "Could not read the page.")),
          );
          break;
        case "form.schema":
          readForm().then(
            (s) => {
              const open = getGuide();
              // Structure and wizard only. A person's values are never part of this answer.
              const wizard = open && open.structure.fingerprint === s.fingerprint ? open.wizard : basicWizard(s, "en");
              reply({ ok: true, result: { structure: s, wizard } });
            },
            (x: unknown) => reply(err(x, "extension_error", "No form on this page.")),
          );
          break;
        case "wizard.next": {
          const step = getGuide()?.advance();
          reply(step ? { ok: true, result: step } : { ok: false, error: { code: "extension_error", message: NO_GUIDE } });
          break;
        }
      }
    });
  }, [port, host, readForm]);

  const decide = useCallback(async (p: ProposalCreate, verdict: "accepted" | "rejected") => {
    setMessage(null);
    if (verdict === "accepted") {
      try {
        const s = await readForm();
        if (s.fingerprint !== p.fingerprint) { setMessage(STALE_FOR_PERSON); return; } // written nothing; stays pending
        const r = await host.writeValues(s, { [p.fieldId]: p.value });
        if (r.failed.length) throw new Error("The field could not be filled. Please type it in the original form.");
        await host.highlight([p.fieldId], accentColor());
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not fill the field.");
        return; // nothing was written, so the proposal stays pending
      }
    }
    port?.post({ id: newId(), type: "proposal.verdict", payload: { proposalId: p.proposalId, verdict } });
    setPending((x) => x.filter((y) => y.proposalId !== p.proposalId));
    setDecided((d) => [{ ...p, verdict }, ...d]);
  }, [host, port, readForm]);

  return { port: port ?? null, pending, decided, connected, reason, structure, message, decide };
}

/** Shows the proposals the Workspace's useHandrail holds, with Accept and Reject. */
export function HandrailPanel({ state }: { state: HandrailState }) {
  const { port, pending, decided, connected, reason, structure, message, decide } = state;
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
      {message && <p className="notice notice-warn" role="alert" data-testid="handrail-message">{message}</p>}
      {pending.length === 0 && connected !== false && <p role="status" data-testid="handrail-empty">No suggestions waiting.</p>}
      <ul className="proposals">
        {pending.map((p) => {
          const stale = !!structure && structure.fingerprint !== p.fingerprint;
          return (
            <li key={p.proposalId} className="card" data-testid="proposal">
              <h3>{label(p.fieldId)}</h3>
              <p><strong>Suggested answer:</strong> <span className="proposed-value">{p.value}</span></p>
              <p className="muted">Why: {p.rationale}</p>
              {stale && <p className="notice notice-warn" data-testid="proposal-stale">This was suggested for a page that is no longer open. It cannot be filled in here.</p>}
              <div className="nav">
                <button type="button" className="btn" onClick={() => void decide(p, "rejected")}>Reject</button>
                <button type="button" className="btn btn-primary" disabled={stale} onClick={() => void decide(p, "accepted")}>Accept</button>
              </div>
            </li>
          );
        })}
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
