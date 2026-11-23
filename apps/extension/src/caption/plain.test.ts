// Plain words in place (r2-04), the page side: the same swap as Translate. Which blocks go, that a translated block's
// plain words rewrite its translation, and that As written, Keep <language>, Original and close bring back exactly
// what the page had.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CleanContext } from "./context";
import {
  applyPlain, applyTranslation, clearTranslation, originalShown, PLAIN, plainBlocks, plainShown, showSource, textBlocks,
  TRANSLATED, watchText,
} from "./translate";

const PAGE = `
<main><article id="main">
  <h1 id="h">Poplatek za odpad 2027</h1>
  <p id="a">Poplatek za komunální odpad ve výši <b>900 Kč</b> za osobu a kalendářní rok je splatný nejpozději do 31. března 2027 na účet obce.</p>
  <p id="b">Osvobozeny jsou osoby, které mají v obci trvalý pobyt, avšak se zde prokazatelně nezdržují déle než 6 měsíců, a dále děti do 3 let.</p>
  <ul id="list"><li>Hotově na pokladně obecního úřadu v úředních hodinách, tedy v pondělí a ve středu od 8:00 do 17:00.</li><li>Krátká položka</li></ul>
  <p id="en">The fee can also be paid at the post office using the payment slip that every household receives by mail.</p>
  <form><p id="fp">Napište nám, kdy a jakým způsobem chcete poplatek zaplatit, a my se vám ozveme.</p><textarea id="ta">Můj dotaz k poplatku za odpad a ke splatnosti</textarea></form>
</article></main>`;

function setup(): CleanContext {
  document.documentElement.setAttribute("lang", "cs");
  document.body.innerHTML = PAGE;
  const $ = (id: string) => document.getElementById(id) as Element;
  const body = ["a", "b", "list", "en", "fp"].map($);
  return { doc: document, win: window, keep: [$("h"), ...body], body, main: $("main"), protect: [], removed: new Map() };
}

const text = (id: string) => document.getElementById(id)?.textContent ?? "";
/** As the frame does it: the blocks, Plain on, then the rewrites ("PLAIN " + the words). */
const plainAll = (ctx: CleanContext, mark = "PLAIN") => {
  const blocks = plainBlocks(ctx);
  plainShown(true);
  return { blocks, applied: applyPlain(blocks.map((b) => ({ id: b.id, text: `${mark} ${b.text}` }))) };
};

afterEach(() => { clearTranslation(); document.body.innerHTML = ""; });

describe("plainBlocks", () => {
  it("hands over the long blocks as the page shows them, a block in the reader's language too; never a heading, a short line or a form", () => {
    const blocks = plainBlocks(setup());
    expect(blocks.map((b) => b.text)).toEqual([
      "Poplatek za komunální odpad ve výši 900 Kč za osobu a kalendářní rok je splatný nejpozději do 31. března 2027 na účet obce.",
      "Osvobozeny jsou osoby, které mají v obci trvalý pobyt, avšak se zde prokazatelně nezdržují déle než 6 měsíců, a dále děti do 3 let.",
      "Hotově na pokladně obecního úřadu v úředních hodinách, tedy v pondělí a ve středu od 8:00 do 17:00.",
      "The fee can also be paid at the post office using the payment slip that every household receives by mail.",
    ]);
    // Translate's ids stay as they were: the English block has an id of its own kind.
    expect(blocks.map((b) => b.id)).toEqual(["t1", "t2", "t3", "p0"]);
  });

  it("puts plain words in only while Plain is on; As written brings back every word and attribute", () => {
    const ctx = setup();
    const before = document.body.innerHTML;
    const { applied } = plainAll(ctx);
    expect(applied).toBe(4);
    expect(text("a")).toMatch(/^PLAIN Poplatek za komunální odpad ve výši 900 Kč/);
    expect(document.querySelector("#a b")?.textContent).toMatch(/\S/); // the bold keeps words of its own
    expect(document.getElementById("a")?.hasAttribute(PLAIN)).toBe(true);
    expect(document.getElementById("a")?.hasAttribute(TRANSLATED)).toBe(false);
    expect(document.getElementById("a")?.hasAttribute("lang")).toBe(false);
    expect(text("h")).toBe("Poplatek za odpad 2027");
    expect(text("fp")).toMatch(/^Napište nám/);
    expect((document.getElementById("ta") as HTMLTextAreaElement).value).toBe("Můj dotaz k poplatku za odpad a ke splatnosti");
    expect(plainShown(false)).toBe(0);
    expect(document.body.innerHTML).toBe(before);
    // On again: the same plain words, no new ask.
    expect(plainShown(true)).toBe(4);
    expect(plainBlocks(ctx)).toEqual([]);
    expect(text("b")).toMatch(/^PLAIN /);
  });

  it("a rewrite that arrives while Plain is off waits; one for words the block no longer shows is not put in", () => {
    const ctx = setup();
    const blocks = plainBlocks(ctx);
    applyPlain([{ id: blocks[0]?.id ?? "", text: "PLAIN early" }]);
    expect(text("a")).toMatch(/^Poplatek/);
    plainShown(true);
    expect(text("a")).toBe("PLAIN early");
    // An id never handed over, or handed over and then rewritten by the page.
    expect(applyPlain([{ id: "t0", text: "PLAIN heading" }])).toBe(0);
    (document.querySelector("#b")?.firstChild as Text).nodeValue = "Osvobozeny jsou nově všechny děti do 6 let a senioři nad 70 let věku.";
    expect(applyPlain([{ id: blocks[1]?.id ?? "", text: "PLAIN b" }])).toBe(0);
    expect(text("b")).toMatch(/^Osvobozeny jsou nově/);
  });

  it("Original and close bring back every word", () => {
    const ctx = setup();
    const before = document.body.innerHTML;
    plainAll(ctx);
    originalShown(true);
    expect(document.body.innerHTML).toBe(before);
    originalShown(false);
    expect(text("a")).toMatch(/^PLAIN /);
    clearTranslation();
    expect(document.body.innerHTML).toBe(before);
  });
});

describe("plain words on a translated page", () => {
  function translatedPage(): CleanContext {
    const ctx = setup();
    const blocks = textBlocks(ctx);
    applyTranslation(blocks.map((b) => ({ id: b.id, text: `EN ${b.text}` })));
    return ctx;
  }

  it("rewrites the translation, not the page's words; As written shows the translation again", () => {
    const ctx = translatedPage();
    const blocks = plainBlocks(ctx);
    expect(blocks[0]?.text).toMatch(/^EN Poplatek za komunální odpad ve výši 900 Kč/);
    expect(blocks.map((b) => b.text).at(-1)).toBe("The fee can also be paid at the post office using the payment slip that every household receives by mail.");
    plainShown(true);
    applyPlain(blocks.map((b) => ({ id: b.id, text: `PLAIN ${b.text}` })));
    const a = document.getElementById("a") as HTMLElement;
    expect(a.textContent).toMatch(/^PLAIN EN Poplatek/);
    expect(a.hasAttribute(TRANSLATED)).toBe(true);
    expect(a.getAttribute("lang")).toBe("en");
    expect(a.hasAttribute(PLAIN)).toBe(true);
    plainShown(false);
    expect(a.textContent).toMatch(/^EN Poplatek/);
    expect(a.hasAttribute(PLAIN)).toBe(false);
  });

  it("Keep Czech turns plain words off and shows the page's own words; Show English shows the translation", () => {
    const ctx = translatedPage();
    const before = setupHtml();
    plainAll(ctx);
    showSource(true);
    expect(text("a")).toMatch(/^Poplatek za komunální odpad/);
    expect(document.getElementById("a")?.hasAttribute(PLAIN)).toBe(false);
    expect(document.getElementById("a")?.hasAttribute("lang")).toBe(false);
    expect(document.querySelector("article")?.innerHTML).toBe(before);
    showSource(false);
    expect(text("a")).toMatch(/^EN Poplatek/); // plain stays off until the person asks again
    expect(plainShown(true)).toBe(4);
    expect(text("a")).toMatch(/^PLAIN EN Poplatek/);
  });

  it("with Keep Czech on, Plain rewrites the page's own words, and keeps both rewrites apart", () => {
    const ctx = translatedPage();
    plainAll(ctx);
    showSource(true);
    const czech = plainBlocks(ctx);
    expect(czech[0]?.text).toMatch(/^Poplatek za komunální odpad/);
    plainShown(true);
    applyPlain(czech.map((b) => ({ id: b.id, text: `JASNĚ ${b.text}` })));
    expect(text("a")).toMatch(/^JASNĚ Poplatek/);
    showSource(false);
    plainShown(true);
    expect(text("a")).toMatch(/^PLAIN EN Poplatek/);
    clearTranslation();
    expect(text("a")).toMatch(/^Poplatek za komunální odpad ve výši 900 Kč/);
  });
});

/** The article's markup of a fresh copy of the page (the page's own words). */
function setupHtml(): string {
  const box = document.createElement("div");
  box.innerHTML = PAGE;
  return box.querySelector("article")?.innerHTML ?? "";
}

describe("plain words and text the page adds later", () => {
  const sent: { count?: number }[] = [];
  beforeEach(() => {
    sent.length = 0;
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: (m: { count?: number }) => { sent.push(m); return Promise.resolve(); } } };
  });
  const settle = (ms = 1300) => new Promise((r) => setTimeout(r, ms));

  it("an untranslated page with Plain on: a long paragraph added later is counted and handed over; a rewritten one shows the page's new words", async () => {
    const ctx = setup();
    plainAll(ctx);
    watchText(3, () => ctx);
    await settle();
    expect(sent).toEqual([]); // Distill's own writes do not wake it
    const late = document.createElement("p");
    late.textContent = "Obec dále upozorňuje, že od 1. ledna 2028 se poplatek zvýší na 1 020 Kč za osobu a rok.";
    document.getElementById("main")?.append(late);
    (ctx.body as Element[]).push(late);
    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 4000 });
    expect(sent[0]).toMatchObject({ count: 1 });
    expect(plainBlocks(ctx).map((b) => b.text)).toEqual([late.textContent]);
    // The page rewrites a block that shows plain words: the page's new words win.
    const b = document.querySelector("#b") as HTMLElement;
    (b.firstChild as Text).nodeValue = "Osvobozeny jsou nově všechny děti do 6 let a také senioři nad 70 let věku.";
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
    expect(b.textContent).toBe("Osvobozeny jsou nově všechny děti do 6 let a také senioři nad 70 let věku.");
    expect(b.hasAttribute(PLAIN)).toBe(false);
    // As written: nothing is handed over while the page shows its own words.
    plainShown(false);
    const n = sent.length;
    const later = document.createElement("p");
    later.textContent = "Další dlouhý odstavec, který stránka přidala, když už byly zapnuté původní formulace textu.";
    document.getElementById("main")?.append(later);
    (ctx.body as Element[]).push(later);
    await settle();
    expect(sent).toHaveLength(n);
  });

  it("a translated page with Plain on: a block translated later is handed over for plain words once it has its translation", () => {
    const ctx = setup();
    const blocks = textBlocks(ctx);
    applyTranslation(blocks.slice(0, 2).map((b) => ({ id: b.id, text: `EN ${b.text}` })));
    watchText(3, () => ctx);
    plainBlocks(ctx);
    plainShown(true);
    // The untranslated Czech blocks wait for their translation: not handed over for plain words in Czech.
    const first = plainBlocks(ctx).map((b) => b.text);
    expect(first.some((t) => t.startsWith("Osvobozeny"))).toBe(false);
    sent.length = 0;
    expect(applyTranslation(blocks.slice(2).map((b) => ({ id: b.id, text: `EN ${b.text}` })))).toBeGreaterThan(0);
    expect(sent.at(-1)).toMatchObject({ count: blocks.length - 2 }); // the frame hears: plain words wait
    expect(plainBlocks(ctx).map((b) => b.text)).toContain(`EN ${text("b").replace(/^EN /, "")}`);
  });
});
