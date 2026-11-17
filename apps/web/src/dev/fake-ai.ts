// DEV ONLY. Canned AI answers so screens can be seen without a Firebase project. Imported only behind
// `import.meta.env.DEV` in ai.ts; the production build must not contain this file.
import type { FormStructure, PageModel, Task } from "@distill/engine";

export interface FakeContext { page?: PageModel; structure?: FormStructure; fieldId?: string; value?: string }

export function fakeRun(task: Task, ctx: FakeContext): unknown {
  const blocks = ctx.page?.blocks ?? [];
  if (task === "simplifyBlocks") {
    return Object.fromEntries(blocks.filter((b) => b.kind === "paragraph" || b.kind === "list").map((b) => [b.id, b.text.split(/(?<=[.!?])\s/)[0] ?? b.text]));
  }
  if (task === "recast") {
    const ids = blocks.slice(0, 2).map((b) => b.id);
    return {
      version: 1,
      nodes: [
        { kind: "summary", title: "In short", text: blocks.find((b) => b.kind === "paragraph")?.text ?? "A short summary.", sourceBlockIds: ids },
        { kind: "keyFacts", title: "Key facts", facts: [{ label: "Page", value: ctx.page?.title ?? "" }, { label: "Language", value: ctx.page?.lang ?? "" }], sourceBlockIds: ids },
        { kind: "callout", tone: "deadline", text: "Check the date before you act.", sourceBlockIds: ids },
        { kind: "carousel", items: ["x"], sourceBlockIds: ids },
      ],
    };
  }
  if (task === "buildWizard") {
    const s = ctx.structure;
    return {
      fingerprint: s?.fingerprint ?? "",
      readerLang: "en",
      steps: (s?.fields ?? []).map((f) => ({
        stepId: f.fieldId, fieldIds: [f.fieldId], question: `What is your ${f.label.toLowerCase()}?`,
        explanation: `The form asks for "${f.label}".${f.required ? " It is required." : ""}`,
        ...(f.placeholder ? { example: f.placeholder, expectedFormat: f.placeholder } : {}),
      })),
    };
  }
  if (task === "suggestValue") return "NONE";
  if (task === "checkValue") return { ok: (ctx.value ?? "").length > 1, message: "Looks fine (fake check)." };
  return {};
}
