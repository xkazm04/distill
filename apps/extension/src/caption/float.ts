// #4 Things that float over the page: a sticky header taller than 12% of the window scrolls with the page instead of
// covering it (its menu stays reachable at the top). Small floating widgets (chat, feedback, a sticky player, an app
// banner) are found by the engine's findClutter. Only Distill CSS on a marker attribute changes the header, under
// html:not([data-distill-original]): Original shows it as the site made it, and close takes it all back.
import type { CleanContext } from "./context";

/** On a header Distill lets scroll away: "fixed" or "sticky", what it was. */
const UNSTICK = "data-distill-unstick";
/** A header (or a stack of bars at the top) taller than this share of the window scrolls with the page. */
const TALL = 0.12;

// A sticky header keeps its place in the page: as relative, it simply stops following. A fixed one takes no space in
// the page (the page pads for it): as absolute, it stays where it was at the top and scrolls away, so nothing moves.
const CSS = `
html:not([data-distill-original]) [${UNSTICK}="sticky"] { position: relative !important; top: auto !important; bottom: auto !important; }
html:not([data-distill-original]) [${UNSTICK}="fixed"] { position: absolute !important; }
`;

interface Bar { el: HTMLElement; pos: "fixed" | "sticky"; top: number; bottom: number; width: number }

const SVG = "http://www.w3.org/2000/svg";

/** Where a box is in the page (not the window), so a change that moves it can be seen whatever the scroll. */
const pageTop = (el: Element, win: Window): number => el.getBoundingClientRect().top + win.scrollY;

/** Makes tall sticky headers scroll with the page; returns how many. */
export function unstick(ctx: CleanContext): number {
  const { doc, win } = ctx;
  restick(doc);
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  if (!doc.body || vw <= 0 || vh <= 0) return 0;

  // Bars across the top of the window that stay there: fixed or sticky, wide, shown, not taken out by Clean, and not
  // holding the running text (a sticky layout column is not a header).
  const bars: Bar[] = [];
  // What Clean hid is skipped whole (on a large page that is most of it), and so is what draws nothing (display: none:
  // nothing inside it takes space); a bar found is not searched inside. The shapes inside an svg drawing are passed
  // over (their children are still looked at, for HTML in a foreignObject): CSS position does nothing on them. On a
  // huge page (YouTube: thousands of hidden parts and icon shapes) that is most of it.
  let seen: CSSStyleDeclaration | null = null;
  const walker = doc.createTreeWalker(doc.body, 1 /* NodeFilter.SHOW_ELEMENT */, {
    acceptNode: (n) => {
      const e = n as Element;
      if (e.hasAttribute("data-distill-hide") || e.localName === "distill-caption") return 2 /* REJECT */;
      if (e.namespaceURI === SVG && e.parentElement?.namespaceURI === SVG) return 3 /* SKIP */;
      seen = win.getComputedStyle(e);
      return seen.display === "none" ? 2 /* REJECT */ : 1 /* ACCEPT */;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as HTMLElement;
    if (bars.some((b) => b.el.contains(el))) continue;
    const cs = seen as unknown as CSSStyleDeclaration; // the accepted node's, read by acceptNode
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.5 || r.height < 8 || r.height > vh * 0.6) continue;
    if (r.top > vh * 0.25 || r.bottom <= 0) continue; // near the top of the window now
    // Where it stays: a fixed bar where it is, a sticky one at its `top` once the page scrolls.
    if (cs.position === "sticky" && cs.top === "auto") continue; // sticks to the bottom or a side, not the top
    const top = cs.position === "sticky" ? parseFloat(cs.top) || 0 : r.top;
    // Not the content: a sticky column holding the running text, a table's sticky head inside the text, the main video.
    if (ctx.body.some((b) => el.contains(b) || b.contains(el)) || ctx.protect.some((p) => el.contains(p) || p.contains(el))) continue;
    if (ctx.keep.some((k) => k !== doc.body && k !== doc.documentElement && k.contains(el))) continue;
    bars.push({ el, pos: cs.position, top, bottom: top + r.height, width: r.width });
  }
  if (!bars.length) return 0;

  // Bars stacked at the top (a top bar, then the menu bar) cover the page together: judge the stack.
  bars.sort((a, b) => a.top - b.top);
  const stack: Bar[] = [];
  for (const b of bars) {
    const last = stack[stack.length - 1];
    if (!last ? b.top <= 8 : b.top <= last.bottom + 8) stack.push(b);
  }
  if (!stack.length) return 0;
  const span = Math.max(...stack.map((b) => b.bottom)) - Math.min(...stack.map((b) => b.top));
  if (span <= vh * TALL) return 0;

  // Apply, then check that nothing moved: the headline (or else the text) stays where it was in the page, and each bar
  // keeps its width. A headline inside the header itself goes up with it, so it is not the yardstick.
  const h1 = [...Array.from(doc.querySelectorAll("h1")), ctx.main, ...ctx.body]
    .find((e): e is Element => !!e && e.getBoundingClientRect().height > 0 && !stack.some((b) => b.el.contains(e)));
  const before = h1 ? pageTop(h1, win) : 0;
  const style = doc.createElement("style");
  style.setAttribute("data-distill", "float");
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).append(style);
  for (const b of stack) b.el.setAttribute(UNSTICK, b.pos);
  const moved = (h1 ? Math.abs(pageTop(h1, win) - before) > 2 : false)
    || stack.some((b) => b.el.getBoundingClientRect().width < b.width * 0.9);
  if (moved) { restick(doc); return 0; }
  return stack.length;
}

/** Takes every change back (close). */
export function restick(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll(`[${UNSTICK}]`))) el.removeAttribute(UNSTICK);
  doc.querySelector('style[data-distill="float"]')?.remove();
}
