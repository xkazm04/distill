// Round 4, card r4-07: a product page's facts in one card, at the top of More. The page side reads the shop's
// structured data first, then its labels and tables (engine readProduct; no AI, nothing fetched). Each fact read from a
// place on the page has Show me; a fact from the data says so. Prices stay in the page's words: round 3's prices in
// your terms add the reader's currency on the page itself.
import { useEffect, useState } from "react";
import type { ProductFact, ProductFactKind, ProductFacts } from "@distill/engine";
import type { CleanReport } from "../../messages";
import { FactRow, Facts, Note, Section, ShowMe, type IconKind } from "./kit";
import { send } from "./send";
import "./video.css";

const KIND_WORDS: Record<ProductFactKind, string> = {
  price: "Price", oldPrice: "Before", stock: "Stock", delivery: "Delivery", warranty: "Warranty", returns: "Returns", spec: "",
};

const KIND_ICON: Record<ProductFactKind, IconKind> = {
  price: "price", oldPrice: "price", stock: "stock", delivery: "delivery", warranty: "warranty", returns: "returns", spec: "spec",
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
    <FactRow key={f.id} className={f.kind === "price" ? "product-price" : f.kind === "oldPrice" ? "product-old" : undefined}
      emphasis={f.kind === "price" ? "strong" : f.kind === "oldPrice" ? "old" : undefined}
      testid="cap-product-fact" attrs={{ "data-kind": f.kind, "data-from": f.from }}
      icon={KIND_ICON[f.kind]} label={labelOf(f)} labelTitle={f.label} valueTestid="cap-product-value"
      value={<>{f.value}{gone === f.id && <span className="note"> That part of the page is no longer shown.</span>}</>}
      from={f.from === "page"
        ? <ShowMe onClick={() => void show(f)} label={`Show me: ${labelOf(f)}`} testid="cap-product-show" />
        : <span title="Read from the shop's structured data: it has no place on the page to show.">From data</span>} />
  );

  return (
    <Section id="cap-product-h" title="This product" testid="cap-product" className="product">
      {facts.name && <p className="product-name" data-testid="cap-product-name">{facts.name}</p>}
      {main.length > 0 && <Facts className="product-card">{main.map(row)}</Facts>}
      {specs.length > 0 && (
        <details className="product-specs" open={main.length === 0}>
          <summary data-testid="cap-product-specs">Specifications ({specs.length})</summary>
          <Facts className="product-card">{specs.map(row)}</Facts>
        </details>
      )}
      <Note>Read from the page on this device, no AI.</Note>
    </Section>
  );
}
