// Round 3, card r3-09: what this page asks of you. The page side finds deadlines, sums to pay (with the account
// number), what to bring and how to reach someone, by patterns (no AI), and paints a light highlight on their exact
// words. The strip's status line says "4 things to do" (withActions); More lists them in reading order, each with
// Show me, Copy, and Call or Write for a phone or an e-mail. Page words only, read inside the browser.
import { useEffect, useState } from "react";
import type { ActionKind } from "@distill/engine";
import type { ActionItem, CleanReport } from "../../messages";
import { copy } from "./Contact";
import { send } from "./send";
import { MarksKey } from "./MarksKey";
import "./actions.css";

/** Found once per strip (one page), right after Clean; the status line and More share it. The highlight goes on with it. */
let once: Promise<ActionItem[]> | null = null;
export function actionsOnce(): Promise<ActionItem[]> {
  once ??= send<"distill:caption:actions">({ type: "distill:caption:actions" }).then(async (items) => {
    if (items.length) await send<"distill:caption:markActions">({ type: "distill:caption:markActions", on: true }).catch(() => undefined);
    return items;
  }, (): ActionItem[] => []);
  return once;
}

/** The actions once the report is in (null until then). */
export function useActions(report: CleanReport | null): ActionItem[] | null {
  const [items, setItems] = useState<ActionItem[] | null>(null);
  const ready = report !== null;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void actionsOnce().then((x) => { if (live) setItems(x); });
    return () => { live = false; };
  }, [ready]);
  return items;
}

/** The status line with "4 things to do" added, when the page asks something of the reader. */
export function withActions(line: string, items: readonly ActionItem[] | null): string {
  const n = items?.length ?? 0;
  return n ? `${line} · ${n} ${n === 1 ? "thing" : "things"} to do` : line;
}

export const ACTION_LABEL: Record<ActionKind, string> = {
  deadline: "Deadline",
  payment: "To pay",
  bring: "To bring",
  contact: "Contact",
  hours: "Hours",
};

/** `showOriginal`: switches the page to the original (the strip's Original), for Show me on an item that sits in a part
 *  Distill hid (r4-01): the part is shown where it is, untouched, and Back to Distill hides it again. */
export function ActionsSection(props: { report: CleanReport; setReport: (r: CleanReport) => void; showOriginal?: () => Promise<void> }) {
  const items = useActions(props.report);
  const [copied, setCopied] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!items?.length) return null;

  const show = async (it: ActionItem) => {
    if (it.hidden && props.showOriginal) await props.showOriginal();
    const r = await send<"distill:caption:showAction">({ type: "distill:caption:showAction", id: it.id }).catch(() => ({ found: false }));
    setGone(r.found ? null : it.id);
  };
  const doCopy = async (it: ActionItem) => {
    setProblem(null);
    const ok = await copy(it.value ?? it.quote);
    setCopied(ok ? it.id : null);
    if (!ok) setProblem("Copying is not allowed here. Select the text and copy it yourself.");
    else setTimeout(() => setCopied((c) => (c === it.id ? null : c)), 1600);
  };

  return (
    <section className="actions" aria-labelledby="cap-actions-h" data-testid="cap-actions">
      <h2 id="cap-actions-h">What this page asks of you ({items.length})</h2>
      <p className="note">Found by patterns on this device, no AI. Highlighted on the page.</p>
      <MarksKey kind="actions" />
      <ol className="actions-list">
        {items.map((it) => (
          <li key={it.id} data-testid="cap-action" data-kind={it.kind} data-hidden={it.hidden ? "" : undefined}>
            <span className="action-kind">{ACTION_LABEL[it.kind]}</span>
            <span className="action-what">
              <span className="action-text" data-testid="cap-action-text">{it.text}</span>
              {!it.text.includes(it.quote) && <span className="action-quote" data-testid="cap-action-quote">{it.quote}</span>}
              {it.hidden && <span className="action-quote" data-testid="cap-action-hidden">In a part Distill hid. Show me opens the original there.</span>}
            </span>
            <span className="action-acts">
              {it.href?.startsWith("tel:") && <a className="btn sm" href={it.href} target="_top" rel="noopener" data-testid="cap-action-call">Call</a>}
              {it.href?.startsWith("mailto:") && <a className="btn sm" href={it.href} target="_top" rel="noopener" data-testid="cap-action-write">Write</a>}
              <button type="button" className="btn sm quiet" onClick={() => void show(it)} aria-label={`Show me: ${it.text.slice(0, 60)}`} data-testid="cap-action-show">Show me</button>
              <button type="button" className="btn sm quiet" onClick={() => void doCopy(it)} aria-label={`Copy: ${(it.value ?? it.quote).slice(0, 60)}`} data-testid="cap-action-copy">
                {copied === it.id ? "Copied" : "Copy"}
              </button>
            </span>
            {gone === it.id && <span className="note">That part of the page is no longer shown.</span>}
          </li>
        ))}
      </ol>
      {problem && <p className="note" role="status">{problem}</p>}
    </section>
  );
}
