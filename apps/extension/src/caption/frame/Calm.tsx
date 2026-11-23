// #8 Calm the page: "Paused 1 video and 2 moving parts" with Play again, in More. Shown only when Calm held something.
import { useState } from "react";
import type { CleanReport } from "../../messages";
import { Failed, Section } from "./kit";
import { send } from "./send";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Paused 1 video and 2 moving parts", "Paused 2 videos", "Stopped 1 moving part". */
export function calmLine(calm: CleanReport["calm"]): string {
  const videos = plural(calm.media, "video", "videos");
  const parts = plural(calm.motion, "moving part", "moving parts");
  if (calm.media && calm.motion) return `Paused ${videos} and ${parts}`;
  return calm.media ? `Paused ${videos}` : `Stopped ${parts}`;
}

export function CalmSection(props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const { report, setReport } = props;
  const [problem, setProblem] = useState<string | null>(null);
  if (report.calm.media + report.calm.motion <= 0) return null;
  const play = async () => {
    try {
      await send({ type: "distill:caption:play" });
      setProblem(null);
      setReport({ ...report, calm: { media: 0, motion: 0 } });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Section id="cap-calm-h" title="Motion" testid="cap-calm" className="k-switches">
      <p className="k-line calm-line">{calmLine(report.calm)}</p>
      <button type="button" className="btn sm" onClick={() => void play()} data-testid="cap-play">Play again</button>
      {problem && <Failed why={`Could not play again: ${problem.replace(/\.$/, "")}.`} />}
    </Section>
  );
}
