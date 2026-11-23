// Round 3, r3-08: ask this page. The answer's one door (parseAnswer) and the question as a typed value.
import { describe, expect, it } from "vitest";
import { ANSWER_MAX, QUESTION_MAX, capAnswer, cleanQuestion, parseAnswer, prompts, route, schemas } from "../src/index.js";

const blocks = [
  { id: "m0", text: "The library opens at 9 a.m. on weekdays. It closes at noon on Saturdays." },
  { id: "m1", text: "Members can borrow up to “twelve” books at a time — for three weeks." },
];

describe("parseAnswer", () => {
  it("keeps an answer whose sentence is in the named block, with the page's own words", () => {
    const r = parseAnswer({ answer: "It opens at 9 a.m. on weekdays.", blockId: "m0", sentence: "The library opens at 9 a.m. on weekdays." }, blocks);
    expect(r).toEqual({ kind: "answer", answer: { answer: "It opens at 9 a.m. on weekdays.", blockId: "m0", sentence: "The library opens at 9 a.m. on weekdays." } });
  });

  it("finds the sentence with straight quotes and dashes, and returns it as the page writes it", () => {
    const r = parseAnswer({ answer: "Twelve books.", blockId: "m1", sentence: 'Members can borrow up to "twelve" books at a time - for three weeks.' }, blocks);
    expect(r.kind).toBe("answer");
    if (r.kind === "answer") expect(r.answer.sentence).toBe("Members can borrow up to “twelve” books at a time — for three weeks.");
  });

  it("finds the sentence in another block when the model named a wrong or no block", () => {
    for (const blockId of ["m0", "m9", "", undefined]) {
      const r = parseAnswer({ answer: "Twelve.", blockId, sentence: "Members can borrow up to" }, blocks);
      expect(r, String(blockId)).toMatchObject({ kind: "answer", answer: { blockId: "m1" } });
    }
  });

  it("refuses an answer whose sentence is not on the page (it cannot invent one)", () => {
    expect(parseAnswer({ answer: "It opens at 8.", blockId: "m0", sentence: "The library opens at 8 a.m. every day." }, blocks)).toEqual({ kind: "refused", why: "not-on-page" });
    expect(parseAnswer({ answer: "It opens at 8.", blockId: "m0", sentence: "" }, blocks)).toEqual({ kind: "refused", why: "not-on-page" });
    expect(parseAnswer({ answer: "It opens at 8.", blockId: "m0" }, blocks)).toEqual({ kind: "refused", why: "not-on-page" });
    // A word or two is not a sentence the answer rests on.
    expect(parseAnswer({ answer: "Yes.", blockId: "m0", sentence: "library" }, blocks)).toEqual({ kind: "refused", why: "not-on-page" });
    expect(parseAnswer({ answer: "Yes.", blockId: "m0", sentence: "The library opens." }, [])).toEqual({ kind: "refused", why: "not-on-page" });
  });

  it("an empty answer, or one that only says the page does not say, is no answer", () => {
    for (const raw of [null, undefined, "", { answer: "", blockId: "", sentence: "" }, { answer: "  " }, { answer: "The page does not say." }, { answer: "Not mentioned" }, { answer: "unknown" }]) {
      expect(parseAnswer(raw, blocks), JSON.stringify(raw)).toEqual({ kind: "refused", why: "no-answer" });
    }
  });

  it("refuses markup and control characters instead of rendering or cleaning them", () => {
    const sentence = "The library opens at 9 a.m. on weekdays.";
    for (const answer of ["<b>9 a.m.</b>", "<img src=x onerror=alert(1)>", "9 &lt;script&gt;", "<script>alert(1)</script>", "nine\u0007"]) {
      expect(parseAnswer({ answer, blockId: "m0", sentence }, blocks), answer).toEqual({ kind: "refused", why: "invalid" });
    }
  });

  it("refuses anything that is not the closed shape", () => {
    for (const raw of ["just text", 42, ["a"], { answer: 5, sentence: "x" }, { answer: "ok", blockId: 3, sentence: "The library opens at 9 a.m. on weekdays." }]) {
      expect(parseAnswer(raw, blocks), JSON.stringify(raw)).toEqual({ kind: "refused", why: "invalid" });
    }
  });

  it("caps an over-long answer to two sentences and ANSWER_MAX characters", () => {
    const sentence = "The library opens at 9 a.m. on weekdays.";
    const three = parseAnswer({ answer: "One. Two! Three? Four.", blockId: "m0", sentence }, blocks);
    expect(three.kind === "answer" && three.answer.answer).toBe("One. Two!");
    const long = parseAnswer({ answer: `${"word ".repeat(200)}end.`, blockId: "m0", sentence }, blocks);
    expect(long.kind).toBe("answer");
    if (long.kind === "answer") {
      expect(long.answer.answer.length).toBeLessThanOrEqual(ANSWER_MAX);
      expect(long.answer.answer.endsWith("...")).toBe(true);
    }
    expect(capAnswer("It opens at 9 a.m. on weekdays.")).toBe("It opens at 9 a.m. on weekdays.");
  });
});

describe("the question is a typed value", () => {
  it("askPage is a values task: only on this device, whatever is configured", () => {
    for (const cfg of ["prefer_in_cloud", "only_in_cloud", "prefer_on_device", undefined]) {
      expect(route("askPage", cfg)).toMatchObject({ task: "askPage", promptClass: "values", mode: "only_on_device" });
    }
  });

  it("is one plain line of at most QUESTION_MAX characters before any prompt is built", () => {
    expect(cleanQuestion("  When\n\tdoes it\u0000 open?  ")).toBe("When does it open?");
    expect(cleanQuestion("x".repeat(QUESTION_MAX + 50)).length).toBe(QUESTION_MAX);
  });

  it("the prompt carries the question and the blocks inside markers, and asks for the schema's shape", () => {
    const p = prompts.askPage("When does it open?", blocks, "en");
    expect(p).toContain("<question>\nWhen does it open?\n</question>");
    expect(p).toContain("[m0] The library opens");
    expect(p).toMatch(/untrusted/);
    expect(Object.keys((schemas.ask as { properties: object }).properties)).toEqual(["answer", "blockId", "sentence"]);
  });
});
