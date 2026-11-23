// Spark universal-core round 2, card 1 (and card 10's gist next door in Gist.tsx): the claims of the article worth
// checking, found on the device right after Clean. The engine picks candidate sentences (findClaimCandidates); the
// model keeps the ones worth checking (task findClaims, page class, on device first); its answer passes ONE door
// (parseClaims). Without a model nothing is shown as a claim: the engine's candidates alone are not claims. Each kept
// claim is underlined on the page (caption/claims.ts) and listed in More with Show me and its web check (ClaimCheck.tsx,
// card 2).
import { useEffect, useRef, useState } from "react";
import { findClaimCandidates, parseClaims, prompts, schemas, type Claim, type ClaimWhy, type InferenceSource } from "@distill/engine";
import type { CleanReport, TextBlock } from "../../messages";
import { ClaimCheck, useChecks } from "./ClaimCheck";
import { MarksKey } from "./MarksKey";
import { articleLike, firstPart, useMainText } from "./mainText";
import { canRunTask, runTask } from "./runTask";
import { send } from "./send";
import { shortReason, type TranslateState } from "./Translate";

export interface ClaimsState {
  /** "idle" until the report is in; "none" when the page has nothing to check or is not an article. */
  phase: "idle" | "finding" | "ready" | "none" | "failed";
  claims: Claim[];
  /** Refused by the door (parseClaims), shown on screen. */
  dropped: number;
  /** Where the model ran (the run's own answer), once ready. */
  source?: InferenceSource;
  /** The page had sentences worth a look but no model can run here: nothing is shown as a claim. */
  noModel?: boolean;
  /** Candidate sentences the engine offered the model. */
  candidates?: number;
  /** Claims found and underlined on the page. */
  marked?: number;
  /** Once failed: why, in a few words. */
  problem?: string;
  via?: "offscreen";
}

/** The engine's candidate sentences in the first part of the main text (what the model is offered). */
export const claimCandidates = (blocks: readonly TextBlock[]) => findClaimCandidates(firstPart(blocks));

/** The model keeps the claims worth checking; its answer passes the door (parseClaims). The strip and the proof page
 *  (r3-03) both come through here. */
export async function pickClaims(candidates: ReturnType<typeof findClaimCandidates>) {
  const r = await runTask("findClaims", prompts.findClaims(candidates), schemas.claims, { claims: candidates });
  return { pick: parseClaims(r.data, candidates), r };
}

/** Finds the claims once the main text is settled (after Clean, and after Translate where it runs). The strip's status
 *  line reads `claims.length`. */
export function useClaims(report: CleanReport | null, translate?: TranslateState): ClaimsState {
  const [state, setState] = useState<ClaimsState>({ phase: "idle", claims: [], dropped: 0 });
  const blocks = useMainText(report, translate);
  const started = useRef(false);

  useEffect(() => {
    if (!report || !blocks || started.current) return;
    started.current = true;
    void (async () => {
      if (!articleLike(report, blocks)) { setState((s) => ({ ...s, phase: "none" })); return; }
      const candidates = claimCandidates(blocks);
      if (!candidates.length) { setState((s) => ({ ...s, phase: "none", candidates: 0 })); return; }
      if (!(await canRunTask())) { setState((s) => ({ ...s, phase: "none", noModel: true, candidates: candidates.length })); return; }
      setState((s) => ({ ...s, phase: "finding", candidates: candidates.length }));
      try {
        const { pick, r } = await pickClaims(candidates);
        const marked = pick.claims.length
          ? (await send<"distill:caption:markClaims">({ type: "distill:caption:markClaims", claims: pick.claims.map(({ id, blockId, text }) => ({ id, blockId, text })) })
            .catch(() => ({ marked: 0 }))).marked
          : 0;
        setState({
          phase: pick.claims.length ? "ready" : "none", claims: pick.claims, dropped: pick.dropped, source: r.source,
          candidates: candidates.length, marked, ...(r.via ? { via: r.via } : {}),
        });
      } catch (e) {
        setState((s) => ({ ...s, phase: "failed", problem: shortReason(e) }));
      }
    })();
  }, [report, blocks]);

  return state;
}

const WHY: Record<ClaimWhy, string> = {
  number: "A number",
  date: "A date",
  quote: "A quote",
  source: "Has a source",
  cause: "A cause",
};

/** "On this device" / "In the cloud" / "Your agent", from a run's own answer. */
export function whereWords(source: InferenceSource): string {
  return source === "on_device" ? "Found on this device" : source === "in_cloud" ? "Found in the cloud (the page's text was sent, nothing of yours)" : "Found by your own agent";
}

type Chip = ReturnType<typeof import("./Translate").sourceChip>;
const CHIP_TEXT: Record<InferenceSource, string> = { on_device: "On this device", in_cloud: "In the cloud", agent: "Your agent" };
const RAN: Record<InferenceSource, string> = { on_device: "on this device", in_cloud: "in the cloud (the page's text was sent, nothing of yours)", agent: "by your own agent" };

/**
 * The strip's one source chip, with the page tasks of round 2 in it: Translate's chip as it is when a translation is
 * on the page (the claims and the gist added to its title), else where the claims and the gist ran, else "No AI used".
 * "On this device" only when every task that ran ran there.
 */
export function withPageTasks(chip: Chip, claims: ClaimsState, gist: { source?: InferenceSource; phase: string; points: readonly unknown[] }): Chip {
  // Counts only (no text), for the live run to read: claims kept / candidates, marks found, gist points.
  const counts: Record<string, string> = { "data-claims-phase": claims.phase, "data-gist-phase": gist.phase };
  if (claims.candidates !== undefined) counts["data-claims"] = `${claims.claims.length}/${claims.candidates}`;
  if (claims.marked !== undefined) counts["data-claims-marked"] = String(claims.marked);
  if (gist.phase === "ready") counts["data-gist"] = String(gist.points.length);
  const ran: { what: string; source: InferenceSource }[] = [];
  if (claims.source) ran.push({ what: "The claims to check", source: claims.source });
  if (gist.source && gist.phase === "ready") ran.push({ what: "The gist", source: gist.source });
  if (!ran.length) return { ...chip, data: { ...chip.data, ...counts } };
  const data = { ...chip.data, ...counts, "data-tasks": ran.map((r) => `${r.what === "The gist" ? "gist" : "claims"}:${r.source}`).join(" ") };
  const words = ran.map((r) => `${r.what} ran ${RAN[r.source]}.`).join(" ");
  if (chip.src !== "none") {
    // "Clean used no AI." stays the last words (Plain's title may end with it).
    const clean = / ?Clean used no AI\.$/.test(chip.title);
    return { ...chip, data, title: `${chip.title.replace(/ ?Clean used no AI\.$/, "")} ${words}${clean ? " Clean used no AI." : ""}` };
  }
  const sources = ran.map((r) => r.source);
  const src: InferenceSource = sources.every((s) => s === sources[0]) ? (sources[0] as InferenceSource) : "in_cloud";
  return { src, text: CHIP_TEXT[src], title: `${words} Clean used no AI.`, data };
}

/** The claims in More: each with Show me and its web check. */
export function ClaimsSection(props: { report: CleanReport; claims: ClaimsState }) {
  const { claims: state } = props;
  const checks = useChecks(state.claims);
  const [gone, setGone] = useState<string | null>(null);

  if (state.phase === "finding") {
    return <section className="claims" data-testid="cap-claims" data-phase="finding"><h2>Claims to check</h2><p className="note">Looking for claims to check...</p></section>;
  }
  if (state.phase === "failed") {
    return <section className="claims" data-testid="cap-claims" data-phase="failed"><h2>Claims to check</h2><p className="note">Not looked for: {state.problem}.</p></section>;
  }
  if (state.phase === "none" && state.noModel) {
    return (
      <section className="claims" data-testid="cap-claims" data-phase="none">
        <h2>Claims to check</h2>
        <p className="note">Finding the claims worth checking needs an AI model, and none can run here.</p>
      </section>
    );
  }
  if (state.phase !== "ready") return null;

  const show = async (c: Claim) => {
    const r = await send<"distill:caption:showText">({ type: "distill:caption:showText", blockId: c.blockId, sentence: c.text }).catch(() => ({ found: false }));
    setGone(r.found ? null : c.id);
  };

  return (
    <section className="claims" aria-labelledby="cap-claims-h" data-testid="cap-claims" data-phase="ready" data-src={state.source}>
      <h2 id="cap-claims-h">Claims to check ({state.claims.length})</h2>
      {state.source && <p className="note claims-where" data-testid="cap-claims-where">{whereWords(state.source)}. Underlined on the page.</p>}
      <MarksKey kind="claims" />
      <ol className="claims-list">
        {state.claims.map((c) => (
          <li key={c.id} data-testid="cap-claim" data-why={c.why}>
            <span className="claim-why">{WHY[c.why]}</span>
            <span className="claim-text">{c.text}</span>
            <span className="claim-acts">
              <button type="button" className="btn sm quiet" onClick={() => void show(c)} aria-label={`Show me: ${c.text.slice(0, 60)}`} data-testid="cap-claim-show">Show me</button>
              <ClaimCheck claim={c} checks={checks} />
            </span>
            {gone === c.id && <span className="note">That sentence is no longer on the page.</span>}
          </li>
        ))}
      </ol>
      {state.dropped > 0 && <p className="note" data-testid="cap-claims-dropped">{state.dropped === 1 ? "1 of the AI's answers was" : `${state.dropped} of the AI's answers were`} left out: not a sentence of this page it was given, or said twice.</p>}
    </section>
  );
}
