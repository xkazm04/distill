// The saved papers (tiger 2026-11-25, L1): a person's identity facts, keyed by fact (surname, birth date, ...), kept to
// propose on the next form. DEVICE ONLY: localStorage `distill.papers.v1` (web) / the side panel's own origin
// (extension). Never synced, never sent: nothing in this file touches the network or Firestore, and no prompt builder
// takes Papers. Opt-in: the caller saves only while the person's "Remember my answers" is on, and only answers the page
// read back as written (writeValues' `written`). One call deletes everything.
import { engine, type FormStructure, type FormValues, type Papers } from "./engine";

export const PAPERS_KEY = "distill.papers.v1";

/** The saved papers, or {} when there are none or storage is blocked. Anything not a known fact is dropped. */
export function loadPapers(): Papers {
  try {
    const raw = JSON.parse(localStorage.getItem(PAPERS_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Papers = {};
    for (const [k, v] of Object.entries(raw)) if (engine.isPaperConcept(k) && typeof v === "string" && v) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Saves the facts among the answers the page read back as written: `readBack` is what the page holds after the write
 * (readValues), `written` the fields writeValues confirmed. A newer answer replaces an older one. Returns the papers now
 * saved.
 */
export function rememberPapers(structure: FormStructure, readBack: FormValues, written: readonly string[]): Papers {
  const found = engine.papersFrom(structure, readBack, written);
  if (!Object.keys(found).length) return loadPapers();
  const next = { ...loadPapers(), ...found };
  try { localStorage.setItem(PAPERS_KEY, JSON.stringify(next)); } catch { /* storage blocked: nothing is remembered */ }
  return next;
}

/** Deletes every saved fact. */
export function clearPapers(): void {
  try { localStorage.removeItem(PAPERS_KEY); } catch { /* nothing to clear */ }
}

/** What the saved papers propose for the empty fields of this form (fieldId -> value in that field's format). */
export function proposePapers(structure: FormStructure, filled: FormValues): FormValues {
  return engine.proposeFromPapers(structure, loadPapers(), filled);
}
