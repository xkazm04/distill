// #3 Stay clean while the page keeps changing: watches for new boxes (a late pop-up, an ad loaded on scroll, a single-page
// app's new view) and asks page.ts to judge them (page.ts recheck). STUB: owned by the round-1 builder W2.

/** Calls `recheck` after the page changed and settled; returns a function that stops watching. */
export function watchForClutter(doc: Document, win: Window, recheck: () => void): () => void {
  void doc; void win; void recheck; return () => undefined;
}
