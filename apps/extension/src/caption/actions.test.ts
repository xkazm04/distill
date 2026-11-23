// r4-01, round 3's loose ends in what this page asks of you: a village office's contacts that sit only in parts Clean
// hid count (marked hidden) on an office page and never on an article; an address written over several lines (with
// <br> or block children, in another order than it is listed) is found as one range. Real layout and highlights:
// e2e/caption-loose-ends.spec.ts.
import { afterEach, describe, expect, it } from "vitest";
import type { CleanContext } from "./context";
import { clearActions, rangeOfQuote, readActions, spanOfWords } from "./actions";

const HIDE = "data-distill-hide";

/** A village's fault-report page: a form and a short text, the office's phone, e-mail and address only in its footer
 *  and side column, which Clean hid. */
function village(kind: string): CleanContext {
  document.documentElement.setAttribute("lang", "cs");
  document.body.innerHTML = `
    <aside id="side"><h3>Obecní úřad</h3><p>Tel.: <a href="tel:+420377912345">377 912 345</a></p></aside>
    <main id="main">
      <h1>Hlášení závad</h1>
      <p id="p1">Pomocí tohoto formuláře můžete nahlásit závadu na veřejném osvětlení, komunikacích nebo mobiliáři obce.</p>
      <p id="p2">Závadu prověříme a o jejím odstranění vás budeme informovat na uvedený kontakt co nejdříve.</p>
      <form><label>Jméno <input name="jmeno"></label><label>Telefon <input name="tel" value="602 999 888"></label><textarea name="popis"></textarea></form>
    </main>
    <footer id="foot"><p>E-mail: <a href="mailto:podatelna@obec.example">podatelna@obec.example</a></p></footer>`;
  const side = document.getElementById("side") as Element;
  const foot = document.getElementById("foot") as Element;
  side.setAttribute(HIDE, "c0");
  foot.setAttribute(HIDE, "c1");
  const body = [document.getElementById("p1"), document.getElementById("p2")] as Element[];
  return {
    doc: document, win: window, keep: body, body, main: document.getElementById("main"), protect: [document.querySelector("form") as Element],
    removed: new Map([["c0", side], ["c1", foot]]), kind,
  };
}

afterEach(() => { clearActions(document); document.body.innerHTML = ""; });

describe("contacts in parts Clean hid (r4-01)", () => {
  it("count on an office's form page, marked hidden, after what is on screen; never what was typed", () => {
    const items = readActions(village("form"));
    expect(items.map((i) => [i.kind, i.text, !!i.hidden])).toEqual([
      ["contact", "Call 377 912 345", true],
      ["contact", "Write to podatelna@obec.example", true],
    ]);
    expect(items.map((i) => i.href)).toEqual(["tel:+420377912345", "mailto:podatelna@obec.example"]);
    expect(JSON.stringify(items)).not.toContain("602 999 888");
  });

  it("do not count on an article (the publisher's footer), nor in a part the page itself hides", () => {
    expect(readActions(village("article"))).toEqual([]);
    const ctx = village("form");
    // The side column hidden by the page, not by Clean: its phone is not counted.
    ctx.removed = new Map([["c1", document.getElementById("foot") as Element]]);
    expect(readActions(ctx).map((i) => i.text)).toEqual(["Write to podatelna@obec.example"]);
  });
});

describe("an address over several lines (r4-01)", () => {
  it("finds the words of an address listed in another order, close together", () => {
    const flat = "Michal Šmíd Rovná 235 Jablonec nad Nisou - Kokonín 468 01 Mapa";
    const span = spanOfWords(flat, "Rovná 235, 468 01 Jablonec nad Nisou - Kokonín");
    expect(span && flat.slice(span[0], span[1])).toBe("Rovná 235 Jablonec nad Nisou - Kokonín 468 01");
    // Words far apart are not one address; a single word is not looked for this way.
    expect(spanOfWords(`Rovná 235 ${"x ".repeat(80)} 468 01 Jablonec nad Nisou - Kokonín`, "Rovná 235, 468 01 Jablonec nad Nisou - Kokonín")).toBeNull();
    expect(spanOfWords("Rovná 235", "Rovná")).toBeNull();
  });

  it("a range from the first line to the last, over <br> and over block children", () => {
    document.body.innerHTML = `<h3 id="a">Michal Šmíd <br>
Rovná 235 <br>
Jablonec nad Nisou - Kokonín<br>
468 01 <br>
<a href="/mapka.html">Mapa</a></h3>
<div id="b"><div>Rovná 235</div><div>468 01 Jablonec nad Nisou - Kokonín</div></div>`;
    const quote = "Rovná 235, 468 01 Jablonec nad Nisou - Kokonín";
    const a = rangeOfQuote(document, { el: document.getElementById("a") as Element, nodes: [] }, quote);
    expect(a?.toString().replace(/\s+/g, " ").trim()).toBe("Rovná 235 Jablonec nad Nisou - Kokonín 468 01");
    const b = rangeOfQuote(document, { el: document.getElementById("b") as Element, nodes: [] }, quote);
    expect(b?.toString()).toBe("Rovná 235468 01 Jablonec nad Nisou - Kokonín");
    // A one-line quote is still found exactly.
    const c = rangeOfQuote(document, { el: document.getElementById("a") as Element, nodes: [] }, "Rovná 235");
    expect(c?.toString()).toBe("Rovná 235");
  });
});
