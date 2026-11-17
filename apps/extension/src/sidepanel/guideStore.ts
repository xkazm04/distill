// The extension's GuideStore: chrome.storage.session, keyed `guide:<tabId>:<key>`. Session storage lives in memory
// only (never written to disk), is not reachable from content scripts by default, and is gone when the browser closes;
// the background worker also clears a tab's keys when the tab closes (forgetTab). Values never go anywhere else.
// Type-only imports: the background worker uses forgetTab and must not pull in the UI.
import type { GuideState, GuideStore } from "@distill/web/ui";

type Area = Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;
const session = (): Area => chrome.storage.session;

const tabPrefix = (tabId: number) => `guide:${tabId}:`;

function asGuideState(x: unknown): GuideState | null {
  if (!x || typeof x !== "object") return null;
  const { stepIndex, answers } = x as Partial<GuideState>;
  if (typeof stepIndex !== "number" || !Number.isInteger(stepIndex) || stepIndex < 0) return null;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) if (typeof v === "string") clean[k] = v;
  return { stepIndex, answers: clean };
}

export function tabGuideStore(tabId: number, area: () => Area = session): GuideStore {
  const k = (key: string) => `${tabPrefix(tabId)}${key}`;
  return {
    async load(key) {
      try {
        const r = await area().get(k(key));
        return asGuideState(r[k(key)]);
      } catch {
        return null;
      }
    },
    async save(key, s) {
      try { await area().set({ [k(key)]: s }); } catch { /* storage unavailable: the guide just starts over */ }
    },
    async clear(key) {
      try { await area().remove(k(key)); } catch { /* nothing to clear */ }
    },
  };
}

/** Everything kept for a tab (its guides and its answers by label) goes when the tab closes. */
export async function forgetTab(tabId: number, area: () => Area = session): Promise<void> {
  const all = await area().get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(tabPrefix(tabId)));
  if (keys.length) await area().remove(keys);
}
