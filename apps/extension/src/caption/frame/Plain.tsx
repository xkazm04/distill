// Spark universal-core round 2, card 4: plain words in place (Plain / As written), the same swap as Translate. Plain
// rewrites each long block of the main text in short sentences, as the page shows it (a translated page's translation,
// else the page's words), with the existing task simplifyBlocks (prompt class `page`, on the device first). Every
// answer passes ONE door, parsePlain: only the blocks handed over, plain text, and every number, date, amount, link and
// name of the block kept; a rewrite that loses one is refused, its block stays as written and the strip counts it.
// Plain never starts by itself (docs/caption.md, decision 3: only Clean and Translate do). While it is on, text the
// page adds or rewrites later is handled as Translate handles it: the page side counts it, the frame asks for it.
import { useCallback, useEffect, useRef, useState } from "react";
import { parsePlain, prompts, schemas, type FactKind, type InferenceSource } from "@distill/engine";
import { isCaptionMoreText, type CleanReport, type TextBlock } from "../../messages";
import { canRunTask, runTask, type TaskCall } from "./runTask";
import { send, tabId } from "./send";
import { langName } from "./status";
import { batches, OFFSCREEN_WORDS, overallSource, readerLang, shortReason, wantsTranslation, type Translate } from "./Translate";

export interface PlainState {
  /** idle: never asked; working: rewriting; on: plain words show; off: As written again; failed: nothing to show. */
  phase: "idle" | "working" | "on" | "off" | "failed";
  /** A model can answer here (else the control is not offered, as Translate does not start). */
  available: boolean;
  /** Where the rewrites ran (the SDK response), once some are on the page. */
  source?: InferenceSource;
  reason?: string;
  via?: "offscreen";
  /** Blocks showing plain words now, of the blocks handed over in all. */
  shown: number;
  total: number;
  /** Rewrites refused because a fact would have been lost, and the kind of each; refused for any other reason. */
  lostFacts: number;
  lostKinds: FactKind[];
  dropped: number;
  /** Once failed: why, in a few plain words. */
  problem?: string;
}

export interface Plain { state: PlainState; toggle(): Promise<void> }

export interface PlainRun {
  applied: number;
  total: number;
  lostFacts: number;
  lostKinds: FactKind[];
  dropped: number;
  source?: InferenceSource;
  reason?: string;
  via?: "offscreen";
  /** Set when a call failed after some blocks were already rewritten. */
  error?: unknown;
}

/**
 * Rewrites `blocks` batch by batch: each answer passes the door (parsePlain, against the words handed over) and goes
 * into the page as it arrives. Throws when the first call fails and nothing is on the page yet.
 */
export async function plainRun(
  blocks: readonly TextBlock[], lang: string,
  call: (prompt: string, batch: TextBlock[]) => Promise<TaskCall<unknown>>,
  put: (blocks: TextBlock[]) => Promise<number>,
): Promise<PlainRun> {
  const out: PlainRun = { applied: 0, total: blocks.length, lostFacts: 0, lostKinds: [], dropped: 0 };
  const sources: InferenceSource[] = [];
  let answered = 0;
  for (const batch of batches(blocks)) {
    let r: TaskCall<unknown>;
    try {
      r = await call(prompts.plainBlocks(batch, lang), batch);
    } catch (e) {
      if (!answered) throw e;
      out.error = e;
      break;
    }
    answered++;
    const p = parsePlain(r.data, batch);
    out.lostFacts += p.lostFacts;
    out.lostKinds.push(...p.lostKinds);
    out.dropped += p.dropped;
    sources.push(r.source);
    out.reason = r.reason;
    if (r.via) out.via = r.via;
    if (p.blocks.length) out.applied += await put(p.blocks);
  }
  out.source = overallSource(sources);
  return out;
}

const runPlain = (prompt: string, batch: TextBlock[]) =>
  runTask<unknown>("simplifyBlocks", prompt, schemas.translate, { blocks: batch });

const primary = (lang: string): string => lang.split("-")[0]?.toLowerCase() || "und";

export function usePlain(report: CleanReport | null, translate: Translate): Plain {
  const [state, setState] = useState<PlainState>({ phase: "idle", available: false, shown: 0, total: 0, lostFacts: 0, lostKinds: [], dropped: 0 });
  const now = useRef(state);
  now.current = state;
  const tr = useRef(translate.state);
  tr.current = translate.state;
  const busy = useRef({ running: false, again: false, sources: [] as InferenceSource[] });

  useEffect(() => {
    if (!report) return;
    let live = true;
    void canRunTask().then((ok) => { if (live) setState((s) => ({ ...s, available: ok })); });
    return () => { live = false; };
  }, [report]);

  /** The language of the words Plain rewrites: the translation's while it shows, else the page's. */
  const lang = useCallback((): string => {
    const t = tr.current;
    if (t.phase === "done" && !t.showingSource) return t.to ?? readerLang();
    return primary(report?.lang ?? "und");
  }, [report]);

  const put = useCallback(async (b: TextBlock[]) =>
    (await send<"distill:caption:plainText">({ type: "distill:caption:plainText", blocks: b })).applied, []);

  const waiting = useCallback(() => send<"distill:caption:plainBlocks">({ type: "distill:caption:plainBlocks" }), []);

  /** Rewrites blocks the page handed over; adds the counts. Throws as plainRun does. */
  const rewrite = useCallback(async (blocks: TextBlock[]): Promise<PlainRun> => {
    setState((s) => ({ ...s, total: s.total + blocks.length }));
    const r = await plainRun(blocks, lang(), runPlain, put);
    if (r.error) console.warn("[distill] Plain words stopped part way:", r.error);
    if (r.source) busy.current.sources.push(r.source);
    setState((s) => ({
      ...s, lostFacts: s.lostFacts + r.lostFacts, lostKinds: [...s.lostKinds, ...r.lostKinds], dropped: s.dropped + r.dropped,
      source: overallSource(busy.current.sources) ?? s.source, reason: r.reason ?? s.reason, ...(r.via ? { via: r.via } : {}),
    }));
    return r;
  }, [lang, put]);

  const shownNow = useCallback(async (on: boolean) =>
    (await send<"distill:caption:plainShown">({ type: "distill:caption:plainShown", on })).shown, []);

  const toggle = useCallback(async () => {
    const s = now.current;
    if (s.phase === "working") return;
    if (s.phase === "on") {
      await shownNow(false);
      setState((p) => ({ ...p, phase: "off" }));
      return;
    }
    setState((p) => ({ ...p, phase: "working", problem: undefined }));
    busy.current.running = true;
    try {
      // The blocks first (read as the page shows them), then Plain on: what was rewritten before shows at once, the
      // rest as each answer comes in.
      const blocks = await waiting();
      await shownNow(true);
      let run: PlainRun | null = null;
      let failure: unknown = null;
      if (blocks.length) {
        try { run = await rewrite(blocks); } catch (e) { failure = e; }
      }
      const shown = await shownNow(true);
      if (!shown) {
        await shownNow(false);
        const problem = failure ? shortReason(failure)
          : !run ? "nothing here is long enough to need plainer words"
          : run.lostFacts ? "every rewrite would have changed a fact, so the words stay as written"
          : "the AI's answer could not be used";
        setState((p) => ({ ...p, phase: "failed", shown: 0, problem }));
        return;
      }
      setState((p) => ({ ...p, phase: "on", shown }));
      // From now on, text the page adds or rewrites gets plain words too (the page side counts it and tells this frame).
      void send({ type: "distill:caption:watchText", tabId }).catch(() => undefined);
    } catch (e) {
      setState((p) => ({ ...p, phase: "failed", problem: shortReason(e) }));
    } finally {
      busy.current.running = false;
    }
  }, [waiting, rewrite, shownNow]);

  /** The page added or rewrote text while plain words show: rewrite what waits, the same way. */
  const more = useCallback(async () => {
    const run = busy.current;
    if (run.running) { run.again = true; return; }
    run.running = true;
    try {
      do {
        run.again = false;
        if (now.current.phase !== "on") return;
        try {
          const blocks = await waiting();
          if (!blocks.length) continue;
          await rewrite(blocks);
          // Plain may have gone off meanwhile (As written, Keep <language>): then it stays off.
          if (now.current.phase !== "on") return;
          const shown = await shownNow(true);
          setState((p) => ({ ...p, shown }));
        } catch (e) {
          console.warn("[distill] Plain words could not rewrite the page's new text:", e);
        }
      } while (run.again);
    } finally {
      run.running = false;
    }
  }, [waiting, rewrite, shownNow]);

  useEffect(() => {
    const onMessage = (m: unknown) => { if (isCaptionMoreText(m) && m.tabId === tabId) void more(); };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [more]);

  // Keep <language>: the page shows its own words as written (the page side turned plain words off with it).
  const showingSource = translate.state.showingSource;
  useEffect(() => {
    if (showingSource && (now.current.phase === "on" || now.current.phase === "working")) setState((p) => ({ ...p, phase: "off" }));
  }, [showingSource]);

  return { state, toggle };
}

/** Why rewrites were refused, in a few words: "a number would have changed". */
export function lostWhy(kinds: readonly FactKind[]): string {
  const set = new Set(kinds);
  if (set.size !== 1) return "a number, date or name would have changed";
  switch ([...set][0]) {
    case "number": return "a number would have changed";
    case "date": return "a date would have changed";
    case "amount": return "an amount would have changed";
    case "link": return "a link would have been lost";
    default: return "a name would have been lost";
  }
}

/** Plain's part of the status line, or null: "Plain words · 2 parts kept as written: a number would have changed". */
export function plainPart(state: PlainState): string | null {
  switch (state.phase) {
    case "working": return "Rewriting in plain words...";
    case "failed": return `Not rewritten: ${state.problem ?? "something went wrong with the AI"}`;
    case "on": {
      if (!state.lostFacts) return "Plain words";
      return `Plain words · ${state.lostFacts} ${state.lostFacts === 1 ? "part" : "parts"} kept as written: ${lostWhy(state.lostKinds)}`;
    }
    default: return null;
  }
}

/** The status line with Plain's part first (the person's latest choice is what the line speaks of first). */
export function withPlain(status: string, state: PlainState): string {
  const part = plainPart(state);
  return part ? `${part} · ${status}` : status;
}

type Chip = { src: "none" | InferenceSource; text: string; title: string; data: Record<string, string> };

const WHERE: Record<InferenceSource, string> = { on_device: "on this device", in_cloud: "in the cloud", agent: "by your own agent" };
const CHIP_TEXT: Record<InferenceSource, string> = { on_device: "On this device", in_cloud: "In the cloud", agent: "Your agent" };

/**
 * The source chip with plain words: while they show, where they ran (from the run's own answer) and, when a translation
 * shows too, where it ran ("In the cloud" if either did). `data` adds Plain's phase and counts (no text).
 */
export function plainChip(chip: Chip, state: PlainState, translateSource?: InferenceSource): Chip {
  const data = { ...chip.data };
  if (state.phase !== "idle") data["data-plain"] = state.phase;
  if (state.total) data["data-plain-blocks"] = `${state.shown}/${state.total}`;
  if (state.lostFacts) data["data-plain-lost"] = String(state.lostFacts);
  if (state.dropped) data["data-plain-dropped"] = String(state.dropped);
  if (state.phase !== "on" || !state.source) return { ...chip, data };
  const src = overallSource(chip.src === "none" ? [state.source] : [state.source, translateSource ?? chip.src as InferenceSource]) ?? state.source;
  const plainTitle = `The plain words ran ${WHERE[state.source]}${state.source === "in_cloud" ? " (the page's text was sent, nothing of yours)" : ""}. ${state.reason ?? ""} ${state.via === "offscreen" ? OFFSCREEN_WORDS : ""}`;
  const rest = chip.src === "none" ? "Clean used no AI." : chip.title;
  return { src, text: CHIP_TEXT[src], title: `${plainTitle} ${rest}`.replace(/\s+/g, " ").trim(), data: { ...data, ...(state.via ? { "data-plain-via": state.via } : {}) } };
}

/** The strip's Plain / As written control. Not offered while no model can run, nor while Translate is still to come
 *  on a page it will translate (Plain rewrites the page as it shows, and the translation would change that). */
export function PlainRow(props: { report: CleanReport; plain: Plain; translate: Translate }) {
  const { state, toggle } = props.plain;
  const t = props.translate.state;
  if (!state.available) return null;
  if (wantsTranslation(props.report) && (t.phase === "idle" || t.phase === "translating")) return null;
  const on = state.phase === "on";
  const working = state.phase === "working";
  const lang = langName(t.phase === "done" && !t.showingSource ? t.to ?? readerLang() : primary(props.report.lang));
  return (
    <button type="button" className="btn quiet" data-testid="cap-plain" aria-busy={working || undefined} disabled={working}
      title={on ? "Show the words as the page wrote them" : `Rewrite the main text in short, plain sentences (${lang}). Numbers, dates, amounts and names stay as written.`}
      onClick={() => void toggle()}>
      {working ? "Plain..." : on ? "As written" : "Plain"}
    </button>
  );
}
