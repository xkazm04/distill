// r3-03: the proof report. What each page task answered on each saved page, where it ran, how long it took, what its
// door left out and any error. The owner saves it as JSON and Markdown and sends it back; nothing here leaves the
// device by itself. Page text only: the fixtures are saved copies of public pages, never anything a person typed.
import type { InferenceSource, LocalModelState } from "@distill/engine";

/** The report's own name: also the marker check-dist looks for, so the public build can never carry this page. */
export const PROOF_KIND = "distill-proof-report";

export type ProofTask = "translate" | "claims" | "gist" | "plain" | "check";
export const PROOF_TASKS: readonly ProofTask[] = ["translate", "claims", "gist", "plain", "check"];

export interface TaskError { kind: string; words: string; raw: string }

export interface TaskResult {
  task: ProofTask;
  status: "ok" | "skipped" | "failed";
  /** The answer as it came through the door (a short form of it: the first items, counts). */
  answer?: unknown;
  /** Where it ran, from the SDK's answer (several calls: on the device only if every one ran there). */
  source?: InferenceSource;
  /** Some call ran in the offscreen document. */
  via?: "offscreen";
  /** Wall time of the task, every call and door included, in milliseconds. */
  ms: number;
  /** Model calls made. */
  calls: number;
  /** Parts of the answers the door left out. */
  dropped: number;
  /** Why the task did not run here (status "skipped"). */
  note?: string;
  error?: TaskError;
}

export interface FixtureResult {
  id: string;
  url: string;
  title: string;
  savedOn: string;
  /** What Clean read: the page's kind and language, how much it would hide, the main text's blocks. */
  clean: { kind: string; lang: string; removed: number; blocks: number; ms: number };
  tasks: TaskResult[];
}

export interface ProofReport {
  kind: typeof PROOF_KIND;
  version: 1;
  startedAt: string;
  finishedAt: string;
  build: { variant: string; mode: string; extension: string; userAgent: string };
  /** The reader's language (the translation's target). */
  reader: string;
  /** The on-device model when the run started and when it ended. */
  model: { before: LocalModelState | "error"; after: LocalModelState | "error" };
  /** A model can answer here at all (Firebase set up, or the e2e stand-in). */
  available: boolean;
  fixtures: FixtureResult[];
}

const WHERE: Record<InferenceSource, string> = { on_device: "on device", in_cloud: "in cloud", agent: "agent" };

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** A short line for the answer column of the Markdown table. */
export function answerLine(r: TaskResult): string {
  if (r.status === "skipped") return `skipped: ${r.note ?? ""}`;
  if (r.status === "failed") return `failed: ${r.error?.words ?? ""} (${r.error?.kind ?? "?"})`;
  const a = r.answer as Record<string, unknown> | undefined;
  if (!a) return "";
  switch (r.task) {
    case "translate": return `${a.translated}/${a.total} blocks; first: ${String((a.sample as { text: string }[] | undefined)?.[0]?.text ?? "").slice(0, 120)}`;
    case "claims": return `${(a.claims as unknown[]).length} of ${a.candidates} candidates kept`;
    case "gist": return `${(a.points as unknown[]).length} points: ${String((a.points as string[])[0] ?? "").slice(0, 120)}`;
    case "plain": return `${a.applied}/${a.total} blocks; ${a.lostFacts} refused for a lost fact`;
    case "check": return (a.checks as { verdict?: string; sources?: unknown[]; suggestions?: boolean }[])
      .map((c) => `${c.verdict ?? "unusable"} (${c.sources?.length ?? 0} sources${c.suggestions ? ", suggestions" : ""})`).join("; ");
  }
}

/** What Clean read, in one sentence. */
export function cleanLine(f: Pick<FixtureResult, "clean">): string {
  const { kind, lang, blocks, removed } = f.clean;
  return `Clean read ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind} page in ${lang}: ${blocks} blocks of main text, ${removed} thing${removed === 1 ? "" : "s"} it would hide`;
}

/** The report as Markdown: a summary table per page, then every answer in full. */
export function toMarkdown(rep: ProofReport): string {
  const out: string[] = [
    "# Distill proof report",
    "",
    `- Run: ${rep.startedAt} to ${rep.finishedAt}`,
    `- Build: ${rep.build.variant} (${rep.build.mode}), extension ${rep.build.extension}`,
    `- Browser: ${rep.build.userAgent}`,
    `- Reader's language: ${rep.reader}`,
    `- On-device model: ${rep.model.before} at the start, ${rep.model.after} at the end`,
    `- A model could answer: ${rep.available ? "yes" : "no"}`,
    "",
  ];
  for (const f of rep.fixtures) {
    out.push(`## ${f.title}`, "", `Saved copy of ${f.url} (${f.savedOn}). ${cleanLine(f)} (${f.clean.ms} ms).`, "");
    out.push("| Task | Status | Where it ran | Time | Calls | Door left out | Answer |", "|---|---|---|---|---|---|---|");
    for (const t of f.tasks) {
      out.push(`| ${t.task} | ${t.status} | ${t.source ? WHERE[t.source] + (t.via ? " (offscreen)" : "") : "-"} | ${t.ms} ms | ${t.calls} | ${t.dropped} | ${cell(answerLine(t))} |`);
    }
    out.push("");
    for (const t of f.tasks) {
      if (t.answer === undefined && !t.error) continue;
      out.push(`### ${f.id}: ${t.task}`, "", "```json", JSON.stringify(t.error ? { error: t.error, answer: t.answer } : t.answer, null, 2), "```", "");
    }
  }
  return out.join("\n");
}
