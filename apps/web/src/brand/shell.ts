// The web shell's brand tokens (the riso grain, the print edge, the coil, the hero and card shadows): DERIVED from the
// one brand source, INK in ../ui/theme/brand.ts, and bound per theme state on <html> by stampTheme, next to the shared
// roles. brand.css only reads var(--...): it holds no colour of its own and no rule that asks which theme is active.
// A token whose value differs between light and dark is bound differently here, in both states; theme.test.ts proves
// every token is bound in both states and that brand.css uses no name that is not bound.
//
// Why runtime and not a build step: the shared roles are already bound at runtime (applyBinding on <html>), so the shell
// tokens switch with the theme in the same frame and need no per-theme CSS. The first paint does not need them: the
// pre-paint stamp in index.html paints the ground and ink, and nothing that uses a shell token exists until React
// renders, which is after startTheme() has bound them (main.tsx).
import { BRAND_LIGHT, INK } from "../ui/theme/brand";

export const SHELL_TOKENS = [
  "--ink-aubergine",  // the four brand inks, the same in both states
  "--ink-pink",
  "--ink-pink-soft",
  "--ink-butter",
  "--ink-paper",
  "--ink-plum",
  "--print-edge",     // the hero print's outline: ink on paper, paper on the night ground
  "--misprint",       // the off-register shadow behind the tagline
  "--grain",          // the riso speckle, inked in the colour that reads on the ground
  "--grain-opacity",
  "--coil-ink",       // the How-it-works coil: butter, deepened with aubergine on paper so it still shows
  "--coil-width",
  "--num-shadow",     // the offset shadow behind the numbered stops
  // The workbench sidebar (and its compact top bar): the brand aubergine in both states, as chrome. brand.css binds the
  // shared UI's --sb-* names to these on the web; the extension keeps the role-derived defaults of ui/styles.css.
  "--side-ground",
  "--side-ink",       // text on the ground
  "--side-muted",     // secondary text on the ground
  "--side-line",
  "--side-hover",
  "--side-active",    // the current item's ground
  "--side-current",   // the current item's text
  "--side-drip",      // the one pink accent: the drip bar on the current item
  "--side-focus",     // focus ring on the ground
  "--side-scrim",     // the shade behind the open drawer
] as const;

export type ShellToken = (typeof SHELL_TOKENS)[number];
export type ShellBinding = Record<ShellToken, string>;

/**
 * The one ink the shell uses that INK does not carry: the plum plate behind the pricing example. It lives here, once,
 * until INK (ui/theme/brand.ts, the shared UI's file) adopts it. check-tokens allows a colour literal only in theme
 * binding files, and this is the shell's.
 */
const PLUM = "#5A3470";

/** A fractal-noise speckle tinted `hex`, as a CSS url(): the grain's colour is the ink it sits under, never a copy. */
export function grain(hex: string, alpha: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(2));
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/>" +
    `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 -2.2 ${alpha}'/>` +
    "</filter><rect width='100%' height='100%' filter='url(#n)'/></svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const INKS = {
  "--ink-aubergine": INK.aubergine,
  "--ink-pink": INK.pink,
  // Pink washed into white: 28% pink on the light card white is exactly the old hand-picked #FFD3E8.
  "--ink-pink-soft": `color-mix(in srgb, ${INK.pink} 28%, ${BRAND_LIGHT["--card"]})`,
  "--ink-butter": INK.butter,
  "--ink-paper": INK.paper,
  "--ink-plum": PLUM,
} as const;

/** The sidebar is chrome: the same aubergine ground and paper ink in both states, so the brand lives there while the
 *  work area follows the theme. Paper at 74% over aubergine keeps secondary text well above 4.5:1. */
const SIDE = {
  "--side-ground": "var(--ink-aubergine)",
  "--side-ink": "var(--ink-paper)",
  "--side-muted": "color-mix(in srgb, var(--ink-paper) 74%, var(--ink-aubergine))",
  "--side-line": "color-mix(in srgb, var(--ink-paper) 22%, var(--ink-aubergine))",
  "--side-hover": "color-mix(in srgb, var(--ink-paper) 8%, var(--ink-aubergine))",
  "--side-active": "color-mix(in srgb, var(--ink-paper) 15%, var(--ink-aubergine))",
  "--side-current": "var(--ink-butter)",
  "--side-drip": "var(--ink-pink)",
  "--side-focus": "var(--ink-butter)",
  "--side-scrim": "color-mix(in srgb, var(--ink-aubergine) 60%, transparent)",
} as const;

export const SHELL_LIGHT: ShellBinding = {
  ...INKS,
  ...SIDE,
  "--print-edge": "var(--ink-aubergine)",
  "--misprint": "color-mix(in srgb, var(--ink-pink) 70%, transparent)",
  "--grain": grain(INK.aubergine, "1.25"),
  "--grain-opacity": ".2",
  "--coil-ink": "color-mix(in srgb, var(--ink-butter) 84%, var(--ink-aubergine))",
  "--coil-width": "3",
  "--num-shadow": "var(--ink-aubergine)",
};

export const SHELL_DARK: ShellBinding = {
  ...INKS,
  ...SIDE,
  "--print-edge": "var(--ink-paper)",
  "--misprint": "color-mix(in srgb, var(--ink-pink) 80%, transparent)",
  "--grain": grain(INK.paper, "1.2"),
  "--grain-opacity": ".13",
  "--coil-ink": "var(--ink-butter)",
  "--coil-width": "3.5",
  "--num-shadow": "var(--ink-pink)",
};

/** Bindings that are not CSS: which cut of the wordmark reads on the ground (Wordmark.tsx picks by this, not by mode). */
export interface ShellArt { wordmark: "ink" | "paper" }
export const SHELL_ART_LIGHT: ShellArt = { wordmark: "ink" };
export const SHELL_ART_DARK: ShellArt = { wordmark: "paper" };

export function applyShell(root: HTMLElement, b: ShellBinding): void {
  for (const t of SHELL_TOKENS) root.style.setProperty(t, b[t]);
}
