// What Clean knew about the page, handed to each round-1 module (spark universal-core). Built once per Clean in page.ts.
export interface CleanContext {
  doc: Document;
  win: Window;
  /** Every element the page reader took text from (extractPage onSource), plus the headline. */
  keep: readonly Element[];
  /** The running text: paragraphs, lists, tables, quotes, code. */
  body: readonly Element[];
  /** The smallest element holding all of `body`: the main column. Null when the page has no running text. */
  main: Element | null;
  /** What the page is for beyond its text (the main video's player, the form): never paused, hidden or restyled. */
  protect: readonly Element[];
  /** Item id -> the element Clean hid. */
  removed: ReadonlyMap<string, Element>;
  /** What the page is (the page reader's PageKind: article, form, ...), when Clean read it (r4-01). */
  kind?: string;
}

/** The smallest element holding both. */
export function commonAncestor(a: Element, b: Element): Element {
  for (let el: Element | null = a; el; el = el.parentElement) if (el.contains(b)) return el;
  return b.ownerDocument.documentElement;
}
