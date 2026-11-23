// Round 4, card r4-07: a product page's facts in one card, at the top of More. The page side reads the shop's
// structured data first, then its labels and tables (engine readProduct; no AI, nothing fetched). Each fact read from a
// place on the page has Show me; a fact from the data says so. Prices stay in the page's words: round 3's prices in
// your terms add the reader's currency on the page itself.
import { useEffect, useState } from "react";
import type { ProductFact, ProductFactKind, ProductFacts } from "@distill/engine";
import type { CleanReport } from "../../messages";
import { send } from "./send";
import "./video.css";

const KIND_WORDS: Record<ProductFactKind, string> = {
  price: "Price", oldPrice: "Before", stock: "Stock", delivery: "Delivery", warranty: "Warranty", returns: "Returns", spec: "",
};

/** Read once per strip (one page), when More first opens. */
let once: Promise<ProductFacts | null> | null = null;
const productOnce = () => (once ??= send<"distill:caption:product">({ type: "distill:caption:product" }).catch(() => null));

/** The English kind, and the page's own label beside it when it differs ("Stock · Dostupnost"). */
function labelOf(f: ProductFact): string {
  const kind = KIND_WORDS[f.kind];
  if (!kind) return f.label;
  return f.label && f.label.toLowerCase() !== kind.toLowerCase() ? `${kind} · ${f.label}` : kind;
}

export function ProductSection(_props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const [facts, setFacts] = useState<ProductFacts | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void productOnce().then((x) => { if (live) setFacts(x); });
    return () => { live = false; };
  }, []);
  if (!facts?.facts.length) return null;

  const show = async (f: ProductFact) => {
    const r = await send<"distill:caption:showProduct">({ type: "distill:caption:showProduct", id: f.id }).catch(() => ({ found: false }));
    setGone(r.found ? null : f.id);
  };
  const main = facts.facts.filter((f) => f.kind !== "spec");
  const specs = facts.facts.filter((f) => f.kind === "spec");
  const row = (f: ProductFact) => (
    <div key={f.id} className={f.kind === "price" ? "product-price" : f.kind === "oldPrice" ? "product-old" : undefined}
      data-testid="cap-product-fact" data-kind={f.kind} data-from={f.from}>
      <dt title={f.label}>{labelOf(f)}</dt>
      <dd data-testid="cap-product-value">{f.value}{gone === f.id && <span className="note"> That part of the page is no longer shown.</span>}</dd>
      {f.from === "page"
        ? <button type="button" className="btn sm quiet" onClick={() => void show(f)} aria-label={`Show me: ${labelOf(f)}`} data-testid="cap-product-show">Show me</button>
        : <span className="note" title="Read from the shop's structured data: it has no place on the page to show.">From data</span>}
    </div>
  );

  return (
    <section className="product" aria-labelledby="cap-product-h" data-testid="cap-product">
      <h2 id="cap-product-h">This product</h2>
      {facts.name && <p className="product-name" data-testid="cap-product-name">{facts.name}</p>}
      {main.length > 0 && <dl className="product-card">{main.map(row)}</dl>}
      {specs.length > 0 && (
        <details className="product-specs" open={main.length === 0}>
          <summary data-testid="cap-product-specs">Specifications ({specs.length})</summary>
          <dl className="product-card">{specs.map(row)}</dl>
        </details>
      )}
      <p className="note">Read from the page on this device, no AI.</p>
    </section>
  );
}
