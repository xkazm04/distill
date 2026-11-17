// Firestore access. The ONLY documents written are the ones in types.ts: UserSettingsDoc, GlossaryDoc, FormGuideDoc.
// None of them has a value field. `assertNoValues` is a second lock behind the rules file.
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
import type { FormGuideDoc, FormStructure, GlossaryDoc, UserSettingsDoc, Wizard } from "@distill/engine";
import { getFirebase } from "../firebase";

export const DEFAULT_SETTINGS: UserSettingsDoc = { readingLevel: "standard", readerLang: "en", recastEnabled: true };
const LOCAL_KEY = "distill.settings.v1";

export function loadLocalSettings(): UserSettingsDoc {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}") as Partial<UserSettingsDoc>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Throws when a document about to be written carries a `values` key anywhere in its first two levels. */
export function assertNoValues(data: unknown, path = "doc", depth = 0): void {
  if (!data || typeof data !== "object" || depth > 2) return;
  for (const [k, v] of Object.entries(data)) {
    if (k === "values") throw new Error(`Refusing to write a "values" key to Firestore (${path}).`);
    assertNoValues(v, `${path}.${k}`, depth + 1);
  }
}

export async function saveSettings(s: UserSettingsDoc): Promise<void> {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  const fb = await getFirebase();
  if (!fb?.uid) return;
  assertNoValues(s, "users");
  await setDoc(doc(fb.db, "users", fb.uid), s);
}

export async function loadRemoteSettings(): Promise<UserSettingsDoc | null> {
  const fb = await getFirebase();
  if (!fb?.uid) return null;
  const snap = await getDoc(doc(fb.db, "users", fb.uid));
  return snap.exists() ? ({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<UserSettingsDoc>) }) : null;
}

export async function saveGlossaryTerm(termId: string, g: GlossaryDoc): Promise<void> {
  const fb = await getFirebase();
  if (!fb?.uid) return;
  assertNoValues(g, "glossary");
  await setDoc(doc(fb.db, "users", fb.uid, "glossary", termId), g);
}

export async function listGlossary(): Promise<GlossaryDoc[]> {
  const fb = await getFirebase();
  if (!fb?.uid) return [];
  const snap = await getDocs(collection(fb.db, "users", fb.uid, "glossary"));
  return snap.docs.map((d) => d.data() as GlossaryDoc);
}

// Form guides are per person for now (owner, 2026-11-17: "Per-person cache now, shared later"):
// users/{uid}/formGuides/{fingerprint}. Guides saved earlier under the old shared top-level path are ignored, not moved.
const guidePath = (uid: string, fingerprint: string): [string, string, string, string] => ["users", uid, "formGuides", fingerprint];

/** This person's cached wizard for a form, or null. The caller still runs it through `parseWizard`: it is model output. */
export async function getFormGuide(fingerprint: string): Promise<FormGuideDoc | null> {
  const fb = await getFirebase();
  if (!fb?.uid) return null;
  const snap = await getDoc(doc(fb.db, ...guidePath(fb.uid, fingerprint)));
  return snap.exists() ? (snap.data() as FormGuideDoc) : null;
}

export async function saveFormGuide(structure: FormStructure, wizard: Wizard): Promise<void> {
  const fb = await getFirebase();
  if (!fb?.uid) return;
  const guide: FormGuideDoc = { structure, wizard, updatedAt: new Date().toISOString() };
  assertNoValues(guide, "formGuides");
  await setDoc(doc(fb.db, ...guidePath(fb.uid, structure.fingerprint)), guide);
}
