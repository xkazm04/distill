// One look at the page's layout for one judgement (a Clean or a Stay-clean recheck): each element's computed style and
// box are read from the browser once and kept, because findClutter asks the same element several times (is it fixed,
// is it on screen, where does it sit). Valid only while nothing changes the page: findClutter only reads, and a new
// judgement makes a new Layout. See docs/caption.md (round-1 gap G15).

export interface Layout {
  /** The element's computed style (the browser's live object, asked for once). */
  style(el: Element): CSSStyleDeclaration;
  /** Where the element sits in the window, read once. */
  rect(el: Element): DOMRect;
}

export function layoutOf(win: Window): Layout {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const rects = new Map<Element, DOMRect>();
  return {
    style(el) {
      let s = styles.get(el);
      if (!s) { s = win.getComputedStyle(el); styles.set(el, s); }
      return s;
    },
    rect(el) {
      let r = rects.get(el);
      if (!r) { r = el.getBoundingClientRect(); rects.set(el, r); }
      return r;
    },
  };
}
