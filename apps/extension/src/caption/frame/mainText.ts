// Round 2 (claims r2-01, gist r2-10): the main text the strip's page tasks read, once Clean is done and, on a page
// Translate translates, once the translation is on the page (so claims and the gist speak about the words the person
// sees, and their sentences are found there). Page text only, kept inside the browser until a task sends it.
import { useEffect, useRef, useState } from "react";
import type { CleanReport, TextBlock } from "../../messages";
import { send } from "./send";
import { wantsTranslation, type TranslateState } from "./Translate";

/** An article for the gist: at least this many blocks and characters of main text. */
export const ARTICLE_MIN_BLOCKS = 3;
export const ARTICLE_MIN_CHARS = 600;
/** A page Translate should translate but has not started on after this long (no model, nothing to send): go on. */
const TRANSLATE_GRACE_MS = 5000;

/** Pages whose job is not their text: a form to fill, a shop's product, a list of links. */
const NOT_ARTICLES: ReadonlySet<CleanReport["kind"]> = new Set(["form", "product", "listing"]);

/** Whether the page reads like an article: its kind allows it and its main text is long enough. */
export function articleLike(report: Pick<CleanReport, "kind">, blocks: readonly TextBlock[]): boolean {
  if (NOT_ARTICLES.has(report.kind)) return false;
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  return blocks.length >= ARTICLE_MIN_BLOCKS && chars >= ARTICLE_MIN_CHARS;
}

/** At most this much of the main text goes to one task (the first part of an article carries its gist and claims). */
export const TASK_CHARS = 6000;
export function firstPart(blocks: readonly TextBlock[], max = TASK_CHARS): TextBlock[] {
  const out: TextBlock[] = [];
  let chars = 0;
  for (const b of blocks) {
    if (out.length && chars + b.text.length > max) break;
    out.push(b);
    chars += b.text.length;
  }
  return out;
}

/** The reading of the main text that the parts asking for the same report share (the claims and the gist ask as it
 *  arrives). Reading it is a long task on a huge page (YouTube: 60-120 ms), and two in a row held up the strip's first
 *  sight; both now get the one answer, and the same block ids. */
let shared: { report: CleanReport; phase: TranslateState["phase"] | undefined; ask: Promise<TextBlock[]> } | null = null;

function askMainText(report: CleanReport, phase: TranslateState["phase"] | undefined): Promise<TextBlock[]> {
  if (shared && shared.report === report && shared.phase === phase) return shared.ask;
  const ask = send<"distill:caption:mainText">({ type: "distill:caption:mainText" }).catch((): TextBlock[] => []);
  shared = { report, phase, ask };
  return ask;
}

/** The main text once it is settled (null until then): after Clean, and after Translate where it runs. */
export function useMainText(report: CleanReport | null, translate: TranslateState | undefined): TextBlock[] | null {
  const [blocks, setBlocks] = useState<TextBlock[] | null>(null);
  const started = useRef(false);
  const [graceOver, setGraceOver] = useState(false);
  // A site kept in its own language (r3-10) has no translation coming: the page's words are the main text.
  const waitsForTranslation = !!report && wantsTranslation(report) && !!translate && !translate.held;
  const phase = translate?.phase;

  useEffect(() => {
    if (!waitsForTranslation || phase !== "idle") return;
    const t = setTimeout(() => setGraceOver(true), TRANSLATE_GRACE_MS);
    return () => clearTimeout(t);
  }, [waitsForTranslation, phase]);

  useEffect(() => {
    if (!report || started.current) return;
    if (waitsForTranslation && phase !== "done" && phase !== "failed" && !(phase === "idle" && graceOver)) return;
    started.current = true;
    void askMainText(report, phase).then(setBlocks);
  }, [report, waitsForTranslation, phase, graceOver]);

  return blocks;
}
