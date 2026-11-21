// The one door for a translation of the page's text (the caption's Translate, spark universal-core #10). The model's
// answer is untrusted: only blocks the page has, plain text, never much longer than the source. What is refused is
// counted, so the caption can say so.
import { cleanText, isObj } from "./sanitize.js";

/** A block of the page's main text by its id ("t3"). Page text or its translation: never a person's values. */
export interface TranslateBlock { id: string; text: string }

export interface Translation {
  /** The translations that passed, in the source's order. */
  blocks: TranslateBlock[];
  /** Entries refused: an unknown or repeated id, no text, or a text far longer than its source. */
  dropped: number;
  /** Entries kept after their HTML tags were taken out. */
  cleaned: number;
}

/** A translation may be this many times longer than its source (and always up to MIN_ROOM characters). */
export const MAX_GROWTH = 3;
const MIN_ROOM = 24;
const TAG = /<\/?[a-z!?][^>]*>?/i;

/**
 * Reads schemas.translate ({blocks: [{id, text}]}) and the shapes a model plausibly returns anyway ([{id, text}] or
 * {id: text}). Keeps only ids of `source`, once each, with non-empty plain text no longer than MAX_GROWTH times the
 * source block. HTML is stripped (counted in `cleaned`); everything else that fails is counted in `dropped`.
 */
export function parseTranslation(answer: unknown, source: readonly TranslateBlock[]): Translation {
  const src = new Map(source.map((b) => [b.id, b.text]));
  const list: unknown[] | null = Array.isArray(answer) ? answer
    : isObj(answer) && Array.isArray(answer.blocks) ? answer.blocks
    : isObj(answer) && !("blocks" in answer) ? Object.entries(answer).map(([id, text]) => ({ id, text }))
    : null;
  if (!list) return { blocks: [], dropped: answer === undefined || answer === null ? 0 : 1, cleaned: 0 };

  const kept = new Map<string, string>();
  let dropped = 0;
  let cleaned = 0;
  for (const item of list) {
    const { id, text } = (isObj(item) ? item : {}) as { id?: unknown; text?: unknown };
    const from = typeof id === "string" ? src.get(id) : undefined;
    if (typeof id !== "string" || from === undefined || kept.has(id) || typeof text !== "string") { dropped++; continue; }
    const plain = cleanText(text, Number.MAX_SAFE_INTEGER) ?? "";
    if (!plain || plain.length > Math.max(MAX_GROWTH * from.length, MIN_ROOM)) { dropped++; continue; }
    if (TAG.test(text)) cleaned++;
    kept.set(id, plain);
  }
  const blocks = source.filter((b) => kept.has(b.id)).map((b) => ({ id: b.id, text: kept.get(b.id) as string }));
  return { blocks, dropped, cleaned };
}
