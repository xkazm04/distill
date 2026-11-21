// #8 Calm the page: media that started by itself is paused (not the main video the page is for: ctx.protect), carousels,
// marquees and animations stop. Each can play again. STUB: owned by the round-1 builder W2.
import type { CleanContext } from "./context";

/** Pauses and stops; returns the counts. */
export function calmPage(ctx: CleanContext): { media: number; motion: number } { void ctx; return { media: 0, motion: 0 }; }
/** Lets everything Calm stopped play and move again. */
export function playAgain(doc: Document): void { void doc; }
/** Takes every change back (close). */
export function clearCalm(doc: Document): void { void doc; }
