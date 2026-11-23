// Spark universal-core round 2, card 10: the gist of an article in three points (task gist, on device). Each point
// names the sentence of the page it came from; a point whose sentence is not in the page is dropped and counted, so
// the gist cannot say what the article does not.
import { isObj } from "./sanitize.js";
import type { TranslateBlock } from "./translate.js";

export interface GistPoint {
  /** The point, one short plain sentence. */
  text: string;
  /** Where it came from: the block id and the sentence exactly as the page has it. */
  blockId: string;
  sentence: string;
}

export interface Gist { points: GistPoint[]; dropped: number }

export const GIST_POINTS = 3;
/** A point is one short sentence; a longer "point" is a paragraph the model wrote. */
export const GIST_POINT_MAX = 240;
/** A source shorter than this is a word or two, not the sentence a point rests on. */
const MIN_SENTENCE = 12;
const TAG = /<\/?[a-z!?][^>]*>?|&(?:lt|gt|#0*60|#x0*3c);/i;
/** Control characters (a point is one plain line). */
const CONTROL = /\p{Cc}/u;

/** One character for each: curly and low quotes to straight, dashes to "-", odd spaces to " ". Length stays the same,
 *  so a position in the folded text is a position in the page's text. */
function fold(s: string): string {
  return s
    .replace(/[„“”«»″]/g, '"')
    .replace(/[‚‘’‹›′`]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[\s  -   　]/g, " ");
}

/** Where `sentence` is in `text` (quotes, dashes and runs of spaces not counted), as the page's own words; else null. */
export function findSentence(text: string, sentence: string): string | null {
  const want = fold(sentence).replace(/ +/g, " ").trim();
  if (want.length < MIN_SENTENCE) return null;
  // The block's words with runs of spaces folded to one, keeping where each character came from.
  const src = fold(text);
  let flat = "";
  const at: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === " " && flat.endsWith(" ")) continue;
    flat += src[i];
    at.push(i);
  }
  const hit = flat.indexOf(want);
  if (hit < 0) return null;
  const from = at[hit] as number;
  const to = (at[hit + want.length - 1] as number) + 1;
  return text.slice(from, to);
}

/**
 * The door for gist's answer ({points: [{text, blockId, sentence}]}, or a bare list). A point stays only when its
 * block is one of `blocks` and its sentence is found in that block (findSentence); its text is plain (no markup, no
 * control characters), short, and not empty. At most GIST_POINTS; everything refused is counted. The sentence kept is
 * the page's own, so "Show me" finds it.
 */
export function parseGist(answer: unknown, blocks: readonly TranslateBlock[]): Gist {
  const list: unknown[] | null = Array.isArray(answer) ? answer : isObj(answer) && Array.isArray(answer.points) ? answer.points : null;
  if (!list) return { points: [], dropped: answer === undefined || answer === null ? 0 : 1 };
  const byId = new Map(blocks.map((b) => [b.id, b.text]));
  const points: GistPoint[] = [];
  let dropped = 0;
  for (const item of list) {
    const { text, blockId, sentence } = (isObj(item) ? item : {}) as { text?: unknown; blockId?: unknown; sentence?: unknown };
    const block = typeof blockId === "string" ? byId.get(blockId) : undefined;
    const plain = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
    const found = block !== undefined && typeof sentence === "string" ? findSentence(block, sentence) : null;
    if (points.length >= GIST_POINTS || !plain || plain.length > GIST_POINT_MAX || TAG.test(plain) || CONTROL.test(plain) || !found) {
      dropped++;
      continue;
    }
    points.push({ text: plain, blockId: blockId as string, sentence: found });
  }
  return { points, dropped };
}
