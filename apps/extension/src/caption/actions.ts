// Round 3, card 9 (r3-09): what this page asks of you. Reads the main text (readMainText), finds the actions (engine
// findActions), keeps where each was found, highlights their exact words and scrolls to one.
// CONTRACT STUB: the r3-09 builder fills it in.
import type { ActionItem } from "../messages";
import type { CleanContext } from "./context";

export function readActions(_ctx: CleanContext): ActionItem[] {
  return [];
}

export function markActions(_doc: Document, _on: boolean): number {
  return 0;
}

export function showAction(_doc: Document, _id: string): boolean {
  return false;
}
