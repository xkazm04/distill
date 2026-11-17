// DEV ONLY. Canned AI answers so screens can be seen without a Firebase project. Imported only behind
// `import.meta.env.DEV` in ai.ts; the production build must not contain this file.
//
// Failures on purpose, to see the designed states: add `?aifail=<kind>` to the dev URL (every task fails), or
// `?aifail=<kind>:<task>` (only that task fails). Kinds: busy, genuine, device, other, empty. The thrown errors copy the
// real SDK's wording, so they pass through the same plain-words door in ai.ts as a real failure would.
import type { FormStructure, PageModel, Task } from "@distill/engine";

export interface FakeContext { page?: PageModel; structure?: FormStructure; fieldId?: string; value?: string }

export type FakeFailure = "busy" | "genuine" | "device" | "other" | "empty";

/** An SDK-shaped error: an Error with the SDK's `code` and, for HTTP failures, `customErrorData.status`. */
function sdkError(code: string, message: string, status?: number): Error {
  return Object.assign(new Error(`AI: ${message} (AI/${code})`), {
    name: "FirebaseError",
    code,
    ...(status ? { customErrorData: { status } } : {}),
  });
}

/** Throws the failure `fail` asks for, if it applies to `task`. Returns "empty" when the task should answer with nothing. */
function failFor(task: Task, fail: string | null | undefined): "empty" | null {
  if (!fail) return null;
  const [kind, only] = fail.split(":") as [FakeFailure, string | undefined];
  if (only && only !== task) return null;
  switch (kind) {
    case "busy":
      throw sdkError("fetch-error", "Error fetching from https://firebasevertexai.googleapis.com/v1beta/models/m:generateContent: [503 Service Unavailable] This model is currently experiencing high demand.", 503);
    case "genuine":
      throw sdkError("fetch-error", "Error fetching from https://firebasevertexai.googleapis.com/v1beta/models/m:generateContent: [401 Unauthorized] Firebase App Check token is invalid.", 401);
    case "device":
      throw sdkError("unsupported", "Inference mode is ONLY_ON_DEVICE, but an on-device model is not available.");
    case "other":
      throw new SyntaxError("Unexpected token 'S', \"Sure! Here\" is not valid JSON");
    case "empty":
      return "empty";
    default:
      return null;
  }
}

export function fakeRun(task: Task, ctx: FakeContext, fail?: string | null): unknown {
  const empty = failFor(task, fail) === "empty";
  const blocks = ctx.page?.blocks ?? [];
  switch (task) {
    case "simplifyBlocks":
      // schemas.simplify: {blocks: [{id, text}]}
      return {
        blocks: empty ? [] : blocks
          .filter((b) => b.kind === "paragraph" || b.kind === "list")
          .map((b) => ({ id: b.id, text: b.text.split(/(?<=[.!?])\s/)[0] ?? b.text })),
      };
    case "recast": {
      if (empty) return { version: 1, nodes: [] };
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
    case "buildWizard": {
      const s = ctx.structure;
      return {
        fingerprint: s?.fingerprint ?? "",
        readerLang: "en",
        steps: empty ? [] : (s?.fields ?? []).map((f) => ({
          stepId: f.fieldId, fieldIds: [f.fieldId], question: `(dev fake AI) ${f.label}: what should go here?`,
          explanation: `The form asks for "${f.label}".${f.required ? " It is required." : ""}`,
          ...(f.placeholder ? { example: f.placeholder, expectedFormat: f.placeholder } : {}),
        })),
      };
    }
    case "explainField":
      return empty ? "" : "(dev fake AI) The form asks for this detail. Type it in the format shown.";
    case "suggestValue":
      return "NONE";
    case "checkValue":
      return { ok: (ctx.value ?? "").length > 1, message: "Looks fine (fake check)." };
    case "classifyPage":
      return { kind: ctx.page?.kind ?? "other", reason: "(dev fake AI)" };
    case "readLetter":
      // schemas.letter
      return {
        sender: "Example Office",
        subject: "(dev fake AI) Your application",
        lang: "cs",
        summary: "The office needs one more document from you.",
        deadline: "30.11.2026",
        actions: empty ? [] : [{ what: "Send a copy of your passport.", by: "30.11.2026" }],
      };
    case "buildReplyWizard":
      // schemas.replyWizard
      return {
        steps: empty ? [] : [
          { stepId: "r0", question: "(dev fake AI) When can you send the document?", explanation: "The reply says when it will arrive.", example: "25.11.2026", expectedFormat: "DD.MM.YYYY" },
          { stepId: "r1", question: "(dev fake AI) What is your reference number?", explanation: "The office uses it to find your file." },
        ],
      };
    case "draftReply":
      // schemas.replyDraft
      return empty ? { reply: "" } : { reply: "(dev fake AI) Dobrý den, dokument pošlu do [datum]. S pozdravem", translation: "(dev fake AI) Hello, I will send the document by [date]. Kind regards" };
  }
}
