// Round 3, card r3-06: dark page. A switch in More (the page side darkens with care: caption/dark.ts). Once the person
// has switched it on, it turns on by itself whenever Chrome or the system is in dark mode, and off again when they go
// light; switching it off stops that. Kept on this device (chrome.storage.local). No AI.
import { useEffect, useSyncExternalStore } from "react";
import type { CleanReport } from "../../messages";
import { Note, Section, Switch } from "./kit";
import { send } from "./send";

export const DARK_KEY = "distill:dark";

/** What is kept: `auto` once the person switched Dark page on (and until they switch it off). */
export interface DarkPrefs { auto: boolean }

export function parseDarkPrefs(raw: unknown): DarkPrefs {
  return { auto: !!raw && typeof raw === "object" && (raw as { auto?: unknown }).auto === true };
}

/** Dark page on by itself: the person chose it once, and Chrome or the system is dark now. */
export const autoDark = (prefs: DarkPrefs, systemDark: boolean): boolean => prefs.auto && systemDark;

// The page's dark state for the frame's life, shared by the hook (always running) and the section (only in More).
interface DarkState { dark: boolean; alreadyDark: boolean; busy: boolean; auto: boolean; byItself: boolean }
let current: DarkState = { dark: false, alreadyDark: false, busy: false, auto: false, byItself: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<DarkState>) => { current = { ...current, ...patch }; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

async function loadPrefs(): Promise<DarkPrefs> {
  try { return parseDarkPrefs((await chrome.storage.local.get(DARK_KEY))[DARK_KEY]); } catch { return { auto: false }; }
}

async function apply(on: boolean, byItself: boolean): Promise<void> {
  set({ busy: true });
  try {
    const r = await send<"distill:caption:dark">({ type: "distill:caption:dark", on });
    set({ dark: r.dark, alreadyDark: r.alreadyDark, byItself: byItself && r.dark });
  } finally {
    set({ busy: false });
  }
}

/** Runs for the strip's whole life (main.tsx): once Clean answered, dark by itself when chosen before and the system
 *  is dark; follows the system while the strip is open. */
export function useDark(report: CleanReport | null): void {
  const ready = !!report;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    void loadPrefs().then((prefs) => {
      if (!live) return;
      set({ auto: prefs.auto });
      if (autoDark(prefs, mq.matches)) void apply(true, true).catch(() => undefined);
    });
    const onChange = () => {
      if (!current.auto || current.busy) return;
      if (mq.matches && !current.dark && !current.alreadyDark) void apply(true, true).catch(() => undefined);
      else if (!mq.matches && current.byItself) void apply(false, false).catch(() => undefined);
    };
    mq.addEventListener("change", onChange);
    return () => { live = false; mq.removeEventListener("change", onChange); };
  }, [ready]);
}

export function DarkSection(_props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const s = useSyncExternalStore(subscribe, () => current);
  const toggle = async (on: boolean) => {
    // Switching on once is the choice to have it in dark mode from now on; switching off withdraws it.
    try { await chrome.storage.local.set({ [DARK_KEY]: { auto: on } satisfies DarkPrefs }); } catch { /* kept for this page only */ }
    set({ auto: on });
    await apply(on, false);
  };
  return (
    <Section id="cap-dark-h" title="Dark page" testid="cap-dark-section" className="k-switches">
      <Switch checked={s.dark} disabled={s.busy} onChange={(on) => void toggle(on)} label="Dark page" testid="cap-dark"
        attrs={{ "data-already-dark": s.alreadyDark ? "true" : undefined }}
        title="The page's own colours darkened; photos, videos, maps and logos keep theirs." />
      {s.alreadyDark && <Note testid="cap-dark-note">This page is dark already, so Distill left its colours as they are.</Note>}
      {s.dark && s.byItself && <Note testid="cap-dark-note">On by itself: Chrome is in dark mode.</Note>}
      {s.auto && !s.alreadyDark && <Note>Turns on by itself when Chrome is in dark mode. Kept on this device only.</Note>}
    </Section>
  );
}
