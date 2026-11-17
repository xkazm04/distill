// Distill engine: pure functions shared by the web app, the extension and Handrail. No Firebase import here; the
// apps own the SDK and pass prompts through `route()` decisions. Stubs carry the final signatures (WP1 fills them).
export * from "./types.js";
import type {
  FormStructure, FormValues, PageModel, RecastSpec, RepairResult, RouteDecision, Task, Wizard,
} from "./types.js";

const todo = (name: string): never => {
  throw new Error(`distill-engine: ${name} is not implemented yet`);
};

/** Extract the readable content of a document into typed blocks. Never returns HTML. */
export function extractPage(_doc: Document, _url: string): PageModel {
  return todo("extractPage");
}

/** Extract the fillable fields of the n-th form (default 0) as structure only. */
export async function extractForm(_doc: Document, _url: string, _formIndex = 0): Promise<FormStructure> {
  return todo("extractForm");
}

/** Read the current values of a form's fields. Device-only; the result must never reach a cloud-eligible prompt. */
export function readValues(_doc: Document, _structure: FormStructure): FormValues {
  return todo("readValues");
}

/** Write values back into the original fields, in the format each field expects, firing input/change events. */
export function writeValues(_doc: Document, _structure: FormStructure, _values: FormValues): { written: string[]; failed: string[] } {
  return todo("writeValues");
}

/** Validate and repair a model-emitted spec at the one door: keep what validates, drop and count the rest. */
export function validateAndRepair(_candidate: unknown, _enabledKinds?: readonly string[]): RepairResult {
  return todo("validateAndRepair");
}

/** Parse a model's wizard JSON against the structure it was built from; unknown fieldIds are dropped. */
export function parseWizard(_candidate: unknown, _structure: FormStructure, _readerLang: string): Wizard {
  return todo("parseWizard");
}

/** Sieve: where a task may run. `values` tasks are only_on_device, always; nothing overrides that. */
export function route(_task: Task, _configuredMode?: string): RouteDecision {
  return todo("route");
}

/** Prompt builders. A builder for a cloud-eligible task accepts no FormValues by type. */
export const prompts = {
  classifyPage: (_page: PageModel): string => todo("prompts.classifyPage"),
  simplifyBlocks: (_page: PageModel, _readingLevel: string, _readerLang: string): string => todo("prompts.simplifyBlocks"),
  recast: (_page: PageModel, _enabledKinds: readonly string[]): string => todo("prompts.recast"),
  buildWizard: (_structure: FormStructure, _readerLang: string): string => todo("prompts.buildWizard"),
  explainField: (_structure: FormStructure, _fieldId: string, _readerLang: string): string => todo("prompts.explainField"),
  suggestValue: (_structure: FormStructure, _fieldId: string, _profile: FormValues): string => todo("prompts.suggestValue"),
  checkValue: (_structure: FormStructure, _fieldId: string, _value: string): string => todo("prompts.checkValue"),
  readLetter: (_ocrText: string, _readerLang: string): string => todo("prompts.readLetter"),
};

/** JSON Schemas (for Prompt API responseConstraint and Gemini responseSchema) of every model output. */
export const schemas: Record<"recast" | "wizard" | "classify" | "letter", object> = {
  recast: {},
  wizard: {},
  classify: {},
  letter: {},
};

/** sha-256 hex fingerprint of a form, from structure only. */
export async function fingerprint(_url: string, _fields: FormStructure["fields"]): Promise<string> {
  return todo("fingerprint");
}
