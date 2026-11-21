// #6 Comfortable to read: on the main text only, a minimum size, line height, line length and contrast. Applied at Clean
// when the page needs it; one switch in More turns it off; Original removes it. STUB: owned by the round-1 builder W1.
import type { CleanContext } from "./context";

/** Applies the layer where the main text needs it; returns how many blocks it changes. */
export function applyComfort(ctx: CleanContext): number { void ctx; return 0; }
/** The person's switch: on or off again; returns how many blocks it changes when on (0 when off). */
export function setComfort(doc: Document, on: boolean): number { void doc; void on; return 0; }
/** Takes every change back (close). */
export function clearComfort(doc: Document): void { void doc; }
