// #10 Translate in place: the frame side. Runs the translateBlocks task, puts the result into the page and offers
// "Keep <language>". STUB: owned by the round-1 builder W4 (who also words the status line in status.ts and the source
// chip in main.tsx once a translation is on the page).
import type { InferenceSource } from "@distill/engine";
import type { CleanReport } from "../../messages";

export interface TranslateState {
  phase: "idle" | "translating" | "done" | "failed";
  /** The page's language, while translating or once done. */
  from?: string;
  /** Where the translation ran (the SDK response), once done. */
  source?: InferenceSource;
  /** The person chose "Keep <language>": the page shows its own words. */
  showingSource: boolean;
}

export interface Translate { state: TranslateState; keepSource(on: boolean): Promise<void> }

export function useTranslate(report: CleanReport | null): Translate {
  void report;
  return { state: { phase: "idle", showingSource: false }, keepSource: async () => undefined };
}

export function TranslateRow(props: { report: CleanReport; translate: Translate }) { void props; return null; }
