// r5-10: every colour pair the strip draws, computed from the theme roles (light and dark) the way the CSS mixes them
// (color-mix in srgb, a share of a role over the strip's card). Text needs 4.5:1 (WCAG 1.4.3); focus rings, the
// selected tab's bar, a switch and its track need 3:1 against what is around them (1.4.11). The same table is in
// docs/caption.md ("Round 5, r5-10"); `PRINT_CONTRAST=1 npx vitest run contrast` prints it.
import { describe, expect, it } from "vitest";
import { BRAND_DARK, BRAND_LIGHT } from "@distill/web/ui/theme/brand";
import type { ColorRole, ThemeBinding } from "@distill/web/ui/theme/roles";

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
/** color-mix(in srgb, a p%, b): each channel p of a and the rest of b (b opaque, or the card under a transparent mix). */
const mix = (a: Rgb, p: number, b: Rgb): Rgb => [0, 1, 2].map((i) => a[i]! * p + b[i]! * (1 - p)) as Rgb;
const lum = (c: Rgb) => {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** A colour as the strip draws it: a role, or a share of a role over another colour (default: over the card). */
type Paint = ColorRole | { role: ColorRole; share: number; over?: Paint };
const paint = (t: ThemeBinding, p: Paint): Rgb =>
  typeof p === "string" ? rgb(t[p]) : mix(rgb(t[p.role]), p.share, paint(t, p.over ?? "--card"));

export interface Pair { what: string; fg: Paint; bg: Paint; min: 4.5 | 3 }

/** Every pair, from caption.css, kit.css, more.css, actions.css, tours.css, video.css and byline.css. */
export const STRIP_PAIRS: Pair[] = [
  { what: "Text on the strip (the line, More, every section)", fg: "--fg", bg: "--card", min: 4.5 },
  { what: "Quiet text (notes, the model line, counts, a row's second line)", fg: "--muted", bg: "--card", min: 4.5 },
  { what: "Text on a kit wash (facts, chips, a waiting bar's row)", fg: "--fg", bg: { role: "--fg", share: 0.09 }, min: 4.5 },
  { what: "Quiet text on a kit wash", fg: "--muted", bg: { role: "--fg", share: 0.09 }, min: 4.5 },
  { what: "A button under the pointer", fg: "--fg", bg: { role: "--fg", share: 0.07 }, min: 4.5 },
  { what: "An open button (More, aria-expanded)", fg: "--fg", bg: { role: "--fg", share: 0.08 }, min: 4.5 },
  { what: "A chip under the pointer", fg: "--fg", bg: { role: "--fg", share: 0.15 }, min: 4.5 },
  { what: "A part's tab, not chosen (quiet)", fg: "--muted", bg: "--card", min: 4.5 },
  { what: "A part's tab under the pointer", fg: "--fg", bg: { role: "--fg", share: 0.06 }, min: 4.5 },
  { what: "The current row (a tour step, a chapter)", fg: "--fg", bg: { role: "--accent", share: 0.12 }, min: 4.5 },
  { what: "Primary button", fg: "--accent-fg", bg: "--accent", min: 4.5 },
  { what: "Primary button under the pointer", fg: "--accent-fg", bg: { role: "--accent", share: 0.86, over: "--fg" }, min: 4.5 },
  { what: "Where it ran: on this device", fg: "--chip-device", bg: "--card", min: 4.5 },
  { what: "Where it ran: in the cloud", fg: "--chip-cloud", bg: "--card", min: 4.5 },
  { what: "Made by your agent", fg: "--chip-agent", bg: "--card", min: 4.5 },
  { what: "A disputed claim's verdict", fg: "--warn-fg", bg: "--warn-bg", min: 4.5 },
  { what: "A mixed verdict, the ask-the-web note", fg: "--fg", bg: "--note-bg", min: 4.5 },
  { what: "Quiet text on a note", fg: "--muted", bg: "--note-bg", min: 4.5 },
  { what: "Typed text in the Ask box", fg: "--fg", bg: "--bg", min: 4.5 },
  { what: "The Ask box's hint (placeholder)", fg: "--muted", bg: "--bg", min: 4.5 },
  { what: "Focus ring (3 px, drawn 2 px off the control, so always on the card)", fg: "--focus", bg: "--card", min: 3 },
  { what: "The chosen tab's bar, a switch turned on", fg: "--accent", bg: "--card", min: 3 },
  { what: "A switch turned off: its edge against the strip", fg: "--line", bg: "--card", min: 3 },
  { what: "A switch turned off: its knob on the track", fg: "--muted", bg: { role: "--fg", share: 0.12 }, min: 3 },
  { what: "A switch turned on: its knob on the track", fg: "--accent-fg", bg: "--accent", min: 3 },
];

const STATES: [string, ThemeBinding][] = [["light", BRAND_LIGHT], ["dark", BRAND_DARK]];

describe("the strip's colour pairs, from the theme roles", () => {
  for (const [name, theme] of STATES) {
    it.each(STRIP_PAIRS.map((p) => [p.what, p] as const))(`${name}: %s`, (_w, p) => {
      const c = ratio(paint(theme, p.fg), paint(theme, p.bg));
      expect(c, `${p.what}: ${c.toFixed(2)}:1, needs ${p.min}:1`).toBeGreaterThanOrEqual(p.min);
    });
  }

  it("prints the table for docs/caption.md (PRINT_CONTRAST=1)", () => {
    if (!process.env.PRINT_CONTRAST) return;
    const show = (p: Paint): string => typeof p === "string" ? p : `${p.role} ${Math.round(p.share * 100)}% over ${p.over ? show(p.over) : "--card"}`;
    const rows = STRIP_PAIRS.map((p) => {
      const [l, d] = STATES.map(([, t]) => ratio(paint(t, p.fg), paint(t, p.bg)).toFixed(2));
      return `| ${p.what} | \`${show(p.fg)}\` on \`${show(p.bg)}\` | ${p.min}:1 | ${l} | ${d} |`;
    });
    console.log(["| Pair | Roles | Needs | Light | Dark |", "| --- | --- | --- | --- | --- |", ...rows].join("\n"));
  });
});
