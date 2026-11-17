import type { FormStructure, Wizard, WizardStep } from "./types.js";
import { MAX_ITEMS, cleanText, hasScriptUrl, isObj } from "./sanitize.js";

/** Parse a model's wizard against the structure it was built from. Unknown fields are dropped, every required
 *  field is covered (a plain fallback step is added for any the model missed), steps follow the form's order. */
export function parseWizard(candidate: unknown, structure: FormStructure, readerLang: string): Wizard {
  const order = new Map(structure.fields.map((f, i) => [f.fieldId, i]));
  const byId = new Map(structure.fields.map((f) => [f.fieldId, f]));
  let list: unknown[] = [];
  if (Array.isArray(candidate)) list = candidate;
  else if (isObj(candidate) && Array.isArray(candidate.steps)) list = candidate.steps;

  const covered = new Set<string>();
  const usedStepIds = new Set<string>();
  const steps: WizardStep[] = [];

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
  return { fingerprint: structure.fingerprint, readerLang: cleanText(readerLang, 20) || "en", steps };
}
