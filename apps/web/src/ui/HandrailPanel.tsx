import { useCallback, useEffect, useRef, useState } from "react";
import type { FormStructure, PageAction } from "@distill/engine";
import type { PageHost } from "./host";
import { newId, type ActionPropose, type HandrailPort, type ProposalCreate, type ToolError, type ToolResult } from "./handrailTypes";
import { getGuide } from "./guide";
import { basicWizard } from "./Wayfill";
import { accentColor } from "./dom";
import { engine } from "./engine";
import { agentQueue, AnswerRefused, taskWords, type AgentQueue } from "./agentQueue";

type Decided = ProposalCreate & { verdict: "accepted" | "rejected" };
/** A click proposal as the person sees it: the control's label and kind from the page at the time. */
export type ActionCard = ActionPropose & { label: string; kind: PageAction["kind"] };
type DecidedAction = ActionCard & { verdict: "accepted" | "rejected" };

/** One line of the activity trail: what the agent asked for, in plain words, with the time. */
export interface TrailLine { at: number; text: string; count: number }

const err = (e: unknown, code: string, fallback: string): { ok: false; error: ToolError } => ({
  ok: false,
  error: { code, message: e instanceof Error ? e.message : fallback },
});

/** Agent-facing (the tool error text). */
export const STALE_FOR_AGENT = "The form on the page is not the one you read (the page changed). Read it again with wayfill_schema, then propose again.";
/** Person-facing. */
export const STALE_FOR_PERSON = "The page changed after the helper made this suggestion, so nothing was filled in. You can reject it; the helper can read the new page and suggest again.";
const NO_GUIDE = 'The step-by-step guide is not open. The person opens "Fill a form" in Distill to start it.';
export const STALE_PAGE_FOR_AGENT = "The page changed since you read it. Call page_actions again, then propose again.";
export const STALE_CLICK_FOR_PERSON = "The page changed after your agent asked, so nothing was clicked. You can reject it; your agent can look at the new page and ask again.";
const NO_ACTIONS = "This page cannot list what can be clicked.";
const MAX_TRAIL = 200;
const MAX_WAIT_SECONDS = 120;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DONE_WORDS: Record<string, (kept: number, dropped: number) => string> = {
  simplifyBlocks: (k, d) => `Your agent made this page easier to read - ${plural(k, "block")}, ${d} dropped`,
  buildWizard: (k, d) => `Your agent built the form guide - ${plural(k, "step")}, ${d} dropped`,
  recast: (k, d) => `Your agent made a new layout - ${plural(k, "section")}, ${d} dropped`,
};

export interface HandrailState {
  /** null: the bridge cannot exist here (not the extension). */
  port: HandrailPort | null;
  pending: ProposalCreate[];
  decided: Decided[];
  /** Click proposals waiting for the person, and the ones decided. */
  actions: ActionCard[];
  decidedActions: DecidedAction[];
  /** The helper program's connection, as the port reports it. null: not known yet. */
  connected: boolean | null;
  reason: string | undefined;
  /** The form as last read from the page; its fingerprint decides whether a proposal still fits. */
  structure: FormStructure | null;
  message: string | null;
  /** Every agent request this session, newest first. */
  trail: TrailLine[];
  decide(p: ProposalCreate, verdict: "accepted" | "rejected"): Promise<void>;
  decideAction(a: ActionCard, verdict: "accepted" | "rejected"): Promise<void>;
}

/**
 * The Handrail side of the panel (PROTOCOL.md section 3), alive for as long as the Workspace is, whichever tab is open.
 * It answers the host's requests, keeps the proposals and the trail, and connects the agent's work queue; HandrailPanel
 * only shows them. Nothing changes in the form or the page until the person presses Accept; only then is writeValues
 * (or the click) done, and only then is the verdict sent.
 */
export function useHandrail(port: HandrailPort | null | undefined, host: PageHost, onPageAction?: () => void, queue: AgentQueue = agentQueue): HandrailState {
  const [pending, setPending] = useState<ProposalCreate[]>([]);
  const [decided, setDecided] = useState<Decided[]>([]);
  const [actions, setActions] = useState<ActionCard[]>([]);
  const [decidedActions, setDecidedActions] = useState<DecidedAction[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const [structure, setStructure] = useState<FormStructure | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [trail, setTrail] = useState<TrailLine[]>([]);
  const pendingRef = useRef<ProposalCreate[]>([]);
  pendingRef.current = pending;

  /** One plain line per agent request. The same line again (an agent polling for work) is counted, not repeated. */
  const log = useCallback((text: string) => {
    setTrail((t) => {
      const [last, ...rest] = t;
      if (last && last.text === text) return [{ at: Date.now(), text, count: last.count + 1 }, ...rest];
      return [{ at: Date.now(), text, count: 1 }, ...t].slice(0, MAX_TRAIL);
    });
  }, []);

  /** The form on the page right now. Always read fresh: a fingerprint check against a remembered form proves nothing. */
  const readForm = useCallback(async (): Promise<FormStructure> => {
    const s = await host.getForm(0);
    setStructure(s);
    return s;
  }, [host]);

  /** The page right now, named (engine pageToken). Read fresh, like the form. */
  const tokenNow = useCallback(async (): Promise<string> => engine.pageToken(await host.getPage()), [host]);

  // A new page: forget the old form, and re-read it at once when proposals wait, so stale cards say so.
  useEffect(() => {
    setStructure(null);
    if (pendingRef.current.length) void readForm().catch(() => undefined);
  }, [readForm]);

  // The work queue checks an agent's answer against the page as it is now.
  useEffect(() => {
    queue.currentToken = tokenNow;
    return () => { if (queue.currentToken === tokenNow) queue.currentToken = null; };
  }, [queue, tokenNow]);

  // The queue follows the port: no helper program, no agent work (and waiting tasks end in plain words).
  useEffect(() => { queue.setConnected(!!port && connected === true); }, [queue, port, connected]);
  useEffect(() => () => queue.setConnected(false), [queue]);

  useEffect(() => {
    if (!port) return;
    return port.onMessage((e) => {
      if (e.type === "status") { setConnected(e.payload.connected); setReason(e.payload.connected ? undefined : e.payload.reason); return; }
      setConnected(true); // a request only arrives over a live port
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
              const field = s.fields.find((f) => f.fieldId === p.fieldId);
              if (!field) {
                reply({ ok: false, error: { code: "bad_request", message: `The form has no field "${p.fieldId}". Use a fieldId from wayfill_schema.` } });
                return;
              }
              setPending((x) => (x.some((y) => y.proposalId === p.proposalId) ? x : [...x, p]));
              log(`Your agent suggested an answer for "${field.label || field.fieldId}"`);
              reply({ ok: true, result: {} });
            },
            () => reply({ ok: false, error: { code: "stale_form", message: STALE_FOR_AGENT } }),
          );
          break;
        }
        case "page.read":
          host.getPage().then(
            async (page) => {
              log("Your agent read this page");
              reply({ ok: true, result: { ...page, pageToken: await engine.pageToken(page) } });
            },
            (x: unknown) => reply(err(x, "extension_error", "Could not read the page.")),
          );
          break;
        case "form.schema":
          readForm().then(
            (s) => {
              const open = getGuide();
              // Structure and wizard only. A person's values are never part of this answer.
              const wizard = open && open.structure.fingerprint === s.fingerprint ? open.wizard : basicWizard(s, "en");
              log(`Your agent read the form - ${plural(s.fields.length, "field")}`);
              reply({ ok: true, result: { structure: s, wizard } });
            },
            (x: unknown) => reply(err(x, "extension_error", "No form on this page.")),
          );
          break;
        case "wizard.next": {
          const step = getGuide()?.advance();
          if (step) log("Your agent moved the form guide to the next step");
          reply(step ? { ok: true, result: step } : { ok: false, error: { code: "extension_error", message: NO_GUIDE } });
          break;
        }
        case "tasks.list": {
          const raw = Number(e.payload?.waitSeconds);
          const wait = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), MAX_WAIT_SECONDS) : 0;
          log("Your agent asked for work");
          void queue.take(wait * 1000, (fresh) => fresh.forEach((t) => log(`Your agent took the task: ${taskWords(t.task)}`)))
            .then((tasks) => reply({ ok: true, result: { tasks: tasks.map(({ taskId, task, prompt, schema, pageToken }) => ({ taskId, task, prompt, schema, pageToken })) } }));
          break;
        }
        case "task.answer": {
          const { taskId, json } = e.payload ?? ({} as { taskId?: unknown; json?: unknown });
          if (typeof taskId !== "string" || typeof json !== "string") {
            reply({ ok: false, error: { code: "bad_request", message: "An answer needs a taskId and json." } });
            break;
          }
          const task = queue.open().find((t) => t.taskId === taskId)?.task;
          queue.answer(taskId, json).then(
            (v) => {
              if (task && v.accepted) log((DONE_WORDS[task] ?? ((_k: number, d: number) => `Your agent finished a task, ${d} dropped`))(keptOf(task, json, v.dropped), v.dropped));
              else log(`Your agent's answer could not be used (${plural(v.errors.length || 1, "problem")}); it can try again`);
              reply({ ok: true, result: v });
            },
            (x: unknown) => {
              if (x instanceof AnswerRefused) {
                if (x.code === "stale_page") log("Your agent answered for a page that has changed, so it was not used");
                reply({ ok: false, error: { code: x.code, message: x.message } });
              } else reply(err(x, "extension_error", "Could not check the answer."));
            },
          );
          break;
        }
        case "page.actions": {
          const list = host.listActions;
          if (!list) { reply({ ok: false, error: { code: "extension_error", message: NO_ACTIONS } }); break; }
          Promise.all([list.call(host), tokenNow()]).then(
            ([acts, pageToken]) => {
              log(`Your agent looked at what can be clicked - ${plural(acts.length, "button or link", "buttons and links")}`);
              reply({ ok: true, result: { pageToken, actions: acts } });
            },
            (x: unknown) => reply(err(x, "extension_error", NO_ACTIONS)),
          );
          break;
        }
        case "action.propose": {
          const a = e.payload;
          const list = host.listActions;
          if (!a || typeof a.pageToken !== "string" || !a.pageToken || typeof a.actionId !== "string" || typeof a.rationale !== "string" || !a.rationale.trim()) {
            reply({ ok: false, error: { code: "bad_request", message: "A click proposal needs an actionId, a rationale and the pageToken from page_actions." } });
            break;
          }
          if (!list) { reply({ ok: false, error: { code: "extension_error", message: NO_ACTIONS } }); break; }
          Promise.all([tokenNow(), list.call(host)]).then(
            ([now, acts]) => {
              if (now !== a.pageToken) { reply({ ok: false, error: { code: "stale_page", message: STALE_PAGE_FOR_AGENT } }); return; }
              const target = acts.find((x) => x.actionId === a.actionId);
              if (!target) { reply({ ok: false, error: { code: "bad_request", message: `The page has no action "${a.actionId}". Use an actionId from page_actions.` } }); return; }
              const card: ActionCard = { ...a, label: target.label, kind: target.kind };
              setActions((x) => (x.some((y) => y.proposalId === a.proposalId) ? x : [...x, card]));
              log(`Your agent wants to click "${target.label}"`);
              reply({ ok: true, result: {} });
            },
            (x: unknown) => reply(err(x, "extension_error", NO_ACTIONS)),
          );
          break;
        }
      }
    });
  }, [port, host, readForm, tokenNow, queue, log]);

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

  const decideAction = useCallback(async (a: ActionCard, verdict: "accepted" | "rejected") => {
    setMessage(null);
    if (verdict === "accepted") {
      try {
        // The page as it is now must be the page the agent read, and the control the one shown on the card.
        const [now, acts] = await Promise.all([tokenNow(), host.listActions ? host.listActions() : Promise.resolve([])]);
        const same = acts.find((x) => x.actionId === a.actionId);
        if (now !== a.pageToken || !same || same.label !== a.label || same.kind !== a.kind || !host.doAction) {
          setMessage(STALE_CLICK_FOR_PERSON);
          return; // clicked nothing; stays pending
        }
        await host.doAction(a.actionId);
      } catch {
        setMessage("Distill could not click it. You can click it in the page yourself.");
        return;
      }
    }
    port?.post({ id: newId(), type: "action.verdict", payload: { proposalId: a.proposalId, verdict } });
    setActions((x) => x.filter((y) => y.proposalId !== a.proposalId));
    setDecidedActions((d) => [{ ...a, verdict }, ...d]);
    if (verdict === "accepted") onPageAction?.(); // read the page again: the click may have changed it
  }, [host, port, tokenNow, onPageAction]);

  return { port: port ?? null, pending, decided, actions, decidedActions, connected, reason, structure, message, trail, decide, decideAction };
}

/** How much of an accepted answer is shown, for the trail line. */
function keptOf(task: string, json: string, dropped: number): number {
  try {
    const data = JSON.parse(json) as unknown;
    const list = Array.isArray(data) ? data : (data as { blocks?: unknown[]; steps?: unknown[]; nodes?: unknown[] })?.[task === "simplifyBlocks" ? "blocks" : task === "buildWizard" ? "steps" : "nodes"];
    if (Array.isArray(list)) return Math.max(list.length - dropped, 0);
    if (data && typeof data === "object") return Math.max(Object.keys(data).length - dropped, 0);
  } catch { /* the queue already parsed it */ }
  return 0;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Shows what the Workspace's useHandrail holds: click proposals, field proposals with Accept and Reject, the trail. */
export function HandrailPanel({ state }: { state: HandrailState }) {
  const { port, pending, decided, actions, decidedActions, connected, reason, structure, message, trail, decide, decideAction } = state;
  const label = (fieldId: string) => structure?.fields.find((f) => f.fieldId === fieldId)?.label ?? fieldId;

  if (!port) {
    return <p className="notice" role="status" data-testid="handrail-none">The agent bridge is only in the Chrome extension.</p>;
  }

  const nothing = pending.length === 0 && actions.length === 0;
  return (
    <section aria-labelledby="hr-h" className="handrail">
      <h2 id="hr-h">Your agent</h2>
      <p className="muted">
        A helper program on your computer lets your agent (Claude Code or agy) read this page, suggest answers and ask to
        click. Nothing is filled in or clicked until you press Accept.
      </p>
      {connected === false && (
        <p className="notice notice-warn" role="status" data-testid="handrail-offline">
          The helper program is not running{reason ? ` (${reason})` : ""}. Start it, and suggestions will appear here.
        </p>
      )}
      {connected === true && <p className="notice" role="status" data-testid="handrail-online">Your helper program is connected.</p>}
      {message && <p className="notice notice-warn" role="alert" data-testid="handrail-message">{message}</p>}
      {nothing && connected !== false && <p role="status" data-testid="handrail-empty">No suggestions waiting.</p>}

      {actions.length > 0 && (
        <ul className="proposals">
          {actions.map((a) => (
            <li key={a.proposalId} className="card" data-testid="action-proposal">
              <h3>Your agent wants to click "{a.label}"</h3>
              <p className="muted">Why: {a.rationale}</p>
              {a.kind === "submit" && <p className="notice notice-warn" data-testid="action-submit">This sends the form.</p>}
              <div className="nav">
                <button type="button" className="btn" onClick={() => void decideAction(a, "rejected")}>Reject</button>
                <button type="button" className="btn btn-primary" onClick={() => void decideAction(a, "accepted")}>Accept</button>
              </div>
            </li>
          ))}
        </ul>
      )}

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
      {(decided.length > 0 || decidedActions.length > 0) && (
        <details>
          <summary>Decided ({decided.length + decidedActions.length})</summary>
          <ul>
            {decidedActions.map((d) => <li key={d.proposalId}>Click "{d.label}": {d.verdict}</li>)}
            {decided.map((d) => <li key={d.proposalId}>{label(d.fieldId)}: {d.verdict}</li>)}
          </ul>
        </details>
      )}

      <section aria-labelledby="hr-trail" className="hr-trail" data-testid="agent-trail">
        <h3 id="hr-trail">What your agent did</h3>
        {trail.length === 0 ? (
          <p className="muted" data-testid="agent-trail-empty">Nothing yet in this session.</p>
        ) : (
          <ol>
            {trail.map((l, i) => (
              <li key={`${l.at}-${i}`} data-testid="trail-line">
                <time dateTime={new Date(l.at).toISOString()}>{time(l.at)}</time> {l.text}{l.count > 1 ? ` (${l.count} times)` : ""}
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
