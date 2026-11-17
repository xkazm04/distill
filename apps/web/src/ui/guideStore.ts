// Where the form guide keeps its place: the step on screen and the answers typed so far, so a reload or a re-read of
// the page does not send the person back to step 1. DEVICE ONLY: the web app keeps it in sessionStorage, the extension
// in chrome.storage.session. Nothing here touches the network or Firestore, and it is gone when the tab closes.

export interface GuideState {
  stepIndex: number;
  /** fieldId -> the person's answer. Device-only, like every FormValues. */
  answers: Record<string, string>;
}

export interface GuideStore {
  load(key: string): Promise<GuideState | null>;
  save(key: string, s: GuideState): Promise<void>;
  clear(key: string): Promise<void>;
}

/** A stored value read back: only a well-formed GuideState counts, anything else is as if nothing was kept. */
export function asGuideState(x: unknown): GuideState | null {
  if (!x || typeof x !== "object") return null;
  const { stepIndex, answers } = x as Partial<GuideState>;
  if (typeof stepIndex !== "number" || !Number.isInteger(stepIndex) || stepIndex < 0) return null;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) if (typeof v === "string") clean[k] = v;
  return { stepIndex, answers: clean };
}

/** The web app's store: sessionStorage under `guide:<key>`. Blocked storage keeps nothing and never throws. */
export function sessionGuideStore(storage: () => Storage = () => sessionStorage): GuideStore {
  const k = (key: string) => `guide:${key}`;
  return {
    async load(key) {
      try {
        const raw = storage().getItem(k(key));
        return raw ? asGuideState(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    async save(key, s) {
      try { storage().setItem(k(key), JSON.stringify(s)); } catch { /* storage blocked: the guide just starts over */ }
    },
    async clear(key) {
      try { storage().removeItem(k(key)); } catch { /* nothing to clear */ }
    },
  };
}

/**
 * The key of the answers kept by field label for one site, so the next page of a multi-page form can carry them
 * over. The store adds its own prefix (and, in the extension, the tab).
 */
export function labelsKey(url: string): string {
  let origin = url;
  try { origin = new URL(url).origin; } catch { /* keep the raw string */ }
  return `labels:${origin}`;
}

/** A field label reduced to what two pages of one form share: case, spacing, punctuation and "required" marks go. */
export function normLabel(label: string): string {
  return label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\((?:required|optional)\)/g, " ")
    .replace(/[*:.,;!?()[\]{}"'`_\-–—/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
