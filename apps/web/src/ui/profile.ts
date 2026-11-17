// The autofill profile and the person's own answers. DEVICE ONLY: localStorage (web) / the side panel's own origin
// (extension). Nothing in this file touches the network or Firestore.
import type { FormValues } from "@distill/engine";

const KEY = "distill.profile.v1";

export function loadProfile(): FormValues {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FormValues) : {};
  } catch {
    return {};
  }
}

export function rememberAnswers(values: FormValues): FormValues {
  const next = { ...loadProfile() };
  for (const [k, v] of Object.entries(values)) if (v) next[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: nothing is remembered */ }
  return next;
}

export function clearProfile(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
