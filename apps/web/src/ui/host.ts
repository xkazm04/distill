// What the shared UI needs from "the page it is looking at". The web app implements it over a sandboxed iframe holding
// pasted or demo HTML; the extension implements it over messages to a content script in the real tab.
import type { FormStructure, FormValues, PageModel } from "@distill/engine";
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
  /** Outline these fields in the original page (empty array clears). */
  highlight(fieldIds: string[]): Promise<void>;
  /** Show (true) or hide (false) the untouched original. In the extension the original is the tab itself. */
  showOriginal(on: boolean): Promise<void>;
  /** Web only: the pane that holds the original page (the iframe). Always mounted, shown when `original` is on. */
  originalPane?(visible: boolean): ReactNode;
}
