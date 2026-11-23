// Round 3: prices and dates in your terms (r3-07) split the main text's text nodes and put them back whole while
// Translate, Plain and the readers work. A highlight's range (claims r2-01, things to do r3-09) over such a node is moved
// by the DOM when a piece goes, and a mutation observer can miss it (the split and the rejoin land in one task). So the
// splitter says when it is done, and the highlights find their words again.
export const TEXT_SPLIT_EVENT = "distill:textsplit";

export function textSplitDone(doc: Document): void {
  doc.dispatchEvent(new Event(TEXT_SPLIT_EVENT));
}
