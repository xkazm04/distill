// #4 Things that float over the page: a sticky header taller than 12% of the window scrolls with the page instead of
// covering it (its menu stays reachable). Small floating widgets (chat, feedback, a sticky player, an app banner) are
// found by the engine's findClutter. STUB: owned by the round-1 builder W2.
import type { CleanContext } from "./context";

/** Makes tall sticky headers scroll with the page; returns how many. */
export function unstick(ctx: CleanContext): number { void ctx; return 0; }
/** Takes every change back (close). */
export function restick(doc: Document): void { void doc; }
