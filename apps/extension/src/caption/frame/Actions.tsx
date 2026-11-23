// Round 3, card r3-09: what this page asks of you. The page side finds deadlines, sums to pay (with the account
// number), what to bring and how to reach someone, by patterns (no AI), and paints a light highlight on their exact
// words. The strip's status line says "4 things to do" (withActions); More lists them in reading order, each with
// Show me, Copy, and Call or Write for a phone or an e-mail. Page words only, read inside the browser.
import { useEffect, useState } from "react";
import type { ActionKind } from "@distill/engine";
import type { ActionItem, CleanReport } from "../../messages";
import { ActionRow, CopyButton, Note, ReachLink, Rows, Section, ShowMe, Sub, useCopy, type IconKind } from "./kit";
import { send } from "./send";
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

/** The icon of a thing to do: a contact is a phone, an e-mail or an address by what it holds. */
export function actionIcon(it: Pick<ActionItem, "kind" | "href" | "text">): IconKind {
  if (it.kind !== "contact") return it.kind;
  if (it.href?.startsWith("mailto:")) return "email";
  if (it.href?.startsWith("tel:")) return "phone";
  return /^Address:/.test(it.text) ? "address" : "phone";
}

/** `showOriginal`: switches the page to the original (the strip's Original), for Show me on an item that sits in a part
 *  Distill hid (r4-01): the part is shown where it is, untouched, and Back to Distill hides it again. */
export function ActionsSection(props: { report: CleanReport; setReport: (r: CleanReport) => void; showOriginal?: () => Promise<void> }) {
  const items = useActions(props.report);
  const copier = useCopy();
  const [gone, setGone] = useState<string | null>(null);
  if (!items?.length) return null;

  const show = async (it: ActionItem) => {
    if (it.hidden && props.showOriginal) await props.showOriginal();
    const r = await send<"distill:caption:showAction">({ type: "distill:caption:showAction", id: it.id }).catch(() => ({ found: false }));
    setGone(r.found ? null : it.id);
  };

  return (
    <Section id="cap-actions-h" title="What this page asks of you" count={items.length} testid="cap-actions" className="actions">
      <Note>Found by patterns on this device, no AI. Highlighted on the page.</Note>
      <Rows ordered className="actions-list">
        {items.map((it) => (
          <ActionRow key={it.id} testid="cap-action" attrs={{ "data-kind": it.kind, "data-hidden": it.hidden ? "" : undefined }}
            icon={actionIcon(it)} kind={ACTION_LABEL[it.kind]} text={it.text} textClass="action-text" textTestid="cap-action-text"
            sub={<>
              {!it.text.includes(it.quote) && <Sub testid="cap-action-quote">{it.quote}</Sub>}
              {it.hidden && <Sub testid="cap-action-hidden">In a part Distill hid. Show me opens the original there.</Sub>}
            </>}
            acts={<>
              <ReachLink href={it.href} testid={{ call: "cap-action-call", write: "cap-action-write" }} />
              <ShowMe onClick={() => void show(it)} label={`Show me: ${it.text.slice(0, 60)}`} testid="cap-action-show" />
              <CopyButton copied={copier.copied(it.id)} onClick={() => void copier.copy(it.id, it.value ?? it.quote)}
                label={`Copy: ${(it.value ?? it.quote).slice(0, 60)}`} testid="cap-action-copy" />
            </>}
            after={gone === it.id ? <span className="note">That part of the page is no longer shown.</span> : undefined} />
        ))}
      </Rows>
      {copier.problem && <Note role="status">{copier.problem}</Note>}
    </Section>
  );
}
