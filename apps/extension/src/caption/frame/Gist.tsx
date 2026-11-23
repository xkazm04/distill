// Spark universal-core round 2, card 10: the gist first, three points on the device, each with Show me. Runs once per
// page after Clean (and after Translate where it runs), only on an article with enough text (mainText.ts articleLike).
// The model's answer passes ONE door (parseGist): a point whose sentence is not in its block is dropped and counted,
// so the gist cannot say what the article does not. Without a model there is no gist (nothing pretends to be one).
import { useEffect, useRef, useState } from "react";
import { parseGist, prompts, schemas, type GistPoint, type InferenceSource } from "@distill/engine";
import type { CleanReport, TextBlock } from "../../messages";
import { articleLike, firstPart, useMainText } from "./mainText";
import { canRunTask, runTask } from "./runTask";
import { send } from "./send";
import { readerLang, shortReason, type TranslateState } from "./Translate";

export interface GistState {
  phase: "idle" | "finding" | "ready" | "none" | "failed";
  points: GistPoint[];
  /** Points refused by the door, shown on screen. */
  dropped: number;
  source?: InferenceSource;
  problem?: string;
  via?: "offscreen";
}

/** The gist of `part` (the first part of the main text): the real prompt, runTask, and the door (parseGist). The strip
 *  and the proof page (r3-03) both come through here. */
export async function gistOf(part: TextBlock[]) {
  const r = await runTask("gist", prompts.gist(part, readerLang()), schemas.gist, { blocks: part });
  return { g: parseGist(r.data, part), r };
}

/** The gist of the page, once: after Clean, on an article, when a model can run. */
export function useGist(report: CleanReport | null, translate?: TranslateState): GistState {
  const [state, setState] = useState<GistState>({ phase: "idle", points: [], dropped: 0 });
  const blocks = useMainText(report, translate);
  const started = useRef(false);

  useEffect(() => {
    if (!report || !blocks || started.current) return;
    started.current = true;
    void (async () => {
      if (!articleLike(report, blocks) || !(await canRunTask())) { setState((s) => ({ ...s, phase: "none" })); return; }
      const part = firstPart(blocks);
      setState((s) => ({ ...s, phase: "finding" }));
      try {
        const { g, r } = await gistOf(part);
        setState({ phase: g.points.length ? "ready" : "failed", points: g.points, dropped: g.dropped, source: r.source,
          ...(g.points.length ? {} : { problem: "the AI's answer could not be used" }), ...(r.via ? { via: r.via } : {}) });
      } catch (e) {
        setState((s) => ({ ...s, phase: "failed", problem: shortReason(e) }));
      }
    })();
  }, [report, blocks]);

  return state;
}

const WHERE: Record<InferenceSource, string> = {
  on_device: "Written on this device",
  in_cloud: "Written in the cloud (the page's text was sent, nothing of yours)",
  agent: "Written by your own agent",
};

export function GistSection(props: { report: CleanReport; gist: GistState }) {
  const { gist } = props;
  const [gone, setGone] = useState<number | null>(null);
  if (gist.phase === "finding") {
    return <section className="gist" data-testid="cap-gist" data-phase="finding"><h2>The gist</h2><p className="note">Reading the article for its main points...</p></section>;
  }
  if (gist.phase === "failed") {
    return <section className="gist" data-testid="cap-gist" data-phase="failed"><h2>The gist</h2><p className="note">No gist: {gist.problem}.</p></section>;
  }
  if (gist.phase !== "ready") return null;

  const show = async (p: GistPoint, i: number) => {
    const r = await send<"distill:caption:showText">({ type: "distill:caption:showText", blockId: p.blockId, sentence: p.sentence }).catch(() => ({ found: false }));
    setGone(r.found ? null : i);
  };

  return (
    <section className="gist" aria-labelledby="cap-gist-h" data-testid="cap-gist" data-phase="ready" data-src={gist.source}>
      <h2 id="cap-gist-h">The gist</h2>
      <ol className="gist-list">
        {gist.points.map((p, i) => (
          <li key={`${p.blockId}-${i}`} data-testid="cap-gist-point">
            <span className="gist-text">{p.text}</span>
            <button type="button" className="btn sm quiet" onClick={() => void show(p, i)} aria-label={`Show me where: ${p.text.slice(0, 60)}`} data-testid="cap-gist-show">Show me</button>
            {gone === i && <span className="note">That part is no longer on the page.</span>}
          </li>
        ))}
      </ol>
      <p className="note" data-testid="cap-gist-where">
        {gist.source ? `${WHERE[gist.source]}. ` : ""}Each point comes from a sentence of the article.
        {gist.dropped > 0 && ` ${gist.dropped === 1 ? "1 point was" : `${gist.dropped} points were`} left out: not found in the article.`}
      </p>
    </section>
  );
}
