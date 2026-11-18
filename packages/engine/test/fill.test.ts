import { describe, expect, it } from "vitest";
import { extractForm, readValues, writeValues } from "../src/index.js";
import { live, parse } from "./helpers.js";

const URL_ = "https://forms.example/f";
const $ = <T extends Element = HTMLInputElement>(doc: Document, sel: string): T => doc.querySelector(sel) as unknown as T;

describe("writeValues reports written only what the page holds afterwards", () => {
  it("accepts a mask that lays the same characters out its own way", async () => {
    const { doc, close } = await live(`<form><label for="psc">PSC</label><input id="psc"><label for="x">X</label><input id="x"></form>`);
    const psc = $(doc, "#psc");
    psc.addEventListener("input", () => {
      const d = psc.value.replace(/\D/g, "").slice(0, 5);
      psc.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
    });
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { psc: "12000" })).toEqual({ written: ["psc"], failed: [] });
    expect(psc.value).toBe("120 00");
    await close();
  });

  it("fails a field the page will not take, and puts back what it held", async () => {
    const { doc, close } = await live(`<form><label for="a">A</label><input id="a" value="kept"><label for="b">B</label><input id="b"></form>`);
    const a = $(doc, "#a");
    const b = $(doc, "#b");
    a.addEventListener("input", () => { a.value = a.value.slice(0, 3); }); // truncates: a different value
    b.addEventListener("input", () => { b.value = ""; }); // refuses everything
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { a: "Kovalenko", b: "Olena" })).toEqual({ written: [], failed: ["a", "b"] });
    expect(a.value).toBe("kep"); // the old value put back, through the page's own mask
    expect(b.value).toBe("");
    await close();
  });

  it("types key by key into a mask that takes keystrokes only, past its fixed +420 prefix", async () => {
    const { doc, close } = await live(`<form><label for="tel">Telefon</label><input id="tel" type="tel" value="+420 "><label for="j">J</label><input id="j"></form>`);
    const tel = $(doc, "#tel");
    let digits = "";
    const render = () => { tel.value = `+420 ${digits.replace(/(\d{3})(?=\d)/g, "$1 ")}`; };
    tel.addEventListener("keydown", (e) => {
      const k = (e as KeyboardEvent).key;
      if (/^\d$/.test(k)) { if (digits.length < 9) digits += k; e.preventDefault(); render(); }
      else if (k === "Backspace") { digits = digits.slice(0, -1); e.preventDefault(); render(); }
      else if (k.length === 1) e.preventDefault();
    });
    tel.addEventListener("input", render);
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { tel: "777 123 456" }).written).toEqual(["tel"]);
    expect(tel.value).toBe("+420 777 123 456");
    digits = "";
    render();
    expect(writeValues(doc, s, { tel: "+420 601 998 877" }).written).toEqual(["tel"]);
    expect(tel.value).toBe("+420 601 998 877");
    // Letters never get in: the write fails and the field is as it was.
    expect(writeValues(doc, s, { tel: "call me" }).failed).toEqual(["tel"]);
    expect(tel.value).toBe("+420 601 998 877");
    await close();
  });

  it("an empty answer clears the field, and a mask's own prefix left behind is still empty", async () => {
    const { doc, close } = await live(`<form><label for="t">T</label><input id="t" value="+420 "><label for="u">U</label><input id="u" value="x"></form>`);
    const t = $(doc, "#t");
    t.addEventListener("input", () => { if (!t.value.startsWith("+420 ")) t.value = "+420 "; });
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { t: "", u: "" })).toEqual({ written: ["t", "u"], failed: [] });
    await close();
  });

  it("ticks checkboxes and radios with a real click, so a framework that listens to clicks hears it", async () => {
    const { doc, close } = await live(`<form>
      <fieldset><legend>Výplata</legend>
        <label><input type="radio" name="v" value="ucet"> Účet</label><label><input type="radio" name="v" value="posta"> Pošta</label></fieldset>
      <label><input type="checkbox" id="ok" name="ok"> Souhlas</label></form>`);
    const state: Record<string, string> = {};
    doc.querySelector("form")!.addEventListener("click", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.type === "radio" || el.type === "checkbox") state[el.name] = el.type === "radio" ? el.value : String(el.checked);
    });
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { v: "Účet", ok: "true" }).failed).toEqual([]);
    expect(state).toEqual({ v: "ucet", ok: "true" });
    expect(writeValues(doc, s, { ok: "false" }).written).toEqual(["ok"]);
    expect(state.ok).toBe("false");
    await close();
  });

  it("fails a tick that a framework undoes", async () => {
    const { doc, close } = await live(`<form><label><input type="checkbox" id="ok"> Souhlas</label><label for="j">J</label><input id="j"></form>`);
    const ok = $(doc, "#ok");
    ok.addEventListener("click", () => { ok.checked = false; }); // re-rendered from a state that did not change
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { ok: "true" })).toEqual({ written: [], failed: ["ok"] });
    await close();
  });

  it("an empty answer on an unanswered radio group is not a failure; a radio cannot be unchosen", async () => {
    const doc = parse(`<form><p>Stav</p><label><input type="radio" name="s" value="a"> A</label><label><input type="radio" name="s" value="b"> B</label></form>`);
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { s: "" }).written).toEqual(["s"]);
    writeValues(doc, s, { s: "a" });
    expect(writeValues(doc, s, { s: "" }).failed).toEqual(["s"]);
  });
});

describe("comboboxes: typing is not choosing", () => {
  const AUTOCOMPLETE = `<form>
    <label for="q">Občanství</label>
    <input id="q" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="q-list">
    <ul id="q-list" role="listbox" hidden>
      <li role="option" data-value="UA">Ukrajina</li><li role="option" data-value="VN">Vietnam</li>
    </ul>
    <input type="hidden" name="obcanstvi" value="">
    <label for="j">Jméno</label><input id="j">
  </form>`;

  async function autocomplete(chooses: boolean) {
    const page = await live(AUTOCOMPLETE);
    const { doc } = page;
    const q = $(doc, "#q");
    const list = $<HTMLElement>(doc, "#q-list");
    const hidden = $(doc, "input[name=obcanstvi]");
    q.addEventListener("input", () => {
      hidden.value = "";
      list.hidden = false;
      q.setAttribute("aria-expanded", "true");
      list.querySelectorAll("[role=option]").forEach((o) => { (o as HTMLElement).hidden = !(o.textContent ?? "").toLowerCase().startsWith(q.value.toLowerCase()); });
    });
    if (chooses) {
      list.addEventListener("click", (e) => {
        const o = (e.target as Element).closest("[role=option]");
        if (!o) return;
        q.value = o.textContent ?? "";
        hidden.value = o.getAttribute("data-value") ?? "";
        list.hidden = true;
        q.setAttribute("aria-expanded", "false");
      });
    }
    return { ...page, q, hidden };
  }

  it("is one select field with the list's options, read while the box is empty", async () => {
    const { doc, close } = await autocomplete(true);
    const s = await extractForm(doc, URL_);
    expect(s.fields.map((f) => [f.fieldId, f.kind, f.label])).toEqual([["q", "select", "Občanství"], ["j", "text", "Jméno"]]);
    expect(s.fields[0]?.options).toEqual([{ value: "UA", label: "Ukrajina" }, { value: "VN", label: "Vietnam" }]);
    await close();
  });

  it("types, chooses the matching option, and confirms the choice", async () => {
    const { doc, close, q, hidden } = await autocomplete(true);
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { q: "UA" }).written).toEqual(["q"]);
    expect([q.value, hidden.value]).toEqual(["Ukrajina", "UA"]);
    expect(readValues(doc, s).q).toBe("UA");
    await close();
  });

  it("fails when the click on the option does not choose it, and leaves the box as it was", async () => {
    const { doc, close, q, hidden } = await autocomplete(false);
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { q: "Ukrajina" })).toEqual({ written: [], failed: ["q"] });
    expect([q.value, hidden.value]).toEqual(["", ""]);
    await close();
  });

  it("fails an answer that is not one of the options", async () => {
    const { doc, close, q } = await autocomplete(true);
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { q: "Atlantis" }).failed).toEqual(["q"]);
    expect(q.value).toBe("");
    await close();
  });

  it("a select-only combobox built from a div: opens, clicks the option, confirms what it shows", async () => {
    const { doc, close } = await live(`<form>
      <span id="pl">Pracoviště</span>
      <div id="cb" role="combobox" aria-expanded="false" aria-controls="cb-list" aria-labelledby="pl" aria-required="true">Vyberte</div>
      <ul id="cb-list" role="listbox" hidden><li role="option" data-value="PHA">Praha</li><li role="option" data-value="BRN">Brno</li></ul>
      <label for="j">Jméno</label><input id="j"></form>`);
    const cb = $<HTMLElement>(doc, "#cb");
    const list = $<HTMLElement>(doc, "#cb-list");
    cb.addEventListener("click", () => { list.hidden = !list.hidden; cb.setAttribute("aria-expanded", String(!list.hidden)); });
    list.addEventListener("click", (e) => {
      const o = (e.target as Element).closest("[role=option]")!;
      list.querySelectorAll("[role=option]").forEach((x) => x.setAttribute("aria-selected", String(x === o)));
      cb.textContent = o.textContent;
      list.hidden = true;
      cb.setAttribute("aria-expanded", "false");
    });
    const s = await extractForm(doc, URL_);
    expect(s.fields[0]).toMatchObject({ fieldId: "cb", kind: "select", label: "Pracoviště", required: true, options: [{ value: "PHA", label: "Praha" }, { value: "BRN", label: "Brno" }] });
    expect(JSON.stringify(s)).not.toContain("Vyberte"); // what the box shows is not its label
    expect(writeValues(doc, s, { cb: "Brno" }).written).toEqual(["cb"]);
    expect(cb.textContent).toBe("Brno");
    expect(readValues(doc, s).cb).toBe("BRN");
    expect(writeValues(doc, s, { cb: "Ostrava" }).failed).toEqual(["cb"]);
    expect(cb.getAttribute("aria-expanded")).toBe("false"); // closed again after looking
    await close();
  });
});

describe("ARIA choices that are not inputs", () => {
  const PAGE = `<form>
    <label for="n">Jméno</label><input id="n">
    <p id="dl">Druh</p>
    <div role="radiogroup" id="druh" aria-labelledby="dl" aria-required="true">
      <div role="radio" id="r1" data-value="volna" aria-checked="false">Volná</div>
      <div role="radio" id="r2" data-value="vazana" aria-checked="false">Vázaná</div>
    </div>
    <p id="ol">Obory</p>
    <div role="group" id="obory" aria-labelledby="ol">
      <div role="checkbox" id="c1" aria-checked="false">IT</div>
      <div role="checkbox" id="c2" aria-checked="false">Překlady</div>
    </div>
    <span id="sl">Upozornění</span><button type="button" role="switch" id="sw" aria-checked="false" aria-labelledby="sl"></button>
    <div role="checkbox" id="dead" aria-checked="false">Nefunkční</div>
    <div role="checkbox" id="off" aria-checked="false" aria-disabled="true">Vypnuto</div>
  </form>`;

  async function page() {
    const p = await live(PAGE);
    p.doc.querySelectorAll("[role=radio]").forEach((r) => r.addEventListener("click", () => {
      p.doc.querySelectorAll("[role=radio]").forEach((o) => o.setAttribute("aria-checked", String(o === r)));
    }));
    p.doc.querySelectorAll("#obory [role=checkbox], [role=switch]").forEach((c) => c.addEventListener("click", () => {
      c.setAttribute("aria-checked", String(c.getAttribute("aria-checked") !== "true"));
    }));
    return p;
  }

  it("finds them, named and shaped like the native ones; a disabled one is left out", async () => {
    const { doc, close } = await page();
    const s = await extractForm(doc, URL_);
    expect(s.fields.map((f) => [f.fieldId, f.kind, f.label, f.required, f.options?.length ?? 0])).toEqual([
      ["n", "text", "Jméno", false, 0],
      ["druh", "radio", "Druh", true, 2],
      ["obory", "checkbox", "Obory", false, 2],
      ["sw", "checkbox", "Upozornění", false, 0],
      ["dead", "checkbox", "Nefunkční", false, 0],
    ]);
    expect(s.fields[1]?.options).toEqual([{ value: "volna", label: "Volná" }, { value: "vazana", label: "Vázaná" }]);
    await close();
  });

  it("clicks them and confirms through aria-checked; reads them back", async () => {
    const { doc, close } = await page();
    const s = await extractForm(doc, URL_);
    const res = writeValues(doc, s, { druh: "Vázaná", obory: "IT, Překlady", sw: "true", dead: "true" });
    expect(res).toEqual({ written: ["druh", "obory", "sw"], failed: ["dead"] }); // "dead" ignores clicks
    expect(readValues(doc, s)).toEqual({ druh: "vazana", obory: "IT,Překlady", sw: "true", dead: "false" });
    await close();
  });
});

describe("dates split into day, month and year", () => {
  const PAGE = `<form>
    <div class="row"><label for="d">Datum narození *</label>
      <input id="d" name="d_den" maxlength="2" placeholder="DD" aria-label="Den" required> .
      <input id="m" name="d_mesic" maxlength="2" placeholder="MM" aria-label="Měsíc" required> .
      <input id="y" name="d_rok" maxlength="4" placeholder="RRRR" aria-label="Rok" required></div>
    <fieldset><legend>Cestovní doklad</legend><fieldset><legend>Platnost do</legend>
      <label for="pd" class="sr-only">Day</label><input id="pd" name="exp_day">
      <label for="pm" class="sr-only">Month</label><select id="pm" name="exp_month"><option value="">-</option>
        ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => `<option value="${m}">${i + 1}</option>`).join("")}</select>
      <label for="py" class="sr-only">Year</label><input id="py" name="exp_year" maxlength="4"></fieldset></fieldset>
    <div><label for="ulice">Ulice</label><input id="ulice"><label for="mesto">Město</label><input id="mesto"><label for="psc">PSČ</label><input id="psc"></div>
  </form>`;

  it("makes each date one field of kind date, named by its label or legend, and leaves other trios alone", async () => {
    const s = await extractForm(parse(PAGE), URL_);
    expect(s.fields.map((f) => [f.fieldId, f.kind, f.label, f.required])).toEqual([
      ["d", "date", "Datum narození", true],
      ["pd", "date", "Platnost do", false],
      ["ulice", "text", "Ulice", false],
      ["mesto", "text", "Město", false],
      ["psc", "text", "PSČ", false],
    ]);
    expect(s.fields[1]?.section).toBe("Cestovní doklad"); // the inner legend is the label, not also the section
  });

  it("writes each piece from one date and reads them back as YYYY-MM-DD", async () => {
    const doc = parse(PAGE);
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { d: "5.3.1990", pd: "2030-12-31" })).toEqual({ written: ["d", "pd"], failed: [] });
    expect(["#d", "#m", "#y", "#pd", "#pm", "#py"].map((q) => $(doc, q).value)).toEqual(["05", "03", "1990", "31", "Dec", "2030"]);
    expect(readValues(doc, s)).toMatchObject({ d: "1990-03-05", pd: "2030-12-31" });
  });

  it("fails a value that is not a date, and a piece the page refuses, leaving every piece as it was", async () => {
    const { doc, close } = await live(PAGE);
    const s = await extractForm(doc, URL_);
    expect(writeValues(doc, s, { d: "tomorrow" }).failed).toEqual(["d"]);
    const y = $(doc, "#y");
    y.addEventListener("input", () => { y.value = ""; });
    expect(writeValues(doc, s, { d: "05.03.1990" }).failed).toEqual(["d"]);
    expect(["#d", "#m", "#y"].map((q) => $(doc, q).value)).toEqual(["", "", ""]);
    await close();
  });
});
