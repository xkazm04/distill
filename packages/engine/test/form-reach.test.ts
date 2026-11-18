import { describe, expect, it } from "vitest";
import { extractForm, readValues, writeValues } from "../src/index.js";
import { live, parse } from "./helpers.js";

const URL_ = "https://forms.example/f";

/** Gives `host` an open (or closed) shadow root holding a labelled input, as design-system components do. */
function shadowField(doc: Document, hostId: string, label: string, mode: "open" | "closed" = "open"): HTMLInputElement {
  const host = doc.getElementById(hostId) as HTMLElement;
  const root = host.attachShadow({ mode });
  root.innerHTML = `<div><label for="${hostId}-in">${label} *</label><input id="${hostId}-in" name="${hostId}" required></div>`;
  return root.querySelector("input") as HTMLInputElement;
}

describe("fields in open shadow roots", () => {
  it("are found, labelled by the label in their own shadow tree, written and read", async () => {
    const { doc, close } = await live(`<form><x-field id="jmeno"></x-field><x-field id="email"></x-field>
      <label for="tel">Telefon</label><input id="tel"></form>`);
    const jmeno = shadowField(doc, "jmeno", "Jméno");
    shadowField(doc, "email", "E-mail");
    const s = await extractForm(doc, URL_);
    expect(s.fields.map((f) => [f.fieldId, f.label, f.required])).toEqual([
      ["jmeno-in", "Jméno", true], ["email-in", "E-mail", true], ["tel", "Telefon", false],
    ]);
    const seen: string[] = [];
    doc.addEventListener("input", (e) => seen.push((e.composedPath()[0] as Element).id));
    expect(writeValues(doc, s, { "jmeno-in": "Olena", tel: "777" }).written).toEqual(["jmeno-in", "tel"]);
    expect(jmeno.value).toBe("Olena");
    expect(seen).toContain("jmeno-in"); // the input event left the shadow root, as a real one does
    expect(readValues(doc, s)).toEqual({ "jmeno-in": "Olena", tel: "777" });
    await close();
  });

  it("resolves aria-labelledby inside the shadow tree, not in the document", async () => {
    const { doc, close } = await live(`<form><span id="n">Wrong (document)</span><x-a id="a"></x-a><label for="b">B</label><input id="b"></form>`);
    const root = (doc.getElementById("a") as HTMLElement).attachShadow({ mode: "open" });
    root.innerHTML = `<span id="n">Příjmení</span><input id="p" aria-labelledby="n">`;
    const s = await extractForm(doc, URL_);
    expect(s.fields[0]).toMatchObject({ fieldId: "p", label: "Příjmení" });
    await close();
  });

  it("a closed shadow root is not entered", async () => {
    const { doc, close } = await live(`<form><x-field id="skryte"></x-field><label for="a">A</label><input id="a"><label for="b">B</label><input id="b"></form>`);
    shadowField(doc, "skryte", "Tajné", "closed");
    const s = await extractForm(doc, URL_);
    expect(s.fields.map((f) => f.fieldId)).toEqual(["a", "b"]);
    await close();
  });
});

const FRAME_FORM = (id: string, label: string) =>
  `<form><p><label for='${id}'>${label}</label> <input id='${id}' name='${id}'></p><p><label for='pocet'>Počet</label> <input id='pocet' type='number'></p></form>`;

describe("forms in same-origin frames", () => {
  it("are listed after the top document's forms and written in their own frame", async () => {
    const { doc, close } = await live(`<main><p>Úvod</p><iframe id="f" srcdoc="${FRAME_FORM("drzitel", "Držitel")}"></iframe></main>`);
    const frame = (doc.getElementById("f") as HTMLIFrameElement).contentDocument as Document;
    const s = await extractForm(doc, URL_);
    expect(s.fields.map((f) => [f.fieldId, f.label])).toEqual([["drzitel", "Držitel"], ["pocet", "Počet"]]);
    expect(writeValues(doc, s, { drzitel: "Olena", pocet: "2" }).written).toEqual(["drzitel", "pocet"]);
    expect((frame.getElementById("drzitel") as HTMLInputElement).value).toBe("Olena");
    expect(readValues(doc, s)).toEqual({ drzitel: "Olena", pocet: "2" });
    await close();
  });

  it("keeps field ids unique across frames, so a write lands in the frame it was read from", async () => {
    const { doc, close } = await live(`<form><label for="pocet">Počet (top)</label><input id="pocet"><label for="x">X</label><input id="x"></form>
      <iframe id="f" srcdoc="${FRAME_FORM("drzitel", "Držitel")}"></iframe>`);
    const frame = (doc.getElementById("f") as HTMLIFrameElement).contentDocument as Document;
    const top = await extractForm(doc, URL_, 0);
    const inner = await extractForm(doc, URL_, 1);
    expect(top.fields.map((f) => f.fieldId)).toEqual(["pocet", "x"]);
    expect(inner.fields.map((f) => f.fieldId)).toEqual(["drzitel", "pocet_2"]);
    expect(writeValues(doc, inner, { pocet_2: "3" }).written).toEqual(["pocet_2"]);
    expect((frame.getElementById("pocet") as HTMLInputElement).value).toBe("3");
    expect((doc.getElementById("pocet") as HTMLInputElement).value).toBe("");
    await close();
  });

  it("skips a cross-origin frame without throwing, whether reading it is null or refused", async () => {
    const { doc, close } = await live(`<form><label for="a">A</label><input id="a"><label for="b">B</label><input id="b"></form>
      <iframe id="n"></iframe><iframe id="t"></iframe>`);
    Object.defineProperty(doc.getElementById("n"), "contentDocument", { get: () => null });
    Object.defineProperty(doc.getElementById("t"), "contentDocument", { get: () => { throw new Error("SecurityError: Blocked a frame with origin"); } });
    const s = await extractForm(doc, URL_);
    expect(s.fields.map((f) => f.fieldId)).toEqual(["a", "b"]);
    expect(writeValues(doc, s, { a: "1" }).written).toEqual(["a"]);
    expect((await extractForm(doc, URL_, 1)).fields).toEqual([]);
    await close();
  });

  it("skips a hidden frame", async () => {
    const { doc, close } = await live(`<iframe hidden srcdoc="${FRAME_FORM("drzitel", "Držitel")}"></iframe>`);
    expect((await extractForm(doc, URL_)).fields).toEqual([]);
    await close();
  });
});

describe("labels the old lookup missed", () => {
  it("reads the previous table cell for an input wrapped three levels deep, but not a neighbouring field's cell", async () => {
    const s = await extractForm(parse(`<form><table>
      <tr><td>Telefon *</td><td><div><span><span><input id="tel"></span></span></div></td></tr>
      <tr><td><span>Ulice</span><div><span><input id="ulice"></span></div><div><span><span><input id="cp"></span></span></div></td></tr>
    </table></form>`), URL_);
    expect(s.fields.map((f) => [f.fieldId, f.label])).toEqual([["tel", "Telefon"], ["ulice", "Ulice"], ["cp", ""]]);
  });

  it("names a field by aria-labelledby even when the named element is hidden", async () => {
    const s = await extractForm(parse(`<form><span id="l" hidden>Číslo bytu</span><input id="byt" aria-labelledby="l" placeholder="např. 12">
      <label for="o">Obec</label><input id="o"></form>`), URL_);
    expect(s.fields[0]).toMatchObject({ fieldId: "byt", label: "Číslo bytu", placeholder: "např. 12" });
  });
});
