// DEV ONLY. Canned AI answers so screens can be seen without a Firebase project. Imported only behind
// `import.meta.env.DEV` in ai.ts; the production build must not contain this file.
//
// Failures on purpose, to see the designed states: add `?aifail=<kind>` to the dev URL (every task fails), or
// `?aifail=<kind>:<task>` (only that task fails). Kinds: busy, genuine, device, other, empty. The thrown errors copy the
// real SDK's wording, so they pass through the same plain-words door in ai.ts as a real failure would.
import type { FormStructure, PageModel, Task } from "@distill/engine";

export interface FakeContext {
  page?: PageModel; structure?: FormStructure; fieldId?: string; value?: string;
  /** translateBlocks: the blocks of the page's main text being translated. */
  blocks?: readonly { id: string; text: string }[];
  /** findClaims: the engine's candidate sentences (round 2). */
  claims?: readonly { id: string; text: string; why?: string }[];
  /** checkClaim: the sentence checked (round 2). */
  claim?: string;
}

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

/** `?aidelay=<ms>` holds every fake answer that long (at most 60 s), to see the loading states. */
export function fakeDelay(search: string | undefined): Promise<void> {
  const ms = Math.min(Number(new URLSearchParams(search ?? "").get("aidelay")) || 0, 60_000);
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/** The stand-in grounded run's "search results" (checkClaim): two https pages, the second one twice (the service
 *  repeats pages), and one plain-http page the door must refuse, so its rules and the links are exercised. */
export function fakeGrounding(): { grounding: { title: string; url: string }[]; queries: string[] } {
  return {
    grounding: [
      { title: "Example News: the figures checked", url: "https://example.com/fact-check" },
      { title: "Example Encyclopedia", url: "https://example.org/wiki/claim" },
      { title: "Example Encyclopedia", url: "https://example.org/wiki/claim" },
      { title: "Plain-http page", url: "http://example.net/insecure" },
    ],
    queries: ["stand-in search"],
  };
}

export function fakeRun(task: Task, ctx: FakeContext, fail?: string | null): unknown {
  const empty = failFor(task, fail) === "empty";
  const blocks = ctx.page?.blocks ?? [];
  switch (task) {
    case "simplifyBlocks":
      // Plain words in place (r2-04, the caption's text blocks): schemas.translate's shape, each block "[PLAIN] " + its
      // words. A block that says "vynechá číslo" ("leaves out a number") loses its digits, so a test sees the facts door
      // refuse a rewrite.
      if (ctx.blocks) {
        return { blocks: empty ? [] : ctx.blocks.map((b) => ({ id: b.id, text: `[PLAIN] ${/vynechá číslo/i.test(b.text) ? b.text.replace(/\d/g, "") : b.text}` })) };
      }
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
    case "explainError":
      return empty ? "" : "(dev fake AI) The form did not accept this answer. Check the format it asks for and type it again.";
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
    case "translateBlocks":
      // schemas.translate: {blocks: [{id, text}]}. Not a translation: the source marked "[EN]", so a screen shows which
      // blocks were replaced (names, numbers and links stay exactly where they were).
      return { blocks: empty ? [] : (ctx.blocks ?? []).map((b) => ({ id: b.id, text: `[EN] ${b.text}` })) };
    case "findClaims":
      // schemas.claims: the first six candidates, each with the engine's own reason (or "number").
      return { claims: empty ? [] : (ctx.claims ?? []).slice(0, 6).map((c) => ({ id: c.id, why: c.why ?? "number" })) };
    case "checkClaim":
      // schemas.check. The grounded run adds its sources from the response, never from here.
      return empty ? { verdict: "notFound", reason: "" } : { verdict: "supported", reason: "(stand-in model) Other sources say the same." };
    case "gist":
      // schemas.gist: the first sentence of each of the first three blocks, as its own source.
      return {
        points: empty ? [] : (ctx.blocks ?? []).slice(0, 3).map((b) => {
          const sentence = b.text.split(/(?<=[.!?])\s/)[0] ?? b.text;
          return { text: `[GIST] ${sentence}`, blockId: b.id, sentence };
        }),
      };
    case "draftReply":
      // schemas.replyDraft
      return empty ? { reply: "" } : { reply: "(dev fake AI) Dobrý den, dokument pošlu do [datum]. S pozdravem", translation: "(dev fake AI) Hello, I will send the document by [date]. Kind regards" };
  }
}
