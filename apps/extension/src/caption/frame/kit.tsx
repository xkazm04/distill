// Round 5, r5-04 and r5-09: the strip's kit. Every section of More is built from these few parts, so found data looks
// one way wherever it is found, and waiting, empty and failed are said one way. Styles: kit.css (theme roles only, no
// colour literal; `npm run check-tokens` scans this folder).
//
// THE API (wave B builds on it; keep it this small)
//
//   <Section id title count? testid className? attrs? waiting?>   a section of More: its list header, then children.
//       id: the heading's id (aria-labelledby); title: the words; count: shown after them as "(n)" in a quiet pill.
//       attrs: extra data-* attributes for the section element (data-phase, data-src...).
//   <ListHeader id title count? />                                 the header alone (h2), for a list inside a section.
//
//   <Facts> <FactRow icon? label value from? .../> </Facts>         label, value and where it came from, as a <dl>.
//       from: a word ("From data") or a control (Show me); emphasis: "strong" (a price) | "old" (struck through).
//   <Rows ordered?> <ActionRow icon? kind? text sub? acts .../> </Rows>  one thing found, with what you can do with it.
//       kind: the small label left of the text ("Deadline"); sub: a quieter second line (the page's own words).
//       acts: the buttons, built from ShowMe, CopyButton and ReachLink below.
//   <ShowMe onClick label testid />      Show me: scrolls the page to it.         <CopyButton copied onClick label testid />
//   <ReachLink href testid />            Call (tel:) or Write (mailto:), or nothing for any other address.
//   useCopy()                            { copied(id), problem, copy(id, text) }: the Copy state one section shares.
//   copy(text)                           copies (Clipboard API where the page allows it, else the copy command).
//
//   <Waiting label shape? rows? testid? />   r5-09 waiting: a quiet placeholder in the shape of what is coming, no
//       spinner. shape: "list" (rows of text, the default), "lines" (a paragraph), "inline" (one short bar beside its
//       words, inside a row). The label is shown, small, and read out once (role=status).
//   <Empty testid?>words</Empty>              r5-09 empty: one short line. A section with nothing to say renders null.
//   <Failed why onRetry? testid? retryTestid? />  r5-09 failed: one line saying why in plain words, and Try again where
//       trying again can help (AI tasks, the web check). `why` is a sentence; it is shown as given.
//   <Note>words</Note>                        the small muted line under a section (where it ran, what was sent).
//   <Switch checked onChange label testid disabled? title? />  a real checkbox drawn as a switch (role=switch).
//   <Icon kind />                             a 16 px line icon in the text's own colour (currentColor), aria-hidden.
//   sentence(lead, why)                       "Not looked for: the AI is busy right now." for a Failed line.
//
// Try again: a hook offers `retry` only when trying again can help (runTask.ts retryHelps: busy, a garbled answer),
// and a section passes it to <Failed onRetry>. Waiting needs no state of its own: render <Waiting> for the busy phase.
//
// Scales (kit.css, on :root): type --k-fs-xs 13, --k-fs-sm 14, --k-fs 15, --k-fs-lg 17 px; space --k-sp-1..6 =
// 2, 4, 8, 12, 16, 24 px; a row is at least --k-row (34 px) tall, a kind label --k-label wide.
import { useCallback, useRef, useState, type ReactNode } from "react";
import "./kit.css";

// ---- icons ---------------------------------------------------------------------------------------------------------

/** The kinds of things Distill finds, each with one line icon. "alert" marks a failed line. */
export type IconKind =
  | "deadline" | "payment" | "bring" | "phone" | "email" | "address" | "hours" | "contactPage"
  | "price" | "stock" | "delivery" | "warranty" | "returns" | "spec"
  | "chapter" | "sponsor"
  | "published" | "updated" | "author"
  | "claim" | "alert";

export const ICON_KINDS: readonly IconKind[] = [
  "deadline", "payment", "bring", "phone", "email", "address", "hours", "contactPage",
  "price", "stock", "delivery", "warranty", "returns", "spec", "chapter", "sponsor",
  "published", "updated", "author", "claim", "alert",
];

// 16 x 16, stroked in currentColor (1.5 px, round ends); a few dots filled in currentColor. Nothing else: no colour.
const CAL = "M2.5 3.5h11v10h-11z M2.5 6.5h11 M5.5 2v3 M10.5 2v3";
const PATHS: Record<IconKind, string> = {
  deadline: `${CAL} M8 8.5v2`,
  payment: "M1.5 4h13v8.5h-13z M1.5 7h13 M4 10h3",
  bring: "M3.5 5.5h9l-.8 8.5H4.3z M6 5.5V4a2 2 0 0 1 4 0v1.5",
  phone: "M4.2 2.5h2l1 3-1.4 1a8 8 0 0 0 3.7 3.7l1-1.4 3 1v2a1.5 1.5 0 0 1-1.6 1.5A11 11 0 0 1 2.7 4.1 1.5 1.5 0 0 1 4.2 2.5z",
  email: "M1.5 3.5h13v9h-13z M2 4l6 4.5L14 4",
  address: "M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z M8 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  hours: "M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5z M8 4.5V8l2.5 1.5",
  contactPage: "M1.5 2.5h13v11h-13z M1.5 5.5h13 M8 7.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5z M5.5 12.5a2.5 2.5 0 0 1 5 0",
  price: "M8.5 1.5h6v6l-7 7-6-6z M11.5 3.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z",
  stock: "M2 4.75 8 2l6 2.75v6.5L8 14l-6-2.75z M2 4.75 8 7.5l6-2.75 M8 7.5V14",
  delivery: "M1.5 4h8v7h-8z M9.5 6.5h3l2 2.25V11h-5 M4.5 10.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z M11.5 10.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z",
  warranty: "M8 1.5l5.5 2v4c0 3.5-2.5 5.8-5.5 7-3-1.2-5.5-3.5-5.5-7v-4z M5.5 8l1.8 1.8 3.2-3.3",
  returns: "M5.5 3.5 2.5 6.5l3 3 M2.5 6.5h7a3.5 3.5 0 0 1 0 7h-3",
  spec: "M6 4h8 M6 8h8 M6 12h8 M2.5 4h.5 M2.5 8h.5 M2.5 12h.5",
  chapter: "M2.5 3.5h11 M2.5 8h6 M2.5 12.5h6 M11 9.5l3 2-3 2z",
  sponsor: "M2.5 6v4h2.5l5 3V3L5 6z M12 6a2.8 2.8 0 0 1 0 4",
  published: CAL,
  updated: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9 M13.5 2v3h-3",
  author: "M8 2.5a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5z M2.5 14.5a5.5 5.5 0 0 1 11 0",
  claim: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.3 10.3 14 14",
  alert: "M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5z M8 4.75v4 M8 11.1v.15",
};

/** A small line icon for a kind, in the text's own colour. Decorative: the words beside it carry the meaning. */
export function Icon(props: { kind: IconKind }) {
  return (
    <svg className="k-icon" data-icon={props.kind} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[props.kind]} />
    </svg>
  );
}

// ---- sections and headers --------------------------------------------------------------------------------------------

type Attrs = Record<`data-${string}`, string | undefined>;

/** A section's list header: the title, and the count after it in a quiet pill (read as "Title (3)"). */
export function ListHeader(props: { id?: string; title: ReactNode; count?: number }) {
  return (
    <h2 id={props.id} className="k-head">
      {props.title}
      {props.count !== undefined && <>{" "}<span className="k-count"><span className="vh">(</span>{props.count}<span className="vh">)</span></span></>}
    </h2>
  );
}

/** One section of More: its header, then what it holds. `waiting` marks it busy for assistive tech. */
export function Section(props: {
  id: string; title: ReactNode; count?: number; testid: string; className?: string; attrs?: Attrs; waiting?: boolean;
  label?: string; children?: ReactNode;
}) {
  return (
    <section className={`k-section${props.className ? ` ${props.className}` : ""}`} aria-labelledby={props.label ? undefined : props.id}
      aria-label={props.label} aria-busy={props.waiting || undefined} data-testid={props.testid} {...props.attrs}>
      <ListHeader id={props.id} title={props.title} count={props.count} />
      {props.children}
    </section>
  );
}

// ---- facts -----------------------------------------------------------------------------------------------------------

/** A list of facts (label, value, where it came from). */
export function Facts(props: { className?: string; children?: ReactNode }) {
  return <dl className={`k-facts${props.className ? ` ${props.className}` : ""}`}>{props.children}</dl>;
}

/** One fact: label, value, and where it came from (a word, or Show me). */
export function FactRow(props: {
  icon?: IconKind; label: ReactNode; labelTitle?: string; value: ReactNode; from?: ReactNode;
  emphasis?: "strong" | "old"; testid?: string; valueTestid?: string; className?: string; attrs?: Attrs;
}) {
  const cls = ["k-fact", props.emphasis ? `k-fact-${props.emphasis}` : "", props.className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={cls} data-testid={props.testid} {...props.attrs}>
      <dt title={props.labelTitle}>{props.icon && <Icon kind={props.icon} />}<span className="k-label-text">{props.label}</span></dt>
      <dd data-testid={props.valueTestid}>{props.value}</dd>
      {props.from !== undefined && <span className="k-from">{props.from}</span>}
    </div>
  );
}

// ---- rows of things found ----------------------------------------------------------------------------------------

/** A list of rows: ordered (reading order) or not. */
export function Rows(props: { ordered?: boolean; className?: string; label?: string; children?: ReactNode }) {
  const cls = `k-rows${props.className ? ` ${props.className}` : ""}`;
  return props.ordered
    ? <ol className={cls} aria-label={props.label}>{props.children}</ol>
    : <ul className={cls} aria-label={props.label}>{props.children}</ul>;
}

/** One thing found, with what can be done with it: its kind, the words, a quieter line under them, the buttons. */
export function ActionRow(props: {
  icon?: IconKind; kind?: ReactNode; text: ReactNode; textClass?: string; textTestid?: string; sub?: ReactNode;
  acts?: ReactNode; testid?: string; className?: string; attrs?: Attrs; current?: boolean; after?: ReactNode;
}) {
  return (
    <li className={`k-row${props.kind === undefined && !props.icon ? " k-row-plain" : ""}${props.className ? ` ${props.className}` : ""}`}
      data-testid={props.testid} aria-current={props.current ? "true" : undefined} {...props.attrs}>
      {(props.kind !== undefined || props.icon) && (
        <span className="k-kind">{props.icon && <Icon kind={props.icon} />}{props.kind !== undefined && <span className="k-label-text">{props.kind}</span>}</span>
      )}
      <span className="k-what">
        <span className={`k-text${props.textClass ? ` ${props.textClass}` : ""}`} data-testid={props.textTestid}>{props.text}</span>
        {props.sub}
      </span>
      {props.acts !== undefined && <span className="k-acts">{props.acts}</span>}
      {props.after}
    </li>
  );
}

/** The quieter second line of a row (the page's own words, where it sits). */
export function Sub(props: { testid?: string; children: ReactNode }) {
  return <span className="k-sub" data-testid={props.testid}>{props.children}</span>;
}

/** Show me: scrolls the page to the thing and marks it. */
export function ShowMe(props: { onClick: () => void; label: string; testid?: string; children?: ReactNode }) {
  return (
    <button type="button" className="btn sm quiet" onClick={props.onClick} aria-label={props.label} data-testid={props.testid}>
      {props.children ?? "Show me"}
    </button>
  );
}

/** Copy, then "Copied" for a moment. */
export function CopyButton(props: { copied: boolean; onClick: () => void; label: string; testid?: string }) {
  return (
    <button type="button" className="btn sm quiet" onClick={props.onClick} aria-label={props.label} data-testid={props.testid}>
      {props.copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Call for a tel: address, Write for a mailto: one; nothing for any other. Opens in the page's own window. */
export function ReachLink(props: { href?: string; testid?: { call?: string; write?: string } }) {
  const h = props.href;
  if (h?.startsWith("tel:")) return <a className="btn sm" href={h} target="_top" rel="noopener" data-testid={props.testid?.call}>Call</a>;
  if (h?.startsWith("mailto:")) return <a className="btn sm" href={h} target="_top" rel="noopener" data-testid={props.testid?.write}>Write</a>;
  return null;
}

/** Whether the page lets this frame use the Clipboard API (a frame in another site's page usually may not: asking
 *  anyway prints a policy error in the page's console). */
function clipboardAllowed(): boolean {
  const policy = (document as Document & { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy;
  try { return !!navigator.clipboard && (!policy || policy.allowsFeature("clipboard-write")); } catch { return false; }
}

/** Copies `text`: the Clipboard API where the page lets the frame use it, else the older copy command. */
export async function copy(text: string): Promise<boolean> {
  try {
    if (!clipboardAllowed()) throw new Error("not allowed here");
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "vh";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export const COPY_REFUSED = "Copying is not allowed here. Select the text and copy it yourself.";

/** The Copy state a section shares: which row says "Copied", and the one line when copying is refused. */
export function useCopy(): { copied: (id: string) => boolean; problem: string | null; copy: (id: string, text: string) => Promise<void> } {
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doCopy = useCallback(async (id: string, text: string) => {
    setProblem(null);
    const ok = await copy(text);
    setDone(ok ? id : null);
    if (!ok) { setProblem(COPY_REFUSED); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone((c) => (c === id ? null : c)), 1600);
  }, []);
  return { copied: (id) => done === id, problem, copy: doCopy };
}

// ---- waiting, empty, failed (r5-09) ------------------------------------------------------------------------------

/** Waiting: a quiet placeholder in the shape of what is coming. No spinner; the shimmer stops under reduced motion. */
export function Waiting(props: { label: string; shape?: "list" | "lines" | "inline"; rows?: number; testid?: string }) {
  const shape = props.shape ?? "list";
  const rows = Math.max(1, Math.min(props.rows ?? (shape === "inline" ? 1 : 3), 6));
  return (
    <div className={`k-wait k-wait-${shape}`} role="status" data-testid={props.testid ?? "cap-waiting"} data-shape={shape}>
      <span className="k-wait-label">{props.label}</span>
      <span className="k-wait-bars" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => <span key={i} className="k-wait-bar" style={{ ["--k-w" as string]: `${[92, 74, 84, 66, 88, 70][i] ?? 80}%` }} />)}
      </span>
    </div>
  );
}

/** Empty: one short line, where saying so matters (else the section is not shown at all). */
export function Empty(props: { testid?: string; children?: ReactNode }) {
  return <p className="k-empty" data-testid={props.testid}>{props.children}</p>;
}

/** Failed: one line that says why in plain words, and Try again where trying again can help. */
export function Failed(props: { why: ReactNode; onRetry?: () => void; testid?: string; retryTestid?: string; retryLabel?: string }) {
  return (
    <p className="k-failed" role="status" data-testid={props.testid}>
      <Icon kind="alert" />
      <span className="k-failed-why">{props.why}</span>
      {props.onRetry && (
        <button type="button" className="btn sm quiet k-retry" onClick={props.onRetry} data-testid={props.retryTestid} aria-label={props.retryLabel}>Try again</button>
      )}
    </p>
  );
}

/** The small muted line under a section. */
export function Note(props: { testid?: string; className?: string; role?: "status" | "alert"; attrs?: Attrs; children: ReactNode }) {
  return <p className={`note${props.className ? ` ${props.className}` : ""}`} data-testid={props.testid} role={props.role} {...props.attrs}>{props.children}</p>;
}

/** A real checkbox drawn as a switch. */
export function Switch(props: {
  checked: boolean; onChange: (on: boolean) => void; label: ReactNode; testid?: string; disabled?: boolean; title?: string; attrs?: Attrs;
}) {
  return (
    <label className="switch" title={props.title}>
      <input type="checkbox" role="switch" checked={props.checked} disabled={props.disabled} data-testid={props.testid} {...props.attrs}
        onChange={(e) => props.onChange(e.currentTarget.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

/** "Not looked for: the AI is busy" -> one sentence with a capital and a full stop, for a Failed line. */
export function sentence(lead: string, why: string | undefined, fallback = "something went wrong"): string {
  const w = (why ?? fallback).trim().replace(/\.$/, "");
  return `${lead}: ${w}.`;
}
