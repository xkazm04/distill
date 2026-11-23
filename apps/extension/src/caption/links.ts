// Spark universal-core round 2, card 7: where a link of the main text goes, shown on pointing (or a long press).
// Read from the link alone (engine describeLink): no request is made. STUB (contract commit).
import type { CleanContext } from "./context";

/** Starts the link notes for the main text. */
export function linkNotes(_ctx: CleanContext): void {}

/** The switch in More. */
export function setLinks(_doc: Document, _on: boolean): void {}

/** Takes the notes and their listeners off (close). */
export function clearLinks(_doc: Document): void {}
