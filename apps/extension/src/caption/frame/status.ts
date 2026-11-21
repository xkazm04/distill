// The strip's one status line: what Distill did on this page, in plain words.
import { clutterSummary } from "@distill/engine";
import type { CleanReport } from "../../messages";
import type { TranslateState } from "./Translate";

export const langName = (code: string): string => {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code; } catch { return code; }
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Removed 6 distractions · 1 back · Paused 1 video · Page in Czech". */
export function statusLine(report: CleanReport, translate: TranslateState): string {
  const parts = [clutterSummary(report.items)];
  if (report.restored.length) parts.push(`${report.restored.length} back`);
  if (report.calm.media) parts.push(`Paused ${plural(report.calm.media, "video", "videos")}`);
  // Translate (#10, W4) words the language part while it runs and once it is done.
  if (translate.phase === "idle" && report.lang !== "en" && report.lang !== "und") parts.push(`Page in ${langName(report.lang)}`);
  return parts.join(" · ");
}
