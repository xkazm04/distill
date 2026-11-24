// Spark round 5, r5-10: Distill's changes never lower the page's own accessibility.
// - What Clean removes never takes the page's h1, nor the landmark that holds the main text (<main>, role=main): an
//   item that holds either is not removed (`spareWayIn`).
// - A skip link ("Skip to content") inside something Clean removes (a site header with its menu) still works: the box
//   stays hidden to the eye and to the keyboard (no size, nothing in it shown or focusable), but the skip link in it
//   shows when it gets focus, as the page made it (`keepSkipLinks`, the CSS in WAY_CSS).
// - Focus never stays on, or lands on, something Distill hid (`rescueFocus`); what display:none hides cannot take focus.
// Every mark is a data-distill-* attribute that Original turns off and close() takes back.

/** On a removed box that holds a skip link: hidden, with the way in kept. */
export const WAY = "data-distill-way";
/** On the skip link in it. */
export const WAY_LINK = "data-distill-way-link";
const HIDE = "data-distill-hide";
const ORIGINAL = "data-distill-original";

/** The page side's CSS for the kept way in. It wins over Clean's `display: none` (more specific, also important). */
export const WAY_CSS = `
html:not([${ORIGINAL}]) [${HIDE}][${WAY}] { display: block !important; visibility: hidden !important; height: 0 !important;
  min-height: 0 !important; max-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
  overflow: visible !important; }
html:not([${ORIGINAL}]) [${HIDE}][${WAY}] [${WAY_LINK}] { visibility: visible !important; }
`;

/** Words of a skip link in the languages Distill reads (and the common English ones). */
const SKIP_WORDS = /\b(skip|jump)\b|p[řr]esko[čc]it|p[řr]ej[íi]t\s+(na|k)|k\s+obsahu|na\s+obsah|zum\s+(inhalt|hauptinhalt)|aller\s+au|passer\s+au|saltar|vai\s+al|naar\s+(de\s+)?(inhoud|hoofd)|przejd[źz]|hoppa|spring\s+til|prejs[ťt]/i;

/** The element an in-page link points to, if the page has it. */
function targetOf(a: HTMLAnchorElement, doc: Document): Element | null {
  const href = a.getAttribute("href") ?? "";
  if (!href.startsWith("#") || href.length < 2) return null;
  let id = href.slice(1);
  try { id = decodeURIComponent(id); } catch { /* keep it as written */ }
  return doc.getElementById(id) ?? doc.getElementsByName(id)[0] ?? null;
}

/**
 * The page's skip links: in-page links among the first few links of the page that point to something on it and say
 * so ("Skip to content", "Přeskočit na obsah"), or point to the main landmark or to where the main text is.
 */
export function skipLinks(doc: Document, main: Element | null): HTMLAnchorElement[] {
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).slice(0, 6);
  return links.filter((a) => {
    const target = targetOf(a, doc);
    if (!target || target === doc.body || target.contains(a)) return false;
    const words = `${a.textContent ?? ""} ${a.getAttribute("aria-label") ?? ""}`;
    if (SKIP_WORDS.test(words)) return true;
    return target.matches("main, [role=main]") || (!!main && (target === main || target.contains(main) || main.contains(target)));
  });
}

/** The page's own headline: its first h1 that is shown. */
function pageH1(doc: Document): Element | null {
  const win = doc.defaultView;
  for (const h of Array.from(doc.querySelectorAll("h1"))) {
    const r = h.getBoundingClientRect();
    const cs = win?.getComputedStyle(h);
    if (r.width > 1 && r.height > 1 && cs?.visibility !== "hidden") return h;
  }
  return null;
}

/**
 * The ids of removed items that must stay: an item that is, or holds, the page's h1, or the landmark that holds the
 * main text. Clean and Stay clean drop them before anything is hidden.
 */
export function spareWayIn(doc: Document, removed: ReadonlyMap<string, Element>, body: readonly Element[]): Set<string> {
  const keep = new Set<string>();
  const h1 = pageH1(doc);
  const landmarks = Array.from(doc.querySelectorAll("main, [role=main]")).filter((m) => body.some((b) => m.contains(b)));
  for (const [id, el] of removed) {
    if (h1 && el.contains(h1)) keep.add(id);
    else if (landmarks.some((m) => el.contains(m) || m === el)) keep.add(id);
  }
  return keep;
}

/** Marks the removed boxes that hold a skip link, and the link, so the link keeps working. Returns how many. */
export function keepSkipLinks(doc: Document, removed: Iterable<Element>, main: Element | null): number {
  const links = skipLinks(doc, main);
  if (!links.length) return 0;
  let n = 0;
  for (const el of removed) {
    const inside = links.filter((a) => el.contains(a) && !el.matches(`[${WAY_LINK}]`));
    if (!inside.length) continue;
    // The target must still be there to go to: a link into what is hidden leads nowhere.
    const live = inside.filter((a) => { const t = targetOf(a, doc); return !!t && !t.closest(`[${HIDE}]`); });
    if (!live.length) continue;
    el.setAttribute(WAY, "");
    for (const a of live) a.setAttribute(WAY_LINK, "");
    n++;
  }
  return n;
}

/** Focus inside something Distill just hid goes back to the page's start, never to a box no one can see. */
export function rescueFocus(doc: Document): boolean {
  const active = doc.activeElement as HTMLElement | null;
  if (!active || active === doc.body || active.closest(`[${WAY_LINK}]`)) return false;
  if (!active.closest(`[${HIDE}]`)) return false;
  active.blur();
  return true;
}

/** Takes the marks back (close). */
export function clearWayIn(doc: Document): void {
  doc.querySelectorAll(`[${WAY}]`).forEach((el) => el.removeAttribute(WAY));
  doc.querySelectorAll(`[${WAY_LINK}]`).forEach((el) => el.removeAttribute(WAY_LINK));
}
