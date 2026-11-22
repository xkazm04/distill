// #10 Translate in place: the frame side. Runs the translateBlocks task, puts the result into the page and offers
// "Keep <language>". It starts on its own after Clean when the page is not in the reader's language (docs/caption.md,
// decision 3: nothing past Clean and Translate starts by itself). The blocks are the page's own text (prompt class
// `page`), never a form's values: the page side leaves forms, fields and editable areas out.
import { useCallback, useEffect, useRef, useState } from "react";
import { parseTranslation, prompts, schemas, type InferenceSource } from "@distill/engine";
import { aiAvailable, run, toAiError, type AiFailure, type RunResult } from "@distill/web/ai";
import { isCaptionMoreText, type CleanReport, type TextBlock } from "../../messages";
import { send, tabId } from "./send";
import { langName } from "./status";

export interface TranslateState {
  phase: "idle" | "translating" | "done" | "failed";
  /** The page's language, while translating or once done. */
  from?: string;
  /** Where the translation ran (the SDK response), once done. */
  source?: InferenceSource;
  /** The person chose "Keep <language>": the page shows its own words. */
  showingSource: boolean;
  /** The reader's language, the translation's target. */
  to?: string;
  /** Once done: blocks translated, of how many; parts of the model's answers refused by the door. */
  translated?: number;
  total?: number;
  dropped?: number;
  /** Once failed: why, in a few plain words. */
  problem?: string;
  /** Why it ran where it ran (the Sieve's words), for the chip's title. */
  reason?: string;
}

export interface Translate { state: TranslateState; keepSource(on: boolean): Promise<void> }

/** The reader's language: the browser's, primary subtag ("en" from "en-GB"). */
export const readerLang = (): string => (navigator.language || "en").split("-")[0]?.toLowerCase() || "en";
/** "cs" from "cs-CZ"; "und" stays "und". */
const primary = (lang: string): string => lang.split("-")[0]?.toLowerCase() || "und";

/** Whether Translate starts on this page: the page has a language, and it is not the reader's. */
export function wantsTranslation(report: Pick<CleanReport, "lang">, reader = readerLang()): boolean {
  const from = primary(report.lang);
  return from !== "und" && from !== reader;
}

/** One call carries at most this many blocks or characters; the first screen's blocks go first (document order). */
export const BATCH_BLOCKS = 20;
export const BATCH_CHARS = 6000;

export function batches(blocks: readonly TextBlock[]): TextBlock[][] {
  const out: TextBlock[][] = [];
  let cur: TextBlock[] = [];
  let chars = 0;
  for (const b of blocks) {
    if (cur.length && (cur.length >= BATCH_BLOCKS || chars + b.text.length > BATCH_CHARS)) { out.push(cur); cur = []; chars = 0; }
    cur.push(b);
    chars += b.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A failed run in a few words, for "Not translated: ...". The words are Translate's own (AI_WORDS speaks of forms). */
const SHORT: Partial<Record<AiFailure, string>> = {
  busy: "the AI is busy, try again later",
  "not-genuine": "Distill could not prove it is genuine to the AI service",
  "device-only": "the AI model on this device is not ready",
  "not-configured": "AI is off in this copy of Distill",
  other: "something went wrong with the AI",
};
export function shortReason(e: unknown): string {
  const err = toAiError(e);
  return SHORT[err.kind] ?? err.message.replace(/\.$/, "");
}

export interface TranslateRun {
  translated: number;
  total: number;
  dropped: number;
  source?: InferenceSource;
  reason?: string;
  /** Set when a call failed after some blocks were already on the page. */
  error?: unknown;
}

/** Where the whole translation ran: "on device" only if every call ran there. */
export function overallSource(sources: readonly InferenceSource[]): InferenceSource | undefined {
  if (!sources.length) return undefined;
  return sources.every((s) => s === sources[0]) ? sources[0] : "in_cloud";
}

/**
 * Translates `blocks` batch by batch: each answer passes the door (parseTranslation) and goes into the page as it
 * arrives. Throws when the first call fails (the page stays as it was); a later failure keeps what is already there.
 */
export async function translateBlocks(
  blocks: readonly TextBlock[], from: string, to: string,
  call: (prompt: string, batch: TextBlock[]) => Promise<RunResult<unknown>>,
  put: (blocks: TextBlock[]) => Promise<number>,
): Promise<TranslateRun> {
  const out: TranslateRun = { translated: 0, total: blocks.length, dropped: 0 };
  const sources: InferenceSource[] = [];
  for (const batch of batches(blocks)) {
    let r: RunResult<unknown>;
    try {
      r = await call(prompts.translateBlocks(batch, to, from), batch);
    } catch (e) {
      if (!out.translated) throw e;
      out.error = e;
      break;
    }
    const t = parseTranslation(r.data, batch);
    out.dropped += t.dropped;
    sources.push(r.source);
    out.reason = r.reason;
    if (t.blocks.length) out.translated += await put(t.blocks);
  }
  out.source = overallSource(sources);
  return out;
}

// ---- E2E ONLY: the stand-in model -------------------------------------------------------------------------------
// The e2e build has no Firebase project and no Gemini Nano, so run() can only say "AI is off". A test that wants a
// translation switches the dev fake model on for this session (chrome.storage.session, key below) before it starts the
// caption. `vite build --mode e2e` keeps this; in every other build the MODE comparison is replaced at build time and
// the branch, with its import of the fake, is dead code (like the fake helper in background.ts).
export const E2E_FAKE_AI_KEY = "distill:e2e:fakeAi";
interface E2eFake { fail?: string; source?: InferenceSource; delayMs?: number }

async function e2eFake(): Promise<E2eFake | null> {
  if (import.meta.env.MODE !== "e2e") return null;
  try {
    const got = (await chrome.storage.session.get(E2E_FAKE_AI_KEY))[E2E_FAKE_AI_KEY] as E2eFake | undefined;
    return got ?? null;
  } catch { return null; }
}

async function runTranslate(prompt: string, batch: TextBlock[]): Promise<RunResult<unknown>> {
  if (import.meta.env.MODE === "e2e") {
    const fake = await e2eFake();
    if (fake) {
      const started = performance.now();
      const { fakeRun } = await import("../../../../web/src/dev/fake-ai");
      if (fake.delayMs) await new Promise((r) => setTimeout(r, Math.min(fake.delayMs ?? 0, 10_000)));
      try {
        const data = fakeRun("translateBlocks", { blocks: batch }, fake.fail);
        return { data, source: fake.source ?? "on_device", ms: Math.round(performance.now() - started), reason: "Fake AI (e2e build only)" };
      } catch (e) { throw toAiError(e); }
    }
  }
  return run("translateBlocks", prompt, schemas.translate, { blocks: batch });
}

/** Whether AI can answer here at all (else Translate does not start: the status keeps "Page in <language>"). */
async function canRun(): Promise<boolean> {
  if (import.meta.env.MODE === "e2e" && (await e2eFake())) return true;
  return aiAvailable();
}
// ------------------------------------------------------------------------------------------------------------------

export function useTranslate(report: CleanReport | null): Translate {
  const [state, setState] = useState<TranslateState>({ phase: "idle", showingSource: false });
  const started = useRef(false);
  const now = useRef(state);
  now.current = state;
  /** Later runs (text the page added): one at a time, the ids handed over so far, where each run ran. */
  const later = useRef({ busy: false, again: false, seen: new Set<string>(), sources: [] as InferenceSource[] });

  const put = useCallback(async (b: TextBlock[]) =>
    (await send<"distill:caption:translated">({ type: "distill:caption:translated", blocks: b })).applied, []);

  useEffect(() => {
    if (!report || started.current || !wantsTranslation(report)) return;
    started.current = true;
    const from = primary(report.lang);
    const to = readerLang();
    void (async () => {
      if (!(await canRun())) return;
      const blocks = await send<"distill:caption:blocks">({ type: "distill:caption:blocks" }).catch(() => [] as TextBlock[]);
      if (!blocks.length) return; // nothing of the main text to translate: the status keeps "Page in <language>"
      setState((s) => ({ ...s, phase: "translating", from, to, total: blocks.length }));
      try {
        const r = await translateBlocks(blocks, from, to, runTranslate, put);
        if (!r.translated) {
          setState((s) => ({ ...s, phase: "failed", problem: "the AI's answer could not be used", dropped: r.dropped, total: r.total }));
          return;
        }
        if (r.error) console.warn("[distill] Translate stopped part way:", r.error);
        blocks.forEach((b) => later.current.seen.add(b.id));
        if (r.source) later.current.sources.push(r.source);
        setState((s) => ({
          ...s, phase: "done", source: r.source, reason: r.reason, translated: r.translated, total: r.total, dropped: r.dropped,
        }));
        // From now on, text the page adds or rewrites is translated too (the page side counts it and tells this frame).
        void send({ type: "distill:caption:watchText", tabId }).catch(() => undefined);
      } catch (e) {
        setState((s) => ({ ...s, phase: "failed", problem: shortReason(e) }));
      }
    })();
  }, [report, put]);

  /** The page added or rewrote text: translate the blocks still waiting, the same way, while the translation shows. */
  const translateMore = useCallback(async () => {
    const run = later.current;
    if (run.busy) { run.again = true; return; }
    run.busy = true;
    try {
      do {
        run.again = false;
        const s = now.current;
        if (s.phase !== "done" || s.showingSource || !s.from || !s.to) return;
        const blocks = await send<"distill:caption:blocks">({ type: "distill:caption:blocks" }).catch(() => [] as TextBlock[]);
        if (!blocks.length) continue;
        blocks.forEach((b) => run.seen.add(b.id));
        try {
          const r = await translateBlocks(blocks, s.from, s.to, runTranslate, put);
          if (r.error) console.warn("[distill] Translate stopped part way on the page's new text:", r.error);
          if (r.source) run.sources.push(r.source);
          setState((p) => ({
            ...p, translated: (p.translated ?? 0) + r.translated, total: run.seen.size, dropped: (p.dropped ?? 0) + r.dropped,
            source: overallSource(run.sources) ?? p.source, reason: r.reason ?? p.reason,
          }));
        } catch (e) {
          console.warn("[distill] Translate could not translate the page's new text:", e);
        }
      } while (run.again);
    } finally {
      run.busy = false;
    }
  }, [put]);

  useEffect(() => {
    const onMessage = (m: unknown) => { if (isCaptionMoreText(m) && m.tabId === tabId) void translateMore(); };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [translateMore]);

  const keepSource = useCallback(async (on: boolean) => {
    await send({ type: "distill:caption:sourceText", on });
    setState((s) => ({ ...s, showingSource: on }));
  }, []);

  return { state, keepSource };
}

/** The source chip: "No AI used" until a translation is on the page, then where it ran. `data` carries Translate's
 *  phase and counts (no text) for the live run to read. */
export function sourceChip(state: TranslateState): { src: "none" | InferenceSource; text: string; title: string; data: Record<string, string> } {
  const data: Record<string, string> = { "data-translate": state.phase };
  if (state.total !== undefined) data["data-blocks"] = `${state.translated ?? 0}/${state.total}`;
  if (state.dropped) data["data-dropped"] = String(state.dropped);
  if (state.phase !== "done" || !state.source) {
    return { src: "none", text: "No AI used", title: "Clean reads the page's own structure on this device. No AI is used and nothing is sent anywhere.", data };
  }
  const where = state.source === "on_device" ? "on this device" : state.source === "in_cloud" ? "in the cloud" : "by your own agent";
  return {
    data,
    src: state.source,
    text: state.source === "on_device" ? "On this device" : state.source === "in_cloud" ? "In the cloud" : "Your agent",
    title: `The translation from ${langName(state.from ?? "und")} ran ${where}${state.source === "in_cloud" ? " (the page's text was sent, nothing of yours)" : ""}. ${state.reason ?? ""} Clean used no AI.`.replace(/\s+/g, " ").trim(),
  };
}

export function TranslateRow(props: { report: CleanReport; translate: Translate }) {
  const { state, keepSource } = props.translate;
  if (state.phase !== "done") return null;
  const label = state.showingSource ? `Show ${langName(state.to ?? readerLang())}` : `Keep ${langName(state.from ?? props.report.lang)}`;
  return (
    <button type="button" className="btn quiet" data-testid="cap-keep-source" onClick={() => void keepSource(!state.showingSource)}>
      {label}
    </button>
  );
}
