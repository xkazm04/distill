// Round 4, card 4 (r4-04): a form in your language. The form's own words (labels, hints, placeholders, the options of
// each list, buttons) are read and swapped in place like Translate's text; a value the person typed is never read, and
// an error message (which can repeat it) only for an on-device translation. Keep <language>, Original and close bring
// every word back; the form submits exactly what it did before. CONTRACT STUB: the r4-04 builder fills it in.
import type { TextBlock } from "../messages";

export function formText(_doc: Document): TextBlock[] {
  return [];
}

export function applyFormText(_doc: Document, _blocks: readonly TextBlock[]): number {
  return 0;
}

export function formErrors(_doc: Document): TextBlock[] {
  return [];
}

export function applyFormErrors(_doc: Document, _blocks: readonly TextBlock[]): number {
  return 0;
}

export function formSource(_doc: Document, _on: boolean): void {}
