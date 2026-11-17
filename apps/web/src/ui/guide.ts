// The form guide currently open in the panel, so Handrail can report it (form.schema) and move it (wizard.next).
import type { FormStructure, Wizard, WizardStep } from "@distill/engine";

export interface OpenGuide {
  structure: FormStructure;
  wizard: Wizard;
  /** Moves to the next step (stays on the last one) and returns the step now shown. */
  advance(): WizardStep | null;
}

let current: OpenGuide | null = null;
export const setGuide = (g: OpenGuide | null) => { current = g; };
export const getGuide = (): OpenGuide | null => current;
