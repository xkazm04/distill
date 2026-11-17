// The theme ROLE VOCABULARY - the one authority. Every shared component styles itself only through these CSS custom
// properties; no component branches on which theme is active. Two theme sources bind them:
//   - the web app binds the Distill brand (light and dark) from apps/web/src/ui/theme/brand.ts;
//   - the extension binds roles DERIVED from the host page (deriveTheme in ./derive.ts), with contrast floors.
// Every role must be bound in every theme state; theme tests prove it. Add a role here first, then bind it everywhere.

export const COLOR_ROLES = [
  "--bg",          // page background behind Distill
  "--card",        // raised surface: steps, sections, panels
  "--fg",          // body text on --bg and --card (>= 4.5:1 on both)
  "--muted",       // secondary text (>= 4.5:1 on --bg)
  "--line",        // borders and dividers (>= 3:1 on --bg)
  "--accent",      // primary action fill and links (>= 3:1 on --bg)
  "--accent-fg",   // text on --accent (>= 4.5:1 on --accent)
  "--focus",       // focus ring (>= 3:1 on --bg)
  "--warn-bg",     // notice surface
  "--warn-fg",     // text on --warn-bg (>= 4.5:1)
  "--note-bg",     // informational surface; --fg must stay >= 4.5:1 on it
  "--chip-device", // "On this device" chip ink (>= 4.5:1 on --bg)
  "--chip-cloud",  // "In the cloud" chip ink (>= 4.5:1 on --bg)
] as const;

export const SHAPE_ROLES = [
  "--font-body",    // body font stack
  "--font-display", // headings / display font stack
  "--radius",       // corner radius of cards and buttons
] as const;

export const ROLES = [...COLOR_ROLES, ...SHAPE_ROLES] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];
export type Role = (typeof ROLES)[number];
export type ThemeBinding = Record<Role, string>;

/** Contrast floors the derived theme must meet; the brand theme is held to the same numbers by its test. */
export const CONTRAST_FLOORS: ReadonlyArray<{ fg: ColorRole; bg: ColorRole; min: number }> = [
  { fg: "--fg", bg: "--bg", min: 4.5 },
  { fg: "--fg", bg: "--card", min: 4.5 },
  { fg: "--fg", bg: "--note-bg", min: 4.5 },
  { fg: "--muted", bg: "--bg", min: 4.5 },
  { fg: "--line", bg: "--bg", min: 3 },
  { fg: "--accent", bg: "--bg", min: 3 },
  { fg: "--accent-fg", bg: "--accent", min: 4.5 },
  { fg: "--focus", bg: "--bg", min: 3 },
  { fg: "--warn-fg", bg: "--warn-bg", min: 4.5 },
  { fg: "--chip-device", bg: "--bg", min: 4.5 },
  { fg: "--chip-cloud", bg: "--bg", min: 4.5 },
];

/** What the extension's content script reads from the host page: the seed of a derived theme. */
export interface PageThemeSeed {
  /** Computed colors as CSS color strings; omitted when transparent or unreadable (e.g. an image background). */
  bg?: string;
  fg?: string;
  link?: string;
  /** Computed font-family of body text and of the first h1/h2. */
  fontBody?: string;
  fontDisplay?: string;
  /** Border radius of the page's first button or input, in px. */
  radiusPx?: number;
  /** The page's own color-scheme hint (`color-scheme` / prefers-color-scheme match). */
  scheme?: "light" | "dark";
}

/** A derived theme stores its seed and the algorithm version, so it can be recomputed when a role is added. */
export interface DerivedTheme {
  algorithm: 1;
  seed: PageThemeSeed;
  binding: ThemeBinding;
  /** Roles where the page's own value failed a floor and was adjusted or replaced, for the "Matched to page" hint. */
  adjusted: Role[];
}
