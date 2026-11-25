// The finish account: for every field of the form, what the page holds now against what the wizard wrote, re-read once
// at the end. No model: a pure comparison with the write path's own rule (sameAnswer), so a date the browser shows as
// YYYY-MM-DD is the D.M.YYYY answer the person gave. Device-only: it takes values and returns statuses, never sends.
import { sameAnswer } from "./fill.js";
import type { FieldStructure, FormErrors, FormStructure, FormValues, Wizard } from "./types.js";

/**
 * - `ok`: the page holds the wizard's answer (or a value of its own where the wizard wrote none).
 * - `changed`: the wizard wrote an answer and the page holds something else now (a script cleared or reformatted it).
 * - `required-empty`: a required field the page holds nothing for.
 * - `skipped-optional`: an optional field the page holds nothing for.
 * - `page-error`: the page shows an error for the field.
 * - `unconfirmed`: what the page holds could not be read back (the re-read failed, a print-only PDF, a file field).
 */
export type AccountStatus = "ok" | "changed" | "required-empty" | "skipped-optional" | "page-error" | "unconfirmed";

export interface AccountRow {
  fieldId: string;
  /** The step that asks for the field; null when no step covers it. */
  stepId: string | null;
  status: AccountStatus;
}

export interface AccountOptions {
  /** False when `held` is the host's own record and not a read of the page (a print-only PDF): a field with something
   *  in it is `unconfirmed`, never `ok`. Default true. */
  confirms?: boolean;
}

/** True when `v` answers the field: some text, a choice, a tick ("false" is a single box left unticked). */
export const hasAnswer = (f: FieldStructure, v: string | undefined): boolean => {
  const t = (v ?? "").trim();
  return t !== "" && !(f.kind === "checkbox" && t === "false");
};

/**
 * One row per field of the form, in the wizard's step order (fields no step covers last, in form order). `answers` are
 * the answers the wizard wrote or confirmed on the page (not what was typed and then skipped); `held` is the re-read of
 * the page, null when it could not be read; `errors` are the errors the page shows now.
 */
export function account(
  structure: FormStructure,
  wizard: Wizard,
  answers: FormValues,
  held: FormValues | null,
  errors: FormErrors,
  opts: AccountOptions = {},
): AccountRow[] {
  const confirms = opts.confirms !== false;
  const byId = new Map(structure.fields.map((f) => [f.fieldId, f]));
  const stepOf = new Map<string, string>();
  const order: string[] = [];
  for (const st of wizard.steps) {
    for (const id of st.fieldIds) {
      if (!byId.has(id) || stepOf.has(id)) continue;
      stepOf.set(id, st.stepId);
      order.push(id);
    }
  }
  for (const f of structure.fields) if (!stepOf.has(f.fieldId)) order.push(f.fieldId);

  return order.map((fieldId): AccountRow => {
    const f = byId.get(fieldId) as FieldStructure;
    const row = (status: AccountStatus): AccountRow => ({ fieldId, stepId: stepOf.get(fieldId) ?? null, status });
    if (errors.fields[fieldId]) return row("page-error");
    // A file is chosen in the original form, and no read shows which one.
    if (held === null || f.kind === "file") return row("unconfirmed");
    const want = answers[fieldId];
    const now = held[fieldId] ?? "";
    if (!hasAnswer(f, now)) {
      if (confirms && hasAnswer(f, want)) return row("changed");
      return row(f.required ? "required-empty" : "skipped-optional");
    }
    if (!confirms) return row("unconfirmed");
    if (!hasAnswer(f, want)) return row("ok"); // the page's own value (typed there, or a default)
    return row(sameAnswer(f, want ?? "", now) ? "ok" : "changed");
  });
}
