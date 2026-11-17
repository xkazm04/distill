// The Distill brand binding (light and dark) - the fallback every derived theme falls back to. WP5 replaces these
// placeholder values (today's neutral palette) with the Worm Type brand; the role set is fixed by ./roles.ts.
import type { ThemeBinding } from "./roles";

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

export const BRAND_LIGHT: ThemeBinding = {
  "--bg": "#ffffff", "--card": "#f4f6f8", "--fg": "#111418", "--muted": "#4a525c", "--line": "#8a929c",
  "--accent": "#0b4fd6", "--accent-fg": "#ffffff", "--focus": "#b36b00", "--warn-bg": "#fff3cd", "--warn-fg": "#4d3800",
  "--note-bg": "#e8f0fe", "--chip-device": "#0a5c2e", "--chip-cloud": "#5a2a82",
  "--font-body": FONT, "--font-display": FONT, "--radius": "8px",
};

export const BRAND_DARK: ThemeBinding = {
  "--bg": "#101317", "--card": "#1a1f25", "--fg": "#f2f4f7", "--muted": "#b6bdc7", "--line": "#77808b",
  "--accent": "#7aa7ff", "--accent-fg": "#0b1220", "--focus": "#ffb000", "--warn-bg": "#3d3210", "--warn-fg": "#ffe9a8",
  "--note-bg": "#1a2a48", "--chip-device": "#7be0a6", "--chip-cloud": "#d2b1f5",
  "--font-body": FONT, "--font-display": FONT, "--radius": "8px",
};
