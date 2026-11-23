// Readable tables (r2-05), the page side: which tables hold data (never a table that lays out a page) and that every
// change comes off again. Sizes need a real browser: the e2e (caption-tables-links.spec.ts) checks sticky, scroll, cards.
import { afterEach, describe, expect, it } from "vitest";
import type { CleanContext } from "./context";
import { clearTables, dataTable, readableTables, setTables } from "./tables";

const table = (html: string): Element => {
  document.body.innerHTML = html;
  return document.querySelector("table") as Element;
};

describe("dataTable: data tables", () => {
  it("a table with a thead of th cells", () => {
    const shape = dataTable(table(`<table><thead><tr><th>Poplatek</th><th>Kč</th><th>Splatnost</th></tr></thead>
      <tbody><tr><td>Psi</td><td>200</td><td>31. 3.</td></tr><tr><td>Odpady</td><td>750</td><td>30. 6.</td></tr></tbody></table>`));
    expect(shape).toMatchObject({ cols: 3, labels: ["Poplatek", "Kč", "Splatnost"] });
    expect(shape?.head.localName).toBe("thead");
    expect(shape?.rows).toHaveLength(2);
  });
  it("a first row of th cells, no thead", () => {
    const shape = dataTable(table(`<table><tr><th>Den</th><th>Svoz</th></tr><tr><td>Po</td><td>Plast</td></tr><tr><td>St</td><td>Papír</td></tr></table>`));
    expect(shape?.head.localName).toBe("tr");
    expect(shape?.labels).toEqual(["Den", "Svoz"]);
  });
  it("an old site's bold first row of td cells is a header", () => {
    expect(dataTable(table(`<table border=1><tr><td><b>Datum</b></td><td><strong>Akce</strong></td></tr><tr><td>1. 5.</td><td>Pálení čarodějnic</td></tr></table>`))?.cols).toBe(2);
  });
  it("the trailer rental's price table: every cell a th, pictures 100 px wide, 8 columns", () => {
    const rows = Array.from({ length: 6 }, (_, i) => `<tr><th><img src="v${i}.png" height="50" width="100"></th><th>2.${i}</th><th>1.2</th><th>bez plachty</th><th>400</th><th>300</th><th>1000</th><th><a href="p${i}.html">Popis</a></th>`).join("\n");
    const shape = dataTable(table(`<table border="2" cellpadding="8" cellspacing="8"><tr><th>Typ</th><th>Délka m</th> <th>Šířka m</th><th>Výška m</th><th>Nosnost Kg</th><th>Cena s daní za 1 den Kč</th><th>Kauce</th><th>Foto</th>\n${rows}</table>`));
    expect(shape?.cols).toBe(8);
  });
  it("a title row spanning the table and rows with a checkbox still count", () => {
    expect(dataTable(table(`<table><thead><tr><th>Jméno</th><th>Hlas</th></tr></thead><tbody>
      <tr><td>Novák</td><td><input type="checkbox"> ano</td></tr><tr><td>Dvořák</td><td>ne</td></tr><tr><td>Svoboda</td><td>ano</td></tr>
      <tr><td>Král</td><td>ne</td></tr><tr><td colspan="2">Celkem 4</td></tr></tbody></table>`))).not.toBeNull();
  });
});

describe("dataTable: layout tables are never touched", () => {
  it("the FrontPage car repair site: one column holding the whole page", () => {
    expect(dataTable(table(`<table border="0" width="764" height="100%" cellspacing="0" cellpadding="0"><tr><td width="100%" align="center">
      <div style="position: relative; height: 420px;"><img src="dymacek.png"><div class="menu"><ul><li><a href="/autoservis.htm">autoservis</a></li></ul></div></div></td></tr>
      <tr><td><p>Autoservis Dymáček nabízí opravy všech značek osobních automobilů.</p></td></tr></table>`))).toBeNull();
  });
  it("a page in two columns: menu and text, no header", () => {
    expect(dataTable(table(`<table width="100%"><tr><td width="150"><a href="/">Úvod</a><br><a href="/kontakt">Kontakt</a></td>
      <td><h2>Vítejte</h2><p>${"Obec leží v malebném údolí řeky. ".repeat(20)}</p></td></tr>
      <tr><td></td><td><p>Copyright</p></td></tr></table>`))).toBeNull();
  });
  it("a layout table that holds another table", () => {
    expect(dataTable(table(`<table><tr><th>Menu</th><th>Obsah</th></tr><tr><td>a</td><td><table><tr><th>X</th><th>Y</th></tr><tr><td>1</td><td>2</td></tr></table></td></tr></table>`))).toBeNull();
  });
  it("role=presentation, even with th cells", () => {
    expect(dataTable(table(`<table role="presentation"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`))).toBeNull();
    expect(dataTable(table(`<table role="none"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`))).toBeNull();
  });
  it("a form laid out in a table", () => {
    expect(dataTable(table(`<table><tr><th>Jméno</th><th>E-mail</th></tr><tr><td><input name="j"></td><td><input name="e" type="email"></td></tr></table>`))).toBeNull();
  });
  it("a grid without a header (a picture gallery, a calendar of numbers)", () => {
    expect(dataTable(table(`<table><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td><td>6</td></tr><tr><td>7</td><td>8</td><td>9</td></tr></table>`))).toBeNull();
  });
  it("large pictures in the cells (a photo layout)", () => {
    expect(dataTable(table(`<table><tr><th>Jaro</th><th>Léto</th></tr><tr><td><img src="a.jpg" width="400" height="300"></td><td><img src="b.jpg" width="400" height="300"></td></tr></table>`))).toBeNull();
  });
  it("cells of paragraphs and lists", () => {
    expect(dataTable(table(`<table><tr><th>Levá</th><th>Pravá</th></tr>
      <tr><td><p>Text</p><ul><li>a</li></ul></td><td><p>Text</p></td></tr><tr><td><p>Další</p></td><td><h3>Nadpis</h3></td></tr></table>`))).toBeNull();
  });
  it("one row, or one column, or only a header", () => {
    expect(dataTable(table(`<table><tr><th>A</th><th>B</th></tr></table>`))).toBeNull();
    expect(dataTable(table(`<table><tr><th>A</th></tr><tr><td>1</td></tr><tr><td>2</td></tr></table>`))).toBeNull();
    expect(dataTable(table(`<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody></tbody></table>`))).toBeNull();
  });
  it("rows that disagree on their columns", () => {
    expect(dataTable(table(`<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>x</td></tr><tr><td>1</td><td>2</td></tr><tr><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td></tr></table>`))).toBeNull();
  });
  it("mostly empty spacer cells", () => {
    expect(dataTable(table(`<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td></td><td>x</td><td></td></tr><tr><td></td><td></td><td>y</td></tr></table>`))).toBeNull();
  });
});

describe("readableTables: only the main text's data tables, and all of it comes off", () => {
  const PAGE = `<table id="layout" width="764"><tr><td>
    <div id="text"><p>Poplatky obce na rok 2026.</p>
      <table id="fees"><thead><tr><th>Poplatek</th><th>Kč</th></tr></thead><tbody><tr><td>Psi</td><td>200</td></tr><tr><td>Odpady</td><td>750</td></tr></tbody></table>
      <table id="wide"><tr><th>A</th><th>B</th><th>C</th><th>D</th><th>E</th></tr><tr><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td></tr></table>
    </div></td></tr></table>
    <footer><table id="foot"><tr><th>Den</th><th>Hodiny</th></tr><tr><td>Po</td><td>8-12</td></tr></table></footer>`;
  const setup = (): CleanContext => {
    document.body.innerHTML = PAGE;
    const $ = (id: string) => document.getElementById(id) as Element;
    const body = [$("layout")];
    return { doc: document, win: window, keep: body, body, main: $("layout"), protect: [], removed: new Map() };
  };
  afterEach(() => clearTables(document));

  it("marks the data tables inside the main text, never the layout table around them or the footer's", () => {
    const ctx = setup();
    const html = document.body.innerHTML;
    expect(readableTables(ctx)).toBe(2);
    expect(document.getElementById("layout")?.hasAttribute("data-distill-table")).toBe(false);
    expect(document.getElementById("foot")?.hasAttribute("data-distill-table")).toBe(false);
    expect(document.querySelector("#fees thead")?.hasAttribute("data-distill-table-head")).toBe(true);
    // Two columns: cards on a phone, each cell labelled with its header; five columns: no cards.
    expect(document.getElementById("fees")?.hasAttribute("data-distill-table-cards")).toBe(true);
    expect(Array.from(document.querySelectorAll("#fees td")).map((td) => td.getAttribute("data-distill-label"))).toEqual(["Poplatek", "Kč", "Poplatek", "Kč"]);
    expect(document.getElementById("wide")?.hasAttribute("data-distill-table-cards")).toBe(false);
    const style = document.querySelector('style[data-distill="tables"]')?.textContent ?? "";
    expect(style).toContain("html:not([data-distill-original]):not([data-distill-tables-off])");
    expect(style).toContain("@media (max-width: 480px)");

    // The switch: off and on again.
    expect(setTables(document, false)).toBe(0);
    expect(document.documentElement.hasAttribute("data-distill-tables-off")).toBe(true);
    expect(setTables(document, true)).toBe(2);
    expect(document.documentElement.hasAttribute("data-distill-tables-off")).toBe(false);

    // Close: the page exactly as it was.
    clearTables(document);
    expect(document.body.innerHTML).toBe(html);
    expect(document.querySelector('style[data-distill="tables"]')).toBeNull();
  });

  it("run again (Stay clean), it keeps the person's switch off", () => {
    const ctx = setup();
    readableTables(ctx);
    setTables(document, false);
    expect(readableTables(ctx)).toBe(2);
    expect(document.documentElement.hasAttribute("data-distill-tables-off")).toBe(true);
  });

  it("a table Clean hid is not touched", () => {
    const ctx = setup();
    document.getElementById("wide")?.setAttribute("data-distill-hide", "c1");
    expect(readableTables(ctx)).toBe(1);
  });

  it("a page with no data table gets no style", () => {
    document.body.innerHTML = `<main><p id="p">Jen text.</p></main>`;
    const p = document.getElementById("p") as Element;
    expect(readableTables({ doc: document, win: window, keep: [p], body: [p], main: p, protect: [], removed: new Map() })).toBe(0);
    expect(document.querySelector('style[data-distill="tables"]')).toBeNull();
  });
});
