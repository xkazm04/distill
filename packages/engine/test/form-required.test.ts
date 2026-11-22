// "Required" read the way pages write it (round-1 gap G13): beyond the required and aria-required attributes, a
// required class, the word in the label and a lone star. The markup of the two live village forms is copied from them.
import { describe, expect, it } from "vitest";
import { extractForm } from "../src/index.js";
import { parse } from "./helpers.js";

const requiredOf = async (html: string): Promise<Record<string, boolean>> => {
  const s = await extractForm(parse(`<!doctype html><html lang="cs"><body>${html}</body></html>`), "https://obec.example/formular");
  return Object.fromEntries(s.fields.map((f) => [f.fieldId, f.required]));
};

describe("extractForm: required as pages write it", () => {
  it("still reads the required and aria-required attributes", async () => {
    expect(await requiredOf(`<form>
      <label for="a">Jméno</label><input id="a" required>
      <label for="b">Příjmení</label><input id="b" aria-required="true">
      <label for="c">Telefon</label><input id="c">
    </form>`)).toEqual({ a: true, b: true, c: false });
  });

  it("reads a required class on the field (Štáhlavy, live 2026-11-22)", async () => {
    expect(await requiredOf(`<form id="send_form"><table>
      <tr><td class="label"></td><td><span class="pozn">Pro nahlášení závady vyplňte prosím níže uvedený formulář. Údaje označené hvězdičkou jsou povinné.</span></td></tr>
      <tr><td class="label"><label for="form_15" title="Datum">Datum</label></td><td><input type="text" name="form[15]" id="form_15" class="date"></td></tr>
      <tr><td class="label"><label for="form_17" title="Název závady">Název závady</label></td><td><input id="form_17" name="form[17]" type="text" class="text required" value=""></td></tr>
      <tr><td class="label"><label for="form_18" title="Popis závady">Popis závady</label></td><td><textarea id="form_18" name="form[18]" class="required"></textarea></td></tr>
      <tr><td class="label"><label for="form_76" title="Adresa">Adresa</label></td><td><input id="form_76" name="form[76]" type="text" class="text " value=""></td></tr>
      <tr><td class="label"><label for="form_75" title="Tel.">Tel.</label></td><td><input id="form_75" name="form[75]" type="tel" class="telefon required" value=""></td></tr>
    </table></form>`)).toEqual({ form_15: false, form_17: true, form_18: true, form_76: false, form_75: true });
  });

  it("reads a required class on the label and the word at its end (Přáslavice, live 2026-11-22)", async () => {
    const r = await requiredOf(`<form id="frm-form"><div class="form-vertical"><fieldset><legend>Informace o závadě nebo škodě</legend>
      <div class="form-item"><div class="form-item-label"><label for="frmform-input0">Datum</label></div><div class="form-item-field"><input type="text" name="input0" id="frmform-input0" value=""></div></div>
      <div class="form-item"><div class="form-item-label"><label class="required" for="frmform-input1">Typ hlášení<span class="meta"> - povinné</span></label></div><div class="form-item-field"><select name="input1" id="frmform-input1"><option value="0">Černá skládka</option><option value="1">Jiné</option></select></div></div>
      <div class="form-item"><div class="form-item-label"><label for="frmform-input3">Místo nepořádku</label></div><div class="form-item-field"><textarea name="input3" id="frmform-input3"></textarea></div></div>
    </fieldset></div></form>`);
    expect(r).toEqual({ "frmform-input0": false, "frmform-input1": true, "frmform-input3": false });
  });

  it("reads the word alone, without a class, in Czech, English and German", async () => {
    expect(await requiredOf(`<form>
      <label for="a">Typ hlášení - povinné</label><input id="a">
      <label for="b">E-mail (required)</label><input id="b">
      <label for="c">Name (Pflichtfeld)</label><input id="c">
      <label for="d">Ulice, povinný údaj</label><input id="d">
    </form>`)).toEqual({ a: true, b: true, c: true, d: true });
  });

  it("reads a lone star in the label, a wrapping label, a legend or a placeholder that stands for the label", async () => {
    const r = await requiredOf(`<form>
      <label for="jmeno">Jméno a příjmení *</label><input id="jmeno">
      <label for="email">E-mail*:</label><input id="email" type="email">
      <label for="obec"><span class="req">*</span> Obec</label><input id="obec">
      <label for="psc">PSČ (*)</label><input id="psc">
      <input id="ulice" placeholder="Ulice *">
      <fieldset><legend>Pohlaví *</legend><label><input type="radio" name="pohlavi" value="z"> žena</label><label><input type="radio" name="pohlavi" value="m"> muž</label></fieldset>
      <label><input id="souhlas" type="checkbox"> Souhlasím se zpracováním osobních údajů *</label>
      <label for="tel">Telefon</label><input id="tel" type="tel">
    </form>`);
    expect(r).toEqual({ jmeno: true, email: true, obec: true, psc: true, ulice: true, pohlavi: true, souhlas: true, tel: false });
  });

  it("reads a required class on a box that holds only this field, never on a box of several", async () => {
    expect(await requiredOf(`<form>
      <div class="form-group required"><label for="a">Jméno</label><div><input id="a"></div></div>
      <div class="required"><label for="b">Město</label><input id="b"><label for="c">Okres</label><input id="c"></div>
    </form>`)).toEqual({ a: true, b: false, c: false });
  });

  it("does not take a rating's stars for the mark", async () => {
    expect(await requiredOf(`<form>
      <label for="hodnoceni">Hodnocení ***</label><select id="hodnoceni"><option>1</option><option>2</option></select>
      <label for="hotel">Hotel 4*</label><input id="hotel">
      <fieldset><legend>Jak jste byli spokojeni?</legend>
        <label><input type="radio" name="hvezdy" value="1"> *</label><label><input type="radio" name="hvezdy" value="2"> **</label><label><input type="radio" name="hvezdy" value="3"> ***</label>
      </fieldset>
      <label for="pozn">Poznámka</label><textarea id="pozn"></textarea>
    </form>`)).toEqual({ hodnoceni: false, hotel: false, hvezdy: false, pozn: false });
  });

  it("does not take the word in a help text, in a sentence or said the other way round", async () => {
    expect(await requiredOf(`<form>
      <p>Povinné údaje jsou označeny hvězdičkou.</p>
      <label for="tel">Telefon</label><input id="tel" aria-describedby="tel-help"><small id="tel-help">Vyplnění není povinné, ale urychlí odpověď.</small>
      <label for="fax">Fax</label><input id="fax"><small>Toto pole je povinné jen pro firmy.</small>
      <label for="web">Web (nepovinné)</label><input id="web">
      <label for="firma">Firma (není povinné)</label><input id="firma">
      <label for="ref">Reference (not required)</label><input id="ref">
      <label for="poznamka">Required documents you may attach later</label><input id="poznamka">
      <label for="x" class="not-required">Poznámka</label><input id="x">
    </form>`)).toEqual({ tel: false, fax: false, web: false, firma: false, ref: false, poznamka: false, x: false });
  });

  it("keeps the label as before: the star and the word stay part of what the reader reports, as round 1 had them", async () => {
    const s = await extractForm(parse(`<form><label for="a">Jméno *</label><input id="a"><label class="required" for="b">Typ<span> - povinné</span></label><input id="b"><label for="c">Obec</label><input id="c"></form>`), "https://obec.example/f");
    expect(s.fields.map((f) => f.label)).toEqual(["Jméno", "Typ - povinné", "Obec"]);
  });
});
