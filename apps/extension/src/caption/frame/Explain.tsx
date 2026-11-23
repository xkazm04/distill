// Round 4, card 5 (r4-05): explain this word, the frame side. Listens for CaptionExplainAsk from this tab's page, answers
// from the page (an abbreviation it spells out, sent along as `spelled`) or with the on-device model (explainTerm,
// values: which words the person chose says something about them), and sends distill:caption:explainShow.
// The words go nowhere but a model on this device: run() pins explainTerm to the device with no cloud model, it is never
// posted to the agent, and it is never sent to the offscreen document (whose door refuses values tasks by design), so
// on a site that blocks the model in frames, or with no ready model, the note says why and nothing is run.
// The model's answer passes ONE door (parseExplanation): plain text, one or two sentences, no links or markup.
import { useEffect } from "react";
import { cleanTerm, parseExplanation, prompts, schemas, type LocalModelState } from "@distill/engine";
import { localModelState } from "@distill/web/ai";
import { isCaptionExplainAsk, type CaptionExplainAsk, type CleanReport } from "../../messages";
import { deviceModelBlocked } from "../../offscreen/client";
import { askBlocker, type AskBlocker } from "./Ask";
import { canRunTask, e2eFake, runTask } from "./runTask";
import { send, tabId } from "./send";
import { readerLang, shortReason } from "./Translate";

/** Why the words cannot be explained here, in plain words (shown in the note on the page). */
export const EXPLAIN_BLOCKER_WORDS: Record<AskBlocker, string> = {
  "no-ai": "Explaining is off: this copy of Distill has no AI set up. The words you chose were not sent anywhere.",
  blocked: "This site does not let the AI model on this device run inside the strip, and the words you choose are never sent to the cloud, so explaining is not available here.",
  "not-downloaded": "The AI model on this device is not downloaded yet. The words you choose are never sent to the cloud, so explaining waits for it (see the model line in the strip).",
  "no-model": "This computer cannot run the AI model on the device, and the words you choose are never sent to the cloud, so explaining is not available.",
};

async function readBlocker(): Promise<AskBlocker | null> {
  // E2E only: the stand-in model stands for a ready model on this device.
  if (import.meta.env.MODE === "e2e" && (await e2eFake())) return deviceModelBlocked() ? "blocked" : null;
  const model: LocalModelState = await localModelState();
  return askBlocker({ ai: await canRunTask(), blocked: deviceModelBlocked(), model });
}

export type ExplainReply = { text: string; source: "page" | "on_device" | "refused" };

/** The answer to one ask: from the page, from the model on this device (through the door), or why not. */
export async function explainAnswer(m: Pick<CaptionExplainAsk, "term" | "sentence" | "spelled">): Promise<ExplainReply> {
  const term = cleanTerm(m.term);
  if (!term) return { text: "Select a word or a few words (up to 80 characters) to explain them.", source: "refused" };
  if (m.spelled) return { text: m.spelled, source: "page" };
  const blocker = await readBlocker().catch((): AskBlocker => "no-model");
  if (blocker) return { text: EXPLAIN_BLOCKER_WORDS[blocker], source: "refused" };
  // Checked again right before the run: the words go nowhere but a model on this device.
  if (deviceModelBlocked()) return { text: EXPLAIN_BLOCKER_WORDS.blocked, source: "refused" };
  const sentence = typeof m.sentence === "string" ? m.sentence : "";
  try {
    const r = await runTask("explainTerm", prompts.explainTerm(term, sentence, readerLang()), schemas.explain, { term, sentence });
    // A values task runs only on this device: anything else is not shown as if it were.
    if (r.source !== "on_device" || r.via === "offscreen") return { text: "The answer did not come from the AI on this device, so it is not shown.", source: "refused" };
    const x = parseExplanation(r.data);
    if (x.kind === "explained") return { text: x.text, source: "on_device" };
    return {
      text: x.why === "empty" ? "The AI on this device does not know these words." : "The AI's answer could not be used (it held links or markup), so it is not shown.",
      source: "refused",
    };
  } catch (e) {
    return { text: `Not explained: ${shortReason(e)}.`, source: "refused" };
  }
}

/** Answers the page's Explain button, More open or not. Nothing is kept: the words live only in this call. */
export function useExplain(_report: CleanReport | null): void {
  useEffect(() => {
    const onMessage = (m: unknown) => {
      if (!isCaptionExplainAsk(m) || m.tabId !== tabId) return;
      void explainAnswer(m).then((r) =>
        send<"distill:caption:explainShow">({ type: "distill:caption:explainShow", id: m.id, text: r.text, source: r.source }).catch(() => undefined));
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);
}
