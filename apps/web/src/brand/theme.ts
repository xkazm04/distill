// Light / dark for the web app. Follows the device by default; an explicit choice (stored on this device only) wins
// in both directions. index.html stamps the same choice before first paint, so there is no flash of the wrong theme.
import { useSyncExternalStore } from "react";
import { applyBinding } from "../ui/theme/apply";
import { BRAND_DARK, BRAND_LIGHT } from "../ui/theme/brand";
import type { ThemeBinding } from "../ui/theme/roles";
import { applyShell, SHELL_ART_DARK, SHELL_ART_LIGHT, SHELL_DARK, SHELL_LIGHT, type ShellArt, type ShellBinding } from "./shell";

export type ThemePref = "system" | "light" | "dark";
export type ThemeMode = "light" | "dark";

/** localStorage key. index.html reads the same key in its pre-paint script; theme.test.ts keeps the two in step. */
export const THEME_KEY = "distill.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function writePref(p: ThemePref): void {
  try {
    if (p === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, p);
  } catch { /* private mode: the choice lasts for this visit */ }
}

export function systemIsDark(): boolean {
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
}

export function resolveMode(pref: ThemePref, systemDark: boolean): ThemeMode {
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}

/**
 * The complete binding set of each state: the shared roles, the shell's brand tokens and its non-CSS art choices. This
 * table is the ONE place a theme state selects values; components and CSS read the bound result, never the mode.
 */
export const BINDINGS: Record<ThemeMode, { roles: ThemeBinding; shell: ShellBinding; art: ShellArt }> = {
  light: { roles: BRAND_LIGHT, shell: SHELL_LIGHT, art: SHELL_ART_LIGHT },
  dark: { roles: BRAND_DARK, shell: SHELL_DARK, art: SHELL_ART_DARK },
};

/** Binds the brand roles and shell tokens for `mode` on the root element and tells the browser which scheme its own controls use. */
export function stampTheme(root: HTMLElement, mode: ThemeMode): void {
  const b = BINDINGS[mode];
  applyBinding(root, b.roles);
  applyShell(root, b.shell);
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", b.roles["--bg"]);
}

// A tiny external store, so the header switch and every wordmark share one answer.
let pref: ThemePref = readPref();
let mode: ThemeMode = resolveMode(pref, systemIsDark());
const listeners = new Set<() => void>();

function update(): void {
  const next = resolveMode(pref, systemIsDark());
  mode = next;
  stampTheme(document.documentElement, next);
  listeners.forEach((l) => l());
}

/** Call once before the first render. */
export function startTheme(): void {
  update();
  if (typeof matchMedia === "function") matchMedia(DARK_QUERY).addEventListener("change", () => pref === "system" && update());
  // Another tab changed the choice.
  addEventListener("storage", (e) => { if (e.key === THEME_KEY) { pref = readPref(); update(); } });
}

export function setThemePref(p: ThemePref): void {
  pref = p;
  writePref(p);
  update();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
let snapshot = { pref, mode };
function getSnapshot() {
  if (snapshot.pref !== pref || snapshot.mode !== mode) snapshot = { pref, mode };
  return snapshot;
}

export function useTheme(): { pref: ThemePref; mode: ThemeMode } {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The active state's non-CSS bindings (which wordmark cut reads on the ground). */
export function useShellArt(): ShellArt {
  return BINDINGS[useTheme().mode].art;
}
