import type { FieldStructure, FormStructure, Wizard, WizardOption, WizardStep } from "./types.js";
import { MAX_ITEMS, cleanText, hasScriptUrl, isObj } from "./sanitize.js";

/** An option's label in the reader's language is at most this long. */
const OPTION_LABEL_MAX = 200;

/** A wizard through the door, and what the door could not keep of its option labels. */
export interface WizardRead {
  wizard: Wizard;
  /** Entries of `step.options` dropped: a field not in that step, a value that is not one of the field's options, an
   *  empty or repeated label, or an `options` that is not a list. Shown on screen (the door's "dropped and counted"). */
  droppedOptions: number;
}

/** The step's option labels the door keeps: each names a field of the step and one of that field's own option values,
 *  with a plain-text label, once. */
function readOptions(raw: unknown, ids: string[], byId: Map<string, FieldStructure>): { kept: WizardOption[]; dropped: number } {
  if (raw === undefined) return { kept: [], dropped: 0 };
  if (!Array.isArray(raw)) return { kept: [], dropped: 1 };
  const kept: WizardOption[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const o of raw) {
    const fieldId = isObj(o) && typeof o.fieldId === "string" && ids.includes(o.fieldId) ? o.fieldId : null;
    const value = isObj(o) && typeof o.value === "string" ? o.value : null;
    const label = isObj(o) ? cleanText(o.label, OPTION_LABEL_MAX) : null;
    const key = JSON.stringify([fieldId, value]);
    if (fieldId === null || value === null || !label || seen.has(key) || !byId.get(fieldId)?.options?.some((x) => x.value === value)) {
      dropped++;
      continue;
    }
    seen.add(key);
    kept.push({ fieldId, value, label });
  }
  return { kept, dropped };
}

/** Parse a model's wizard against the structure it was built from. Unknown fields are dropped, every required
 *  field is covered (a plain fallback step is added for any the model missed), steps follow the form's order. */
export function parseWizard(candidate: unknown, structure: FormStructure, readerLang: string): Wizard {
  return readWizard(candidate, structure, readerLang).wizard;
}

/** parseWizard, with the count of option labels it dropped. */
export function readWizard(candidate: unknown, structure: FormStructure, readerLang: string): WizardRead {
  const order = new Map(structure.fields.map((f, i) => [f.fieldId, i]));
  const byId = new Map(structure.fields.map((f) => [f.fieldId, f]));
  let list: unknown[] = [];
  if (Array.isArray(candidate)) list = candidate;
  else if (isObj(candidate) && Array.isArray(candidate.steps)) list = candidate.steps;

  const covered = new Set<string>();
  const usedStepIds = new Set<string>();
  const steps: WizardStep[] = [];
  let droppedOptions = 0;

  list.forEach((raw, i) => {
    if (!isObj(raw) || hasScriptUrl(raw) || !Array.isArray(raw.fieldIds)) return;
    const ids = [...new Set(raw.fieldIds.filter((x): x is string => typeof x === "string" && byId.has(x) && !covered.has(x)))].slice(0, MAX_ITEMS);
    if (!ids.length) return;
    const firstLabel = byId.get(ids[0] as string)?.label ?? "";
    const question = cleanText(raw.question) || firstLabel;
    if (!question) return;
    let stepId = cleanText(raw.stepId, 80) || `s${i}`;
    for (let n = 2; usedStepIds.has(stepId); n++) stepId = `${stepId}_${n}`;
    usedStepIds.add(stepId);
    ids.forEach((id) => covered.add(id));
    const step: WizardStep = { stepId, fieldIds: ids, question, explanation: cleanText(raw.explanation) ?? "" };
    const example = cleanText(raw.example);
    if (example) step.example = example;
    const fmt = cleanText(raw.expectedFormat);
    if (fmt) step.expectedFormat = fmt;
    const opts = readOptions(raw.options, ids, byId);
    droppedOptions += opts.dropped;
    if (opts.kept.length) step.options = opts.kept;
    steps.push(step);
  });

  for (const f of structure.fields) {
    if (!f.required || covered.has(f.fieldId)) continue;
    let stepId = f.fieldId;
    for (let n = 2; usedStepIds.has(stepId); n++) stepId = `${f.fieldId}_${n}`;
    usedStepIds.add(stepId);
    steps.push({ stepId, fieldIds: [f.fieldId], question: f.label || f.fieldId, explanation: "Fill this in exactly as the form asks." });
  }

  const firstIndex = (s: WizardStep): number => Math.min(...s.fieldIds.map((id) => order.get(id) ?? 0));
  steps.sort((a, b) => firstIndex(a) - firstIndex(b));
  return { wizard: { fingerprint: structure.fingerprint, readerLang: cleanText(readerLang, 20) || "en", steps }, droppedOptions };
}
