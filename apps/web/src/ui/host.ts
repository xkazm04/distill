// What the shared UI needs from "the page it is looking at". The web app implements it over a sandboxed iframe holding
// pasted or demo HTML; the extension implements it over messages to a content script in the real tab.
import type { FormStructure, FormValues, PageAction, PageModel } from "@distill/engine";
import type { ReactNode } from "react";

export interface PageHost {
  /** Short label for the header: the page title or host name. */
  label(): string;
  getPage(): Promise<PageModel>;
  /** Structure only. Rejects with a plain-words Error when the page has no form. */
  getForm(formIndex?: number): Promise<FormStructure>;
  /** Device-only. The result must never be put in a cloud-eligible prompt. */
  readValues(structure: FormStructure): Promise<FormValues>;
  writeValues(structure: FormStructure, values: FormValues): Promise<{ written: string[]; failed: string[] }>;
  /** Outline these fields in the original page (empty array clears) in `color`: the active theme's accent, resolved
   *  by the caller with `accentColor()`. Hosts pass it to `applyHighlight`, which falls back when it is unreadable. */
  highlight(fieldIds: string[], color?: string): Promise<void>;
  /** Show (true) or hide (false) the untouched original. In the extension the original is the tab itself. */
  showOriginal(on: boolean): Promise<void>;
  /** Web only: the pane that holds the original page (the iframe). Always mounted, shown when `original` is on. */
  originalPane?(visible: boolean): ReactNode;
  /**
   * Outline `target` in the original in the theme's focus colour and scroll it into view (instantly under reduced
   * motion); null clears it. Never touches the outline that `highlight` put on filled fields. The web app calls it while
   * the original is beside Distill; the extension always, because there the tab itself is beside the panel.
   */
  locate?(target: LocateTarget | null): Promise<void>;
  /** What can be clicked in the page, by label only (engine extractActions). Extension only: the agent's page actions. */
  listActions?(): Promise<PageAction[]>;
  /** Clicks the control `actionId` of the LAST listActions. Called only after the person pressed Accept. */
  doAction?(actionId: string): Promise<void>;
}

/** What `locate` points at: a block of the PageModel (by its id) or the fields of a form step. */
export type LocateTarget = { blockId: string } | { fieldIds: string[] };
