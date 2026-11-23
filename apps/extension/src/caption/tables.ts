// Spark universal-core round 2, card 5: tables of the main text you can read. Header row kept in view, a wide table
// scrolls inside itself, on a phone a narrow table becomes one card per row. Reversible. STUB (contract commit).
import type { CleanContext } from "./context";

/** Makes the main text's tables readable; returns how many it changed. */
export function readableTables(_ctx: CleanContext): number {
  return 0;
}

/** The switch in More: on (true) or off. Returns how many tables are changed now. */
export function setTables(_doc: Document, _on: boolean): number {
  return 0;
}

/** Takes every change off (close). */
export function clearTables(_doc: Document): void {}
