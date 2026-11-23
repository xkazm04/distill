// Spark universal-core round 2, card 10: the gist of an article in three points (task gist, on device). Each point
// names the sentence of the page it came from; a point whose sentence is not in the page is dropped and counted, so
// the gist cannot say what the article does not. STUB (contract commit): the round-2 builder fills it.
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

/** The door for gist's answer ({points: [{text, blockId, sentence}]}). */
export function parseGist(_answer: unknown, _blocks: readonly TranslateBlock[]): Gist {
  return { points: [], dropped: 0 };
}
