// Round 3, card r3-08: ask this page, on the device only. The question is a typed value (task askPage, class values):
// it routes only_on_device with no cloud fallback (route.ts; apps/web/src/ai.ts builds no cloud model for it), it is
// never kept anywhere but this component's state, and it never goes to the offscreen document (whose door refuses a
// values task) or to the agent. Without a ready model on this device the box says why and sends nothing.
// The answer passes ONE door (parseAnswer): it must rest on a sentence found in the main text, or it is refused as
// "This page does not say", so it cannot invent anything. Show me scrolls to that sentence and highlights it.
import { useEffect, useId, useState } from "react";
import { cleanQuestion, parseAnswer, prompts, QUESTION_MAX, schemas, type InferenceSource, type LocalModelState, type PageAnswer } from "@distill/engine";
import { localModelState } from "@distill/web/ai";
import type { CleanReport } from "../../messages";
import { deviceModelBlocked } from "../../offscreen/client";
import { firstPart } from "./mainText";
import { Failed, Note, Section, sentence, Waiting } from "./kit";
import { canRunTask, e2eFake, retryHelps, runTask } from "./runTask";
import { send } from "./send";
import { readerLang, shortReason } from "./Translate";

/** Why Ask cannot run here, in plain words; null when it can. */
export type AskBlocker = "no-ai" | "blocked" | "not-downloaded" | "no-model";

export const BLOCKER_WORDS: Record<AskBlocker, string> = {
  "no-ai": "Asking is off: this copy of Distill has no AI set up. Your question is never sent anywhere.",
  blocked: "This site does not let the AI model on this device run inside the strip, and your question is never sent to the cloud, so asking is not available here.",
  "not-downloaded": "The AI model on this device is not downloaded yet. Your question is never sent to the cloud, so asking waits for it (see the model line below).",
  "no-model": "This computer cannot run the AI model on the device, and your question is never sent to the cloud, so asking is not available.",
};

/** Whether the question can be answered on this device here: a ready local model, in a frame the page lets run it. */
export function askBlocker(s: { ai: boolean; blocked: boolean; model: LocalModelState }): AskBlocker | null {
  if (!s.ai) return "no-ai";
  if (s.blocked) return "blocked";
  if (s.model === "downloadable" || s.model === "downloading") return "not-downloaded";
  if (s.model !== "available") return "no-model";
  return null;
}

async function readBlocker(): Promise<AskBlocker | null> {
  // E2E only: the stand-in model stands for a ready model on this device.
  if (import.meta.env.MODE === "e2e" && (await e2eFake())) return deviceModelBlocked() ? "blocked" : null;
  return askBlocker({ ai: await canRunTask(), blocked: deviceModelBlocked(), model: await localModelState() });
}

const NOT_SAID = "This page does not say.";
const WHERE: Record<InferenceSource, string> = {
  on_device: "On this device",
  in_cloud: "In the cloud",
  agent: "By your own agent",
};

type AskState =
  | { phase: "idle" }
  | { phase: "asking" }
  | { phase: "answer"; answer: PageAnswer; source: InferenceSource }
  | { phase: "refused"; why: "not-on-page" | "no-answer" | "invalid" | "no-text"; source?: InferenceSource }
  | { phase: "failed"; problem: string; retry: boolean };

export function AskSection(_props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const [blocker, setBlocker] = useState<AskBlocker | null | "checking">("checking");
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskState>({ phase: "idle" });
  const [gone, setGone] = useState(false);
  const inputId = useId();

  useEffect(() => {
    let live = true;
    void readBlocker().then((b) => { if (live) setBlocker(b); }, () => { if (live) setBlocker("no-model"); });
    return () => { live = false; };
  }, []);

  const ask = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = cleanQuestion(question);
    if (!q || blocker !== null || state.phase === "asking") return;
    // Checked again right before the run: the question goes nowhere but a model on this device.
    if (deviceModelBlocked()) { setBlocker("blocked"); return; }
    setGone(false);
    setState({ phase: "asking" });
    try {
      const blocks = firstPart(await send<"distill:caption:mainText">({ type: "distill:caption:mainText" }));
      if (!blocks.length) { setState({ phase: "refused", why: "no-text" }); return; }
      const r = await runTask("askPage", prompts.askPage(q, blocks, readerLang()), schemas.ask, { blocks, question: q });
      const a = parseAnswer(r.data, blocks);
      setState(a.kind === "answer"
        ? { phase: "answer", answer: a.answer, source: r.source }
        : { phase: "refused", why: a.why, source: r.source });
    } catch (err) {
      setState({ phase: "failed", problem: shortReason(err), retry: retryHelps(err) });
    }
  };

  const show = async (a: PageAnswer) => {
    const r = await send<"distill:caption:showText">({ type: "distill:caption:showText", blockId: a.blockId, sentence: a.sentence }).catch(() => ({ found: false }));
    setGone(!r.found);
  };

  if (blocker === "checking") return null;

  return (
    <Section id="cap-ask-h" title="Ask this page" testid="cap-ask" className="ask" attrs={{ "data-phase": blocker ? "unavailable" : state.phase }}
      waiting={state.phase === "asking"}>
      {blocker ? (
        <Note testid="cap-ask-unavailable" attrs={{ "data-why": blocker }}>{BLOCKER_WORDS[blocker]}</Note>
      ) : (
        <>
          <form className="ask-form" onSubmit={(e) => void ask(e)}>
            <label htmlFor={inputId} className="vh">Your question about this page</label>
            <input id={inputId} className="ask-input" type="text" value={question} maxLength={QUESTION_MAX} autoComplete="off"
              spellCheck={false} placeholder="Ask about this page..." onChange={(e) => setQuestion(e.target.value)} data-testid="cap-ask-input" />
            <button type="submit" className="btn sm" disabled={!cleanQuestion(question) || state.phase === "asking"} data-testid="cap-ask-go">Ask</button>
          </form>
          <div aria-live="polite" className="ask-out">
            {state.phase === "asking" && <Waiting label="Reading the page on this device..." shape="lines" rows={2} testid="cap-ask-waiting" />}
            {state.phase === "answer" && (
              <div className="ask-answer" data-testid="cap-ask-answer" data-src={state.source}>
                <p className="ask-text" data-testid="cap-ask-text">{state.answer.answer}</p>
                <div className="ask-foot">
                  <button type="button" className="btn sm quiet" onClick={() => void show(state.answer)} data-testid="cap-ask-show">Show me</button>
                  <span className="chip sm" data-src={state.source} data-testid="cap-ask-where">{WHERE[state.source]}</span>
                </div>
                {gone && <Note>That part is no longer on the page.</Note>}
              </div>
            )}
            {state.phase === "refused" && (
              <div className="ask-answer" data-testid="cap-ask-refused" data-why={state.why}>
                <p className="ask-text">{NOT_SAID}</p>
                <Note>
                  {state.why === "not-on-page" ? "The AI gave an answer that is not found on the page, so it is not shown. "
                    : state.why === "invalid" ? "The AI's answer could not be used, so it is not shown. "
                    : state.why === "no-text" ? "Distill found no main text on this page to answer from. " : ""}
                  {state.source ? `${WHERE[state.source]}.` : ""}
                </Note>
              </div>
            )}
            {state.phase === "failed" && (
              <Failed why={sentence("No answer", state.problem)} testid="cap-ask-failed" retryTestid="cap-ask-retry"
                onRetry={state.retry && cleanQuestion(question) ? () => void ask() : undefined} retryLabel="Try again: ask the same question" />
            )}
          </div>
          <Note>Answers come only from this page's text, on this device. Your question is never sent to the cloud.</Note>
        </>
      )}
    </Section>
  );
}
