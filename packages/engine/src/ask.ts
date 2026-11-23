// Round 3, card 8 (r3-08): ask this page. The door for the on-device model's answer: it must quote a sentence that is
// really in the main text, or it is refused ("This page does not say"). The question is a typed value (task askPage,
// class values: device only). CONTRACT STUB: the r3-08 builder fills it in, with the prompt and the schema.

export const QUESTION_MAX = 300;
export const ANSWER_MAX = 400;

export interface PageAnswer { answer: string; blockId: string; sentence: string }

export type AnswerResult =
  | { kind: "answer"; answer: PageAnswer }
  | { kind: "refused"; why: "not-on-page" | "no-answer" | "invalid" };

export function parseAnswer(_raw: unknown, _blocks: readonly { id: string; text: string }[]): AnswerResult {
  return { kind: "refused", why: "invalid" };
}
