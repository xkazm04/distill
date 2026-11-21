// #9 Ready to send?: the form's progress in the strip's row ("Form 4 of 7 · Next") and in More. Counts only: the page
// side reads whether each field is filled and answers numbers, never a value or a label (FormProgress).
import { useEffect, useSyncExternalStore } from "react";
import type { CleanReport, FormProgress } from "../../messages";
import { send } from "./send";

// One count for the row and the More section: undefined until the page answered, null when it has no form.
let latest: FormProgress | null | undefined;
const subs = new Set<() => void>();
const publish = (p: FormProgress | null) => { latest = p; for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Asks overlap (the row, More and a focus can ask at once): only the answer to the latest ask is shown. */
let asked = 0;

async function refresh(): Promise<void> {
  const mine = ++asked;
  let p: FormProgress | null = null;
  try { p = await send<"distill:caption:form">({ type: "distill:caption:form" }); } catch { p = null; }
  if (mine === asked) publish(p);
}

async function next(): Promise<void> {
  const mine = ++asked;
  try {
    const p = await send<"distill:caption:nextField">({ type: "distill:caption:nextField" });
    if (mine === asked) publish(p);
  } catch { /* the page went away */ }
}

function useProgress(): FormProgress | null | undefined {
  return useSyncExternalStore(subscribe, () => latest);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Below this many fields, a form on a page that is not a form page shows its progress in More only. */
export const ROW_MIN_FIELDS = 4;

export function FormCheckRow(props: { report: CleanReport }) {
  const p = useProgress();
  // Counted when the report arrives, and again whenever the strip gets focus back: the person may have typed in the
  // page meanwhile.
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    addEventListener("focus", onFocus);
    return () => removeEventListener("focus", onFocus);
  }, [props.report.kind]);

  if (!p) return null;
  // The row is for a page that is there to be filled. An article's comment box (a name, an e-mail, the comment) is
  // not that page's purpose: its progress stays in More only (round-1 integration).
  if (props.report.kind !== "form" && p.fields < ROW_MIN_FIELDS) return null;
  if (p.filled >= p.fields) return <span className="form-done" data-testid="cap-form-done">Form complete</span>;
  return (
    <button type="button" className="btn form-next" onClick={() => void next()} data-testid="cap-form-next"
      aria-label={`Form: ${p.filled} of ${p.fields} fields filled. Go to the next empty field`}>
      <span className="form-word">Form </span>{p.filled} of {p.fields} · Next
    </button>
  );
}

export function FormCheckSection(props: { report: CleanReport }) {
  void props;
  const p = useProgress();
  useEffect(() => { void refresh(); }, []);
  if (!p) return null;
  const required = p.required === 0 ? null
    : p.requiredLeft === 0 ? "All required fields are filled."
    : `${plural(p.requiredLeft, "required field is", "required fields are")} empty.`;
  return (
    <section className="form-check" aria-labelledby="cap-form-h" data-testid="cap-form">
      <h2 id="cap-form-h">Form</h2>
      <p>{p.filled} of {plural(p.fields, "field", "fields")} filled.{required && <> {required}</>}</p>
      {p.errors > 0 && <p className="form-errors">The page shows {plural(p.errors, "error", "errors")}.</p>}
      {p.filled < p.fields && <button type="button" className="link" onClick={() => void next()}>Go to the next empty field</button>}
    </section>
  );
}
