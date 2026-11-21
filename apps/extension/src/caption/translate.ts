// #10 Translate in place: the page side. Hands the frame the main text's blocks, puts the translations in text node by
// text node, keeps the originals, and shows them again for "Keep <language>" and Original. STUB: owned by W4.
import type { TextBlock } from "../messages";
import type { CleanContext } from "./context";

/** The blocks of the main text to translate, by id. */
export function textBlocks(ctx: CleanContext): TextBlock[] { void ctx; return []; }
/** Puts translations into the page; returns how many blocks changed. */
export function applyTranslation(blocks: readonly TextBlock[]): number { void blocks; return 0; }
/** The page's own words (true) or the translation (false). */
export function showSource(on: boolean): void { void on; }
/** Takes every change back (close). */
export function clearTranslation(): void { /* stub */ }
/** Original was turned on or off: while on, the page shows its own words whatever the translation state. */
export function originalShown(on: boolean): void { void on; }
