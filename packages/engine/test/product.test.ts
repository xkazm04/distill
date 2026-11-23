// r4-07: a product page's facts. Structured data first (JSON-LD Product with an Offer, an offers array, an
// AggregateOffer, microdata), then Czech shop labels and phrases, then English. Not a shop: null.
import { describe, expect, it } from "vitest";
import { readProduct, type ProductFacts } from "../src/index.js";
import { parse } from "./helpers.js";

const page = (head: string, body: string, lang = "cs") => parse(`<!doctype html><html lang="${lang}"><head>${head}</head><body>${body}</body></html>`);
const ld = (json: unknown) => `<script type="application/ld+json">${JSON.stringify(json)}</script>`;
const kinds = (p: ProductFacts | null) => p?.facts.map((f) => [f.kind, f.value, f.from]);

describe("readProduct: JSON-LD", () => {
  it("a Product with one Offer: price, stock, delivery, warranty, returns, specs; all from the data", () => {
    const p = readProduct(page(ld({
      "@context": "https://schema.org", "@type": "Product", name: "Konvice Teplík",
      additionalProperty: [{ "@type": "PropertyValue", name: "Objem", value: "1,7", unitText: "l" }, { name: "Příkon", value: "2200 W" }],
      offers: {
        "@type": "Offer", price: "1299", priceCurrency: "CZK", availability: "https://schema.org/InStock",
        priceSpecification: { "@type": "UnitPriceSpecification", price: 1599, priceCurrency: "CZK", priceType: "https://schema.org/StrikethroughPrice" },
        shippingDetails: { "@type": "OfferShippingDetails", shippingRate: { value: 0, currency: "CZK" }, deliveryTime: { transitTime: { minValue: 1, maxValue: 3, unitCode: "DAY" } } },
        warranty: { "@type": "WarrantyPromise", durationOfWarranty: { value: 2, unitCode: "ANN" } },
        hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", merchantReturnDays: 14 },
      },
    }), "<h1>Konvice Teplík</h1><p>Popis.</p>"));
    expect(p?.name).toBe("Konvice Teplík");
    expect(kinds(p)).toEqual([
      ["price", "1 299 CZK", "data"],
      ["oldPrice", "1 599 CZK", "data"],
      ["stock", "In stock", "data"],
      ["delivery", "1–3 days, free", "data"],
      ["warranty", "2 years", "data"],
      ["returns", "14 days", "data"],
      ["spec", "1,7 l", "data"],
      ["spec", "2200 W", "data"],
    ]);
    expect(p?.facts.map((f) => f.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
  });

  it("an offers array inside an @graph: the first offer with a price", () => {
    const p = readProduct(page(ld({ "@graph": [
      { "@type": "WebSite", name: "Shop" },
      { "@type": ["Product"], name: "Mixér", offers: [{ "@type": "Offer", availability: "OutOfStock" }, { "@type": "Offer", price: 2490.5, priceCurrency: "CZK", availability: "https://schema.org/OutOfStock" }] },
    ] }), "<h1>Mixér</h1>"));
    expect(kinds(p)).toEqual([["price", "2 490,50 CZK", "data"], ["stock", "Out of stock", "data"]]);
  });

  it("an AggregateOffer: a price range", () => {
    const p = readProduct(page(ld({ "@type": "Product", name: "Trička", offers: { "@type": "AggregateOffer", lowPrice: 199, highPrice: 349, priceCurrency: "CZK", offerCount: 5 } }), "<h1>Trička</h1>"));
    expect(kinds(p)).toEqual([["price", "199–349 CZK", "data"]]);
  });

  it("a ProductGroup: its first variant's offer", () => {
    const p = readProduct(page(ld({ "@type": "ProductGroup", name: "Boty", hasVariant: [{ "@type": "Product", offers: { "@type": "Offer", price: 1890, priceCurrency: "CZK" } }] }), "<h1>Boty</h1>", "en"));
    expect(kinds(p)).toEqual([["price", "1,890 CZK", "data"]]);
  });

  it("the price the page shows with the same amount is taken from the page (Show me); the data's old price stays data", () => {
    const seen: string[] = [];
    const doc = page(ld({ "@type": "Product", name: "Konvice", offers: { "@type": "Offer", price: 1299, priceCurrency: "CZK", availability: "InStock",
      priceSpecification: [{ price: 1599, priceType: "ListPrice" }] } }),
      `<h1>Konvice</h1><div class="product-price"><span class="price-final">1 299 Kč</span></div><p class="stock">Skladem 5 ks</p>`);
    const p = readProduct(doc, { onElement: (id, el) => seen.push(`${id}:${el.className}`) });
    expect(kinds(p)).toEqual([["price", "1 299 Kč", "page"], ["oldPrice", "1 599 CZK", "data"], ["stock", "Skladem 5 ks", "page"]]);
    expect(seen).toEqual(["p0:price-final", "p2:stock"]);
  });
});

describe("readProduct: microdata", () => {
  it("itemprop price and availability inside an Offer; the shown ones carry their place", () => {
    const seen = new Map<string, Element>();
    const doc = page("", `
      <div itemscope itemtype="https://schema.org/Product">
        <h1 itemprop="name">Pánev Litina 28</h1>
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <span itemprop="price" content="899">899 Kč</span><meta itemprop="priceCurrency" content="CZK">
          <link itemprop="availability" href="https://schema.org/InStock"><span>Skladem</span>
        </div>
        <div itemprop="additionalProperty" itemscope itemtype="https://schema.org/PropertyValue"><span itemprop="name">Průměr</span>: <span itemprop="value">28 cm</span></div>
      </div>`);
    const p = readProduct(doc, { onElement: (id, el) => seen.set(id, el) });
    expect(p?.name).toBe("Pánev Litina 28");
    expect(kinds(p)).toEqual([["price", "899 Kč", "page"], ["stock", "Skladem", "page"], ["spec", "28 cm", "page"]]);
    expect(seen.get("p0")?.getAttribute("itemprop")).toBe("price");
  });

  it("price only in a <meta>: data", () => {
    const p = readProduct(page("", `<div itemscope itemtype="http://schema.org/Product"><h1 itemprop="name">Hrnek</h1><div itemprop="offers" itemscope itemtype="http://schema.org/Offer"><meta itemprop="price" content="149.00"><meta itemprop="priceCurrency" content="CZK"></div></div>`));
    expect(kinds(p)).toEqual([["price", "149 CZK", "data"]]);
  });
});

describe("readProduct: Czech shop labels", () => {
  const shop = `
    <header><nav><a href="/">Úvod</a></nav></header>
    <main>
      <h1>Akumulátorová vrtačka Vrták 18V</h1>
      <div class="cena"><span class="cena-old"><del>3 490 Kč</del></span> <strong class="cena-final">2 990 Kč</strong></div>
      <table class="info">
        <tr><th>Dostupnost:</th><td>Skladem (více než 5 ks)</td></tr>
        <tr><th>Doprava</th><td>od 89 Kč</td></tr>
        <tr><th>Doručení</th><td>do 2 pracovních dnů</td></tr>
        <tr><th>Záruka</th><td>36 měsíců</td></tr>
      </table>
      <p>Vrácení zboží: do 30 dnů bez udání důvodu</p>
      <button>Do košíku</button>
      <h2>Technické parametry</h2>
      <dl><dt>Napětí</dt><dd>18 V</dd><dt>Kroutící moment</dt><dd>45 Nm</dd><dt>Hmotnost</dt><dd>1,4 kg</dd></dl>
    </main>
    <section class="related"><h2>Podobné</h2><div class="price">1 990 Kč</div></section>`;

  it("table rows, a 'Label: value' line, a struck-through old price, Parametry as a description list", () => {
    const p = readProduct(page("", shop));
    expect(p?.name).toBe("Akumulátorová vrtačka Vrták 18V");
    expect(p?.facts.map((f) => [f.kind, f.label, f.value, f.from])).toEqual([
      ["price", "Price", "2 990 Kč", "page"],
      ["oldPrice", "Before", "3 490 Kč", "page"],
      ["stock", "Dostupnost", "Skladem (více než 5 ks)", "page"],
      ["delivery", "Doprava", "od 89 Kč", "page"],
      ["delivery", "Doručení", "do 2 pracovních dnů", "page"],
      ["warranty", "Záruka", "36 měsíců", "page"],
      ["returns", "Vrácení zboží", "do 30 dnů bez udání důvodu", "page"],
      ["spec", "Napětí", "18 V", "page"],
      ["spec", "Kroutící moment", "45 Nm", "page"],
      ["spec", "Hmotnost", "1,4 kg", "page"],
    ]);
  });

  it("phrases by themselves: 'Skladem', '14 dní na vrácení', 'Doprava zdarma', '2 roky záruka'", () => {
    const p = readProduct(page("", `<h1>Hrnek</h1><span class="price">149 Kč</span><span class="avail">Skladem</span>
      <ul><li>Doprava zdarma</li><li>14 dní na vrácení</li><li>Záruka 2 roky</li></ul><a href="#" class="btn">Koupit</a>`));
    expect(kinds(p)).toEqual([
      ["price", "149 Kč", "page"], ["stock", "Skladem", "page"], ["delivery", "Doprava zdarma", "page"],
      ["warranty", "Záruka 2 roky", "page"], ["returns", "14 dní na vrácení", "page"],
    ]);
  });

  it("a label element and its value beside it", () => {
    const p = readProduct(page("", `<h1>Lampa</h1><div class="product-price">1 250 Kč</div>
      <div class="row"><span class="label">Dostupnost</span><span class="value">Na objednávku</span></div>
      <div class="row"><span class="label">Záruka</span><span class="value">24 měsíců</span></div>`));
    expect(kinds(p)).toEqual([["price", "1 250 Kč", "page"], ["stock", "Na objednávku", "page"], ["warranty", "24 měsíců", "page"]]);
  });

  it("what Clean hid and form fields are not read", () => {
    const p = readProduct(page("", `<h1>Lampa</h1><div class="product-price">1 250 Kč</div><button>Do košíku</button>
      <div data-distill-hide="ad"><p>Záruka: 10 let</p></div><input class="price" value="99 Kč"><p>Skladem</p>`));
    expect(kinds(p)).toEqual([["price", "1 250 Kč", "page"], ["stock", "Skladem", "page"]]);
  });
});

describe("readProduct: English", () => {
  it("a WooCommerce-like page: del/ins prices, In stock, perks, Specifications table", () => {
    const p = readProduct(page("", `<h1 class="product_title">Trail Lantern</h1>
      <p class="price"><del><span class="amount">£39.99</span></del> <ins><span class="amount">£29.99</span></ins></p>
      <p class="stock in-stock">In stock</p><button class="single_add_to_cart_button">Add to cart</button>
      <ul><li>Free delivery on orders over £25</li><li>2-year warranty</li><li>30 days to return</li></ul>
      <h2>Specifications</h2><table><tr><th>Weight</th><td>310 g</td></tr><tr><th>Battery</th><td>5200 mAh</td></tr></table>`, "en"));
    expect(kinds(p)).toEqual([
      ["price", "£29.99", "page"], ["oldPrice", "£39.99", "page"], ["stock", "In stock", "page"],
      ["delivery", "Free delivery on orders over £25", "page"], ["warranty", "2-year warranty", "page"], ["returns", "30 days to return", "page"],
      ["spec", "310 g", "page"], ["spec", "5200 mAh", "page"],
    ]);
  });

  it("labels: Price, Availability, Shipping, Warranty, Returns", () => {
    const p = readProduct(page("", `<h1>Desk</h1><dl><dt>Price</dt><dd>$249.00</dd><dt>Availability</dt><dd>Ships in 3 weeks</dd>
      <dt>Shipping</dt><dd>$35 flat</dd><dt>Warranty</dt><dd>5 years</dd><dt>Returns</dt><dd>60 days</dd></dl>`, "en"));
    expect(kinds(p)).toEqual([["price", "$249.00", "page"], ["stock", "Ships in 3 weeks", "page"], ["delivery", "$35 flat", "page"], ["warranty", "5 years", "page"], ["returns", "60 days", "page"]]);
  });
});

describe("readProduct: not a product page", () => {
  it("a news article with prices in its text", () => {
    expect(readProduct(page("", `<article><h1>Ceny energií</h1><p>Elektřina stojí 5 Kč za kWh a plyn 2 Kč. Záruka nízkých cen neexistuje.</p></article>`))).toBeNull();
  });
  it("a rental price list without anything else of a shop", () => {
    expect(readProduct(page("", `<h1>Půjčovna vozíků</h1><table><tr><td>Vozík 750 kg</td><td>300 Kč/den</td></tr><tr><td>Vozík 1300 kg</td><td>450 Kč/den</td></tr></table>`))).toBeNull();
  });
  it("an empty page", () => {
    expect(readProduct(page("", ""))).toBeNull();
  });
});
