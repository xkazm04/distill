// Translate in place (#10), the page side: which blocks go, how a translation goes into the page node by node, and
// that the page's own words come back exactly (Keep <language>, Original, close).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CleanContext } from "./context";
import { applyTranslation, clearTranslation, contactOnly, originalShown, showSource, spread, textBlocks, TRANSLATED, watchText } from "./translate";

const PAGE = `
<header><h1 id="h">Daňové přiznání 2026</h1><nav><a href="/">Úvod</a></nav></header>
<div id="perex">Letos poprvé musí podnikatelé podat přiznání jen elektronicky.</div><p class="byline">Redakce</p>
<main><article id="main">
  <p id="lead">Přiznání podáte do <a href="https://www.mojedane.cz">Moje daně</a> do <b>1. dubna</b> letošního roku.</p>
  <h2 id="h2">Co budete potřebovat</h2>
  <ul id="list"><li>Občanský průkaz</li><li>Potvrzení od zaměstnavatele</li></ul>
  <p id="num">2026</p>
  <p id="en">The form is available in English on the official website of the tax office.</p>
  <pre id="code">print("ahoj")</pre>
  <p id="keep">Značka <span translate="no">Moje daně</span> se nepřekládá.</p>
  <form id="f"><p id="fp">Napište nám</p><textarea id="ta">Můj dotaz</textarea></form>
  <p id="edit" contenteditable="true">Moje poznámka</p>
</article></main>
<aside><p id="side">Reklama</p></aside>`;

function setup(): CleanContext {
  document.documentElement.setAttribute("lang", "cs");
  document.body.innerHTML = PAGE;
  const $ = (id: string) => document.getElementById(id) as Element;
  const body = ["lead", "list", "num", "en", "code", "keep", "fp", "edit"].map($);
  const main = $("main");
  return { doc: document, win: window, keep: [$("h"), $("h2"), ...body], body, main, protect: [], removed: new Map() };
}

const html = (): string => document.body.innerHTML;

afterEach(() => { clearTranslation(); document.body.innerHTML = ""; });

describe("textBlocks", () => {
  it("hands over the headline, the lead under it, the main column's headings and the running text, one block per paragraph, item or cell", () => {
    const blocks = textBlocks(setup());
    expect(blocks.map((b) => b.text)).toEqual([
      "Daňové přiznání 2026",
      "Letos poprvé musí podnikatelé podat přiznání jen elektronicky.",
      "Přiznání podáte do Moje daně do 1. dubna letošního roku.",
      "Co budete potřebovat",
      "Občanský průkaz",
      "Potvrzení od zaměstnavatele",
      "Značka se nepřekládá.",
    ]);
    expect(blocks.map((b) => b.id)).toEqual(["t0", "t1", "t2", "t3", "t4", "t5", "t6"]);
  });

  it("never hands over a form, a field, an editable area, code, numbers only, or a block already in English", () => {
    const blocks = textBlocks(setup());
    expect(blocks.map((b) => b.text)).not.toContain("2026");
    const text = blocks.map((b) => b.text).join(" | ");
    for (const never of ["Napište nám", "Můj dotaz", "Moje poznámka", "ahoj", "official website", "Reklama", "Úvod", "Redakce"]) {
      expect(text).not.toContain(never);
    }
  });

  it("answers the same blocks while the same Clean stands", () => {
    const ctx = setup();
    expect(textBlocks(ctx)).toEqual(textBlocks(ctx));
  });

  it("a later ask answers only what is still untranslated, and Stay clean reading the page again keeps the translation", () => {
    const ctx = setup();
    const blocks = textBlocks(ctx);
    applyTranslation(blocks.slice(0, 3).map((b) => ({ id: b.id, text: `EN ${b.text}` })));
    // Stay clean (page.ts recheck) builds a new CleanContext for the same page.
    const again = textBlocks({ ...ctx, body: [...ctx.body] });
    expect(again.map((b) => b.id)).toEqual(blocks.slice(3).map((b) => b.id));
    expect(document.getElementById("h")?.textContent).toBe("EN Daňové přiznání 2026");
  });
});

describe("text the page adds later (watchText)", () => {
  const sent: unknown[] = [];
  beforeEach(() => {
    sent.length = 0;
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: (m: unknown) => { sent.push(m); return Promise.resolve(); } } };
  });

  /** The demo page, fully translated ("EN " + the words), and watched for tab 7. */
  function translated(): { ctx: CleanContext; ids: string[] } {
    const ctx = setup();
    const blocks = textBlocks(ctx);
    applyTranslation(blocks.map((b) => ({ id: b.id, text: `EN ${b.text}` })));
    watchText(7, () => ctx);
    return { ctx, ids: blocks.map((b) => b.id) };
  }
  const settle = (ms = 1300) => new Promise((r) => setTimeout(r, ms));
  const told = () => vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 4000 });

  it("a paragraph added to the main column: the frame hears a count (never the words), then gets that block alone", async () => {
    const { ctx, ids } = translated();
    await settle(); // what changed while the first translation ran: nothing
    expect(sent).toEqual([]);
    const late = document.createElement("p");
    late.id = "late";
    late.textContent = "Další odstavec přišel až po načtení stránky.";
    document.getElementById("main")?.append(late);
    await told();
    expect(sent[0]).toEqual({ type: "distill:caption:moreText", tabId: 7, count: 1 });
    const more = textBlocks(ctx);
    expect(more).toEqual([{ id: `t${ids.length}`, text: "Další odstavec přišel až po načtení stránky." }]);
    expect(applyTranslation(more.map((b) => ({ id: b.id, text: "Another paragraph came later." })))).toBe(1);
    expect(late.textContent).toBe("Another paragraph came later.");
    expect(late.getAttribute("lang")).toBe("en");
    showSource(true);
    expect(late.textContent).toBe("Další odstavec přišel až po načtení stránky.");
    showSource(false);
    await settle();
    expect(sent).toHaveLength(1); // Distill's own writes did not wake it
  });

  it("a box the page loads beside the main column later (a widget, a teaser) is not the main text and is left alone", async () => {
    translated();
    const widget = document.createElement("section");
    widget.innerHTML = "<h2>Video pro vás</h2><p>Pořídili si emu. Z pruhovaných ptáčat vyrostli opeření obři, kteří milují mazlení.</p>";
    document.querySelector("main")?.after(widget);
    await settle(1500);
    expect(sent).toEqual([]);
    expect(widget.textContent).not.toContain("EN ");
  });

  it("a block the page rewrote after its translation is translated again; Keep Czech shows the page's new words", async () => {
    const { ctx } = translated();
    const h2 = document.getElementById("h2") as HTMLElement;
    expect(h2.textContent).toBe("EN Co budete potřebovat");
    (h2.firstChild as Text).nodeValue = "Co si připravit předem";
    await told();
    const more = textBlocks(ctx);
    expect(more.map((b) => b.text)).toEqual(["Co si připravit předem"]);
    applyTranslation(more.map((b) => ({ id: b.id, text: "What to prepare first" })));
    expect(h2.textContent).toBe("What to prepare first");
    showSource(true);
    expect(h2.textContent).toBe("Co si připravit předem"); // the new original, not the old one
    originalShown(true);
    showSource(false);
    expect(h2.textContent).toBe("Co si připravit předem");
    originalShown(false);
    expect(h2.textContent).toBe("What to prepare first");
    clearTranslation();
    expect(h2.textContent).toBe("Co si připravit předem");
    expect(h2.hasAttribute("lang")).toBe(false);
  });

  it("the page writing a block's old words again gets the translation back without asking the model", async () => {
    translated();
    const li = document.querySelector("#list li") as HTMLElement;
    (li.firstChild as Text).nodeValue = "Občanský průkaz";
    await settle(1500);
    expect(li.textContent).toBe("EN Občanský průkaz");
    expect(sent).toEqual([]);
  });

  it("Keep Czech, Original and their way back never wake it; text added meanwhile waits for the translation to show", async () => {
    translated();
    showSource(true);
    showSource(false);
    originalShown(true);
    originalShown(false);
    await settle();
    expect(sent).toEqual([]);
    showSource(true);
    const late = document.createElement("li");
    late.textContent = "Výpis z účtu";
    document.getElementById("list")?.append(late);
    await settle();
    expect(sent).toEqual([]); // the page shows its own words: nothing to translate into it now
    showSource(false);
    await told();
    expect(sent[0]).toMatchObject({ count: 1 });
  });

  it("a box the person brought back from More (comments) is translated, one block per comment", async () => {
    const ctx = setup();
    const comments = document.createElement("section");
    comments.className = "comments";
    comments.setAttribute("data-distill-hide", "c0");
    comments.innerHTML = `<h3>Komentáře</h3><div class="c"><b>Jana</b><div>Díky za návod, ušetřil mi čas.</div></div>
      <div class="c"><b>Petr</b><div>Kde najdu formulář pro rok 2025?</div></div>`;
    document.querySelector("main")?.after(comments);
    const live = { ...ctx, removed: new Map([["c0", comments as Element]]) };
    const blocks = textBlocks(live);
    expect(blocks.map((b) => b.text).join(" ")).not.toContain("Díky");
    applyTranslation(blocks.map((b) => ({ id: b.id, text: `EN ${b.text}` })));
    watchText(7, () => live);
    comments.removeAttribute("data-distill-hide");
    await told();
    expect(textBlocks(live).map((b) => b.text)).toEqual(["Komentáře", "Jana", "Díky za návod, ušetřil mi čas.", "Petr", "Kde najdu formulář pro rok 2025?"]);
  });

  it("a block the page keeps rewriting (a live counter) is translated three times, then left in the page's words", async () => {
    const { ctx } = translated();
    const h2 = document.getElementById("h2") as HTMLElement;
    let asked = 0;
    for (let round = 1; round <= 5; round++) {
      (h2.firstChild as Text).nodeValue = `Aktualizováno před ${round} minutami`;
      await settle();
      const more = textBlocks(ctx);
      asked += more.length;
      applyTranslation(more.map((b) => ({ id: b.id, text: `EN ${b.text}` })));
    }
    expect(asked).toBe(3);
    expect(sent).toHaveLength(3);
    expect(h2.textContent).toBe("Aktualizováno před 5 minutami");
    expect(h2.hasAttribute(TRANSLATED)).toBe(false);
  }, 15_000);

  it("stops watching on close", async () => {
    translated();
    clearTranslation();
    document.getElementById("main")?.append(Object.assign(document.createElement("p"), { textContent: "Ještě jeden odstavec." }));
    await settle();
    expect(sent).toEqual([]);
  });
});

describe("contact details only: nothing to translate", () => {
  it("a contact label around numbers, e-mails or a web address is skipped (Czech, German, English)", () => {
    for (const t of [
      "tel.: 549 211 296, 541 246 631", // Dymáček, live 2026-11-21
      "Tel./Fax: +420 377 912 345",
      "mobil: 602 123 456 a 777 654 321",
      "IČO: 12345678, DIČ: CZ12345678",
      "e-mail: servis@dymacek.cz",
      "č. ú.: 123456789/0100",
      "www.dymacek.cz",
      "Telefon: 089 123 45 67, E-Mail: info@werkstatt-beispiel.de",
      "USt-IdNr.: DE123456789",
      "Handy 0171 1234567 oder 0172 7654321",
      "Phone: (555) 010-0199 or e-mail office@example.com",
      "https://www.example.org/kontakt",
    ]) expect(contactOnly(t), t).toBe(true);
  });

  it("a sentence that holds a number or an address keeps its own words and is translated", () => {
    for (const t of [
      "Volejte 549 211 296 ve všední dny od 8 do 16 hodin.",
      "Rufen Sie uns unter 089 123 45 67 an.",
      "Call us on 555 0199 for an appointment.",
      "Adresa: Hlavní 12, 664 34 Kuřim",
      "Kontakt",
      "2026",
    ]) expect(contactOnly(t), t).toBe(false);
  });

  it("textBlocks leaves a contact line out and keeps the sentence beside it", () => {
    document.documentElement.setAttribute("lang", "cs");
    document.body.innerHTML = `<main><p id="a">Opravujeme osobní i užitková auta všech značek.</p>
      <p id="b">tel.: 549 211 296, 541 246 631</p><p id="c">Volejte 549 211 296 ve všední dny.</p></main>`;
    const body = ["a", "b", "c"].map((id) => document.getElementById(id) as Element);
    const ctx: CleanContext = { doc: document, win: window, keep: body, body, main: document.querySelector("main"), protect: [], removed: new Map() };
    expect(textBlocks(ctx).map((b) => b.text)).toEqual([
      "Opravujeme osobní i užitková auta všech značek.",
      "Volejte 549 211 296 ve všední dny.",
    ]);
  });
});

describe("applyTranslation", () => {
  it("replaces text node by node: links, bold and list items survive, and each block says its new language", () => {
    const ctx = setup();
    textBlocks(ctx);
    const n = applyTranslation([
      { id: "t2", text: "File the return through Moje daně by 1. dubna this year." },
      { id: "t4", text: "Identity card" },
      { id: "t9", text: "Unknown block" },
    ]);
    expect(n).toBe(2);
    const lead = document.getElementById("lead") as HTMLElement;
    expect(lead.textContent).toBe("File the return through Moje daně by 1. dubna this year.");
    // The link keeps its address and gets the words it had (a name comes back unchanged); the bold keeps the date.
    expect(lead.querySelector("a")?.getAttribute("href")).toBe("https://www.mojedane.cz");
    expect(lead.querySelector("a")?.textContent).toBe("Moje daně");
    expect(lead.querySelector("b")?.textContent).toBe("1. dubna");
    expect(lead.getAttribute(TRANSLATED)).toBe("");
    expect(lead.getAttribute("lang")).toBe("en");
    expect(document.querySelectorAll("#list li")).toHaveLength(2);
    expect(document.querySelector("#list li")?.textContent).toBe("Identity card");
    expect(document.querySelector("#list li")?.getAttribute("lang")).toBe("en");
  });

  it("leaves what the page keeps as it is (translate=no) and never touches the form", () => {
    const ctx = setup();
    textBlocks(ctx);
    applyTranslation([{ id: "t6", text: "The brand is not translated." }]);
    expect(document.querySelector("#keep span")?.textContent).toBe("Moje daně");
    expect(document.getElementById("keep")?.textContent).toContain("The brand");
    expect((document.getElementById("ta") as HTMLTextAreaElement).value).toBe("Můj dotaz");
    expect(document.getElementById("fp")?.textContent).toBe("Napište nám");
  });

  it("Keep Czech puts back the exact page; Show English the translation again", () => {
    const ctx = setup();
    const before = html();
    const blocks = textBlocks(ctx);
    applyTranslation(blocks.map((b) => ({ id: b.id, text: `EN ${b.text}` })));
    expect(html()).not.toBe(before);
    showSource(true);
    expect(html()).toBe(before);
    showSource(false);
    expect(document.getElementById("h")?.textContent).toBe("EN Daňové přiznání 2026");
    clearTranslation();
    expect(html()).toBe(before);
  });

  it("Original shows the page's own words, then goes back to the person's choice", () => {
    const ctx = setup();
    const before = html();
    textBlocks(ctx);
    applyTranslation([{ id: "t3", text: "What you will need" }]);
    originalShown(true);
    expect(html()).toBe(before);
    // A translation that arrives while Original is on waits for it to end.
    applyTranslation([{ id: "t4", text: "Identity card" }]);
    expect(html()).toBe(before);
    originalShown(false);
    expect(document.getElementById("h2")?.textContent).toBe("What you will need");
    expect(document.querySelector("#list li")?.textContent).toBe("Identity card");
    showSource(true);
    originalShown(true);
    originalShown(false);
    expect(html()).toBe(before); // the person chose Czech: Original ending does not bring the translation back
  });

  it("keeps a lang the block had, and leaves a node the page changed since alone", () => {
    const ctx = setup();
    document.getElementById("h2")?.setAttribute("lang", "cs-CZ");
    textBlocks(ctx);
    applyTranslation([{ id: "t3", text: "What you will need" }, { id: "t4", text: "Identity card" }]);
    const li = document.querySelector("#list li") as HTMLElement;
    (li.firstChild as Text).nodeValue = "Page's own new text";
    clearTranslation();
    expect(document.getElementById("h2")?.getAttribute("lang")).toBe("cs-CZ");
    expect(document.getElementById("h2")?.textContent).toBe("Co budete potřebovat");
    expect(li.textContent).toBe("Page's own new text");
    expect(document.querySelectorAll(`[${TRANSLATED}]`)).toHaveLength(0);
  });
});

describe("spread", () => {
  it("one node takes the whole translation", () => {
    expect(spread("Hello world", ["Ahoj světe"])).toEqual(["Hello world"]);
  });

  it("a node whose words come back unchanged keeps them; the rest is shared by length at word boundaries", () => {
    expect(spread("Call 377 912 345 on weekdays.", ["Volejte ", "377 912 345", " ve všední dny."]))
      .toEqual(["Call ", "377 912 345", " on weekdays."]);
  });

  it("every node keeps a word while there are words to give, and nothing is lost or added", () => {
    const parts = spread("Read the whole article today", ["Přečtěte si ", "celý", " článek ještě dnes"]);
    expect(parts.join("")).toBe("Read the whole article today");
    expect(parts.every((p) => p.trim().length > 0)).toBe(true);
  });

  it("an anchor is a whole word only, and in order", () => {
    const parts = spread("Praha 2 is in Prague", ["Praha", " 2 je v ", "Praha"]);
    expect(parts.join("")).toBe("Praha 2 is in Prague");
    expect(parts[0]).toBe("Praha");
  });
});
