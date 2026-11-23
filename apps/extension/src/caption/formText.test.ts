// A form in your language (r4-04), the page side: which of a form's words are read (never a value, never an error),
// how translations go in, and that every word, attribute and value comes back exactly (Keep <language>, Original,
// close); the form submits the same data before and after.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyFormErrors, applyFormText, clearFormText, formErrors, formOriginal, formScopes, formSource, formText, FORM_TRANSLATED, FORM_VALUE, resetFormText } from "./formText";

const TYPED = "Zqxvlenka Wbrtnovsky";
const TYPED_MAIL = "zqx@4711";

const PAGE = `
<header><form id="search" role="search"><input name="q" placeholder="Hledat"><input name="x" placeholder="Hledat znovu"><button>Hledat</button></form></header>
<main>
  <h1>Hlášení závad</h1>
  <form id="f" action="/send" method="post">
    <fieldset><legend>Kdo hlásí</legend>
      <label for="jmeno">Jméno a <b>příjmení</b> <span class="req">*</span></label>
      <input id="jmeno" name="jmeno" placeholder="Jan Novák" aria-label="Vaše jméno">
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" aria-invalid="true" aria-describedby="email-err email-hint">
      <small id="email-hint">Na tento e-mail odpovíme</small>
      <span id="email-err" class="field-error">Adresa ${TYPED_MAIL} není platná</span>
    </fieldset>
    <table><tr><td>Druh závady</td><td>
      <select id="druh" name="druh">
        <option value="">-- vyberte --</option>
        <option value="svetlo">Nesvítí lampa</option>
        <optgroup label="Silnice"><option>Díra v silnici</option></optgroup>
      </select></td></tr></table>
    <label><input type="checkbox" name="souhlas" value="ano"> Souhlasím se zpracováním</label>
    <textarea name="popis" placeholder="Popište závadu">Moje vlastní slova</textarea>
    <div role="alert">Formulář obsahuje chyby</div>
    <output name="spocitano">Napočítáno 3</output>
    <p translate="no">Obec Lhota</p>
    <input type="submit" value="Odeslat">
    <input type="submit" name="akce" value="Uložit koncept">
    <button type="reset">Vymazat</button>
  </form>
</main>
<footer><form id="news"><input name="a" placeholder="Váš e-mail"><input name="b" placeholder="Jméno"></form></footer>`;

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const submitted = () => Array.from(new FormData($<HTMLFormElement>("#f")).entries()).map(([k, v]) => `${k}=${String(v)}`);
const en = (blocks: { id: string; text: string }[]) => blocks.map((b) => ({ id: b.id, text: `[EN] ${b.text}` }));

beforeEach(() => {
  document.documentElement.setAttribute("lang", "cs");
  document.body.innerHTML = PAGE;
  $<HTMLInputElement>("#jmeno").value = TYPED;
  $<HTMLInputElement>("#email").value = TYPED_MAIL;
  $<HTMLSelectElement>("#druh").selectedIndex = 2; // "Díra v silnici": no value attribute, it submits its text
  $<HTMLInputElement>("[name=souhlas]").checked = true;
});
afterEach(() => resetFormText());

describe("formScopes", () => {
  it("the main area's form only: not the header search, not the footer's newsletter box", () => {
    expect(formScopes(document).map((f) => f.id)).toEqual(["f"]);
  });
  it("a form with fewer than two fields to fill is not translated", () => {
    document.body.innerHTML = `<main><form id="one"><label>Hledat <input name="q"></label><button>Najít</button></form></main>`;
    expect(formScopes(document)).toEqual([]);
  });
});

describe("formText", () => {
  it("labels, legends, cells, hints, options, optgroup labels, placeholders, aria-labels and unsent buttons", () => {
    const texts = formText(document).map((b) => b.text);
    for (const want of ["Kdo hlásí", "Jméno a příjmení *", "E-mail", "Druh závady", "-- vyberte --", "Nesvítí lampa", "Díra v silnici",
      "Silnice", "Souhlasím se zpracováním", "Jan Novák", "Vaše jméno", "Popište závadu", "Odeslat", "Vymazat", "Na tento e-mail odpovíme"]) {
      expect(texts).toContain(want);
    }
  });

  it("never a typed value, a textarea's words, an error, a live region, an output, a value sent with the form or a no-translate part", () => {
    const all = JSON.stringify(formText(document));
    for (const never of [TYPED, TYPED_MAIL, "Moje vlastní slova", "není platná",
      "Formulář obsahuje chyby", "Napočítáno", "Obec Lhota", "svetlo", "Hledat", "Váš e-mail"]) {
      expect(all).not.toContain(never);
    }
  });

  it("what an invalid field's aria-describedby names is an error when nothing it names looks like one and it is not help text", () => {
    document.body.innerHTML = `<main><form><label for="a">Ulice</label><input id="a" name="a" aria-invalid="true" aria-describedby="m">
      <span id="m">Ulice ${TYPED} neexistuje</span><label for="b">Obec</label><input id="b" name="b"></form></main>`;
    expect(JSON.stringify(formText(document))).not.toContain(TYPED);
    expect(formErrors(document).map((e) => e.text)).toEqual([`Ulice ${TYPED} neexistuje`]);
  });

  it("ids are f0...; a second reading hands over only what is new", () => {
    const first = formText(document);
    expect(first.every((b) => /^f\d+$/.test(b.id))).toBe(true);
    expect(formText(document)).toEqual([]);
    $("#f fieldset").insertAdjacentHTML("beforeend", `<label for="tel">Telefon</label><input id="tel" name="tel">`);
    expect(formText(document).map((b) => b.text)).toEqual(["Telefon"]);
  });
});

describe("applyFormText, Keep <language>, Original and close", () => {
  it("swaps text and attributes in place, keeps values and the submitted data, and brings every byte back", () => {
    const html = document.body.innerHTML;
    const before = submitted();
    expect(before).toContain("druh=Díra v silnici");
    const blocks = formText(document);
    expect(applyFormText(document, en(blocks))).toBe(blocks.length);

    expect($("legend").textContent).toBe("[EN] Kdo hlásí");
    expect($("label[for=jmeno]").textContent).toContain("[EN]");
    expect($("label[for=jmeno] b")).not.toBeNull(); // the bold survives with words of its own
    expect($("#jmeno").getAttribute("placeholder")).toBe("[EN] Jan Novák");
    expect($("#jmeno").getAttribute("aria-label")).toBe("[EN] Vaše jméno");
    expect($("optgroup").getAttribute("label")).toBe("[EN] Silnice");
    expect($("input[type=submit]:not([name])").getAttribute("value")).toBe("[EN] Odeslat");
    expect($("input[name=akce]").getAttribute("value")).toBe("[EN] Uložit koncept");
    expect($("#email-err").textContent).toContain("není platná");
    expect($("legend").getAttribute("lang")).toBe("en");
    expect($("legend").hasAttribute(FORM_TRANSLATED)).toBe(true);
    // The option without a value attribute shows its translation and still submits its own text.
    const hole = $<HTMLOptionElement>("optgroup option");
    expect(hole.text).toBe("[EN] Díra v silnici");
    expect(hole.getAttribute("value")).toBe("Díra v silnici");
    expect(hole.hasAttribute(FORM_VALUE)).toBe(true);
    expect($<HTMLOptionElement>("option[value=svetlo]").value).toBe("svetlo");
    // What the person typed and chose is exactly as it was; the form sends the same data.
    expect($<HTMLInputElement>("#jmeno").value).toBe(TYPED);
    expect($<HTMLTextAreaElement>("textarea").value).toBe("Moje vlastní slova");
    expect(submitted()).toEqual(before);

    formSource(document, true);
    expect(document.body.innerHTML).toBe(html);
    expect(submitted()).toEqual(before);
    formSource(document, false);
    expect($("legend").textContent).toBe("[EN] Kdo hlásí");
    formOriginal(true);
    expect(document.body.innerHTML).toBe(html);
    formOriginal(false);
    expect(hole.getAttribute("value")).toBe("Díra v silnici");
    expect(submitted()).toEqual(before);
    clearFormText();
    expect(document.body.innerHTML).toBe(html);
    expect($<HTMLInputElement>("#jmeno").value).toBe(TYPED);
    expect(submitted()).toEqual(before);
  });

  it("an error id is never put in by the form words' answer, and a node the page changed is left as the page made it", () => {
    const blocks = formText(document);
    const legend = blocks.find((b) => b.text === "Kdo hlásí");
    $("legend").textContent = "Kdo to hlásí";
    expect(applyFormText(document, en(legend ? [legend] : []))).toBe(0);
    expect($("legend").textContent).toBe("Kdo to hlásí");
    const errs = formErrors(document);
    expect(applyFormText(document, en(errs))).toBe(0);
  });
});

describe("a named submit input", () => {
  it("shows its translation, and sends its own value: put back while the form is sent, shown again after", async () => {
    const form = $<HTMLFormElement>("#f");
    const button = $<HTMLInputElement>("input[name=akce]");
    const sentWith = () => Array.from(new FormData(form, button).entries()).map(([k, v]) => `${k}=${String(v)}`);
    const before = sentWith();
    expect(before).toContain("akce=Uložit koncept");
    applyFormText(document, en(formText(document)));
    expect(button.value).toBe("[EN] Uložit koncept");
    let during: string[] = [];
    form.addEventListener("submit", (e) => { e.preventDefault(); during = sentWith(); });
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(during).toEqual(before);
    await new Promise((r) => setTimeout(r, 5));
    expect(button.value).toBe("[EN] Uložit koncept");
    clearFormText();
    expect(button.value).toBe("Uložit koncept");
  });
});

describe("formErrors (values: on-device translation only)", () => {
  it("reads the shown error messages as e0..., puts their translation in and takes it back", () => {
    const html = document.body.innerHTML;
    const errs = formErrors(document);
    expect(errs.map((e) => e.id)).toEqual(errs.map((_, i) => `e${i}`));
    const texts = errs.map((e) => e.text);
    expect(texts).toContain(`Adresa ${TYPED_MAIL} není platná`);
    expect(texts).toContain("Formulář obsahuje chyby");
    expect(formErrors(document)).toEqual([]); // nothing new
    expect(applyFormErrors(document, en(errs))).toBe(errs.length);
    expect($("#email-err").textContent).toBe(`[EN] Adresa ${TYPED_MAIL} není platná`);
    formSource(document, true);
    expect(document.body.innerHTML).toBe(html);
    formSource(document, false);
    // The page writes a new message into the same element: it is read again, as new.
    $("#email-err").textContent = "Vyplňte e-mail";
    expect(formErrors(document).map((e) => e.text)).toEqual(["Vyplňte e-mail"]);
    clearFormText();
    expect($("#email-err").textContent).toBe("Vyplňte e-mail");
  });

  it("a form-words answer cannot write an error, and an errors answer cannot write the form's words", () => {
    const words = formText(document);
    expect(applyFormErrors(document, en(words))).toBe(0);
    expect($("legend").textContent).toBe("Kdo hlásí");
  });
});
