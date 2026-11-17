// The Distill brand binding (light and dark) - the fallback every derived theme falls back to. Worm Type: aubergine
// ink on riso paper, butter yellow, hot pink. The role set is fixed by ./roles.ts; brand.test.ts proves every role is
// bound and every CONTRAST_FLOORS pair holds in both states.
//
// Hot pink (#FF62AD) is only 2.6:1 on paper, so in the light state it is never text, fill-with-text or a link: the
// action colour is aubergine with butter lettering, and pink appears as a deeper focus ring, the cloud chip ink and in
// the web shell's decoration (the drip, the grain). The agent chip ("Made by your agent") is a blue of its own. On the aubergine ground pink clears 6:1 and becomes the focus ring.
import type { ThemeBinding } from "./roles";

/** Self-hosted (@fontsource) families first; system faces after, so a context without the fonts still reads well. */
const FONT_BODY = '"Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, "Segoe UI", Roboto, sans-serif';
const FONT_DISPLAY = '"Fredoka Variable", Fredoka, "Atkinson Hyperlegible Next Variable", system-ui, "Segoe UI", Roboto, sans-serif';
const RADIUS = "14px";

/** The four brand inks. Exported for the web shell's decoration and for the pre-paint stamp in index.html. */
export const INK = {
  aubergine: "#371C46",
  night: "#26112F", // the dark ground: aubergine, one step deeper
  pink: "#FF62AD",
  butter: "#FFE66B",
  paper: "#FFF8F0",
} as const;

export const BRAND_LIGHT: ThemeBinding = {
  "--bg": INK.paper,
  "--card": "#FFFFFF",
  "--fg": INK.aubergine,
  "--muted": "#6A5476",
  "--line": "#9C86A6",
  "--accent": INK.aubergine,
  "--accent-fg": INK.butter,
  "--focus": "#E0247F",
  "--warn-bg": INK.butter,
  "--warn-fg": INK.aubergine,
  "--note-bg": "#FFE4F1",
  "--chip-device": "#11694A",
  "--chip-cloud": "#B0145F",
  "--chip-agent": "#2F45B8", // a blue of its own, far in hue from the device green and the cloud pink
  "--font-body": FONT_BODY,
  "--font-display": FONT_DISPLAY,
  "--radius": RADIUS,
};

export const BRAND_DARK: ThemeBinding = {
  "--bg": INK.night,
  "--card": INK.aubergine,
  "--fg": INK.paper,
  "--muted": "#D8C6E0",
  "--line": "#8F729D",
  "--accent": INK.butter,
  "--accent-fg": INK.night,
  "--focus": INK.pink,
  "--warn-bg": "#4A3A12",
  "--warn-fg": "#FFE89A",
  "--note-bg": "#4B2050",
  "--chip-device": "#8EE3B9",
  "--chip-cloud": "#FF9ACB",
  "--chip-agent": "#A9B4FF",
  "--font-body": FONT_BODY,
  "--font-display": FONT_DISPLAY,
  "--radius": RADIUS,
};
