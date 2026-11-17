// Runs in the page (content script). Reads only COMPUTED STYLE - colours, fonts, a corner radius and the colour-scheme
// hint - so the side panel can match the site. It never reads a form value, an attribute a person typed, or any text
// content: the seed is presentation only, and it stays inside the browser.
import { parseColor, MIN_ALPHA } from "../../web/src/ui/theme/derive";
import type { PageThemeSeed } from "../../web/src/ui/theme/roles";

const MAIN = "main, [role='main'], article";
const CONTROL = "button, input[type='submit'], input[type='button'], input[type='text'], input[type='search'], input[type='email'], input:not([type])";

/** A computed colour as `rgb(r, g, b)` when it is opaque enough to trust (any CSS syntax the browser returns). */
function solid(css: string | undefined): string | undefined {
  const c = parseColor(css);
  return c && c.a >= MIN_ALPHA ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})` : undefined;
}

/** The effective background behind the main content: an opaque colour, an image/gradient, or nothing set at all. */
function background(start: Element, style: (el: Element) => CSSStyleDeclaration): { color?: string; image?: true } {
  for (let el: Element | null = start; el; el = el.parentElement) {
    const s = style(el);
    if (s.backgroundImage && s.backgroundImage !== "none") return { image: true };
    const color = solid(s.backgroundColor);
    if (color) return { color };
  }
  return {};
}

function scheme(doc: Document, style: (el: Element) => CSSStyleDeclaration): "light" | "dark" | undefined {
  const hint = `${doc.querySelector("meta[name='color-scheme']")?.getAttribute("content") ?? ""} ${style(doc.documentElement).colorScheme ?? ""}`;
  const light = /\blight\b/.test(hint), dark = /\bdark\b/.test(hint);
  if (light && dark) return doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  if (dark) return "dark";
  if (light) return "light";
  return undefined;
}

export function readPageTheme(doc: Document): PageThemeSeed {
  const win = doc.defaultView;
  if (!win || !doc.body) return {};
  const style = (el: Element) => win.getComputedStyle(el);
  const main = doc.querySelector(MAIN) ?? doc.body;
  const seed: PageThemeSeed = {};

  const sch = scheme(doc, style);
  if (sch) seed.scheme = sch;

  const bg = background(main, style);
  if (bg.color) seed.bg = bg.color;
  // Nothing set anywhere: the browser's canvas shows through, which is white unless the page asked for dark.
  else if (!bg.image && sch !== "dark") seed.bg = "rgb(255, 255, 255)";

  const copy = main.querySelector("p") ?? main;
  const fg = solid(style(copy).color);
  if (fg) seed.fg = fg;

  const link = main.querySelector("p a[href], li a[href]") ?? main.querySelector("a[href]") ?? doc.querySelector("a[href]");
  const linkColor = link ? solid(style(link).color) : undefined;
  if (linkColor) seed.link = linkColor;

  const bodyFont = style(copy).fontFamily;
  if (bodyFont) seed.fontBody = bodyFont;
  const heading = main.querySelector("h1, h2") ?? doc.querySelector("h1, h2");
  const headFont = heading ? style(heading).fontFamily : "";
  if (headFont) seed.fontDisplay = headFont;

  const control = main.querySelector(CONTROL) ?? doc.querySelector(CONTROL);
  const radius = control ? style(control).borderTopLeftRadius : "";
  if (radius && /^\d+(\.\d+)?px$/.test(radius.trim())) seed.radiusPx = parseFloat(radius);

  return seed;
}
