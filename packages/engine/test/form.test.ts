import { describe, expect, it } from "vitest";
import { extractForm, fingerprint, readValues, writeValues } from "../src/index.js";
import { parse } from "./helpers.js";
import czech from "./fixtures/czech-residence-form.html?raw";

const URL_ = "https://mv.example/zadost?x=1";

describe("extractForm (Czech residence form)", () => {
  it("finds every visible field with the right label and kind, and skips csrf and the button", async () => {
    const s = await extractForm(parse(czech), URL_);
    const got = s.fields.map((f) => [f.fieldId, f.kind, f.label]);
    expect(got).toEqual([
      ["jmeno", "text", "Jméno"],
      ["prijmeni", "text", "Příjmení"],
      ["datum", "date", "Datum narození"],
      ["rc", "text", "Rodné číslo"],
      ["stav", "radio", "Rodinný stav"],
      ["email", "email", "E-mail"],
      ["tel", "tel", "Telefon"],
      ["stat", "select", "Státní příslušnost"],
      ["duvod", "checkbox", "Důvod pobytu"],
      ["poznamka", "textarea", "Poznámka"],
      ["souhlas", "checkbox", "Souhlasím se zpracováním osobních údajů"],
    ]);
    expect(s.lang).toBe("cs");
    expect(s.title).toContain("Žádost");
  });

  it("makes a radio group one field with options, and keeps format hints, sections and required flags", async () => {
    const s = await extractForm(parse(czech), URL_);
    const by = (id: string) => s.fields.find((f) => f.fieldId === id)!;
    expect(by("stav").options).toEqual([
      { value: "svobodny", label: "Svobodný/á" },
      { value: "zenaty", label: "Ženatý / vdaná" },
      { value: "rozvedeny", label: "Rozvedený/á" },
    ]);
    expect(by("stav").section).toBe("Osobní údaje");
    expect(by("duvod").options).toHaveLength(3);
    expect(by("stat").options?.map((o) => o.value)).toEqual(["UA", "VN", "SK"]);
    expect(by("rc")).toMatchObject({
      required: true,
      pattern: "[0-9]{6}/?[0-9]{3,4}",
      placeholder: "900101/1234",
      maxLength: 11,
      hint: "Rodné číslo najdete na občanském průkazu.",
      section: "Osobní údaje",
    });
    expect(by("email")).toMatchObject({ required: false, section: "Kontakt a pobyt" });
    expect(by("jmeno").options).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("csrf");
    expect(JSON.stringify(s)).not.toContain("null");
  });

  it("fingerprints structure only: stable, 64 hex, ignores query and typed values", async () => {
    const doc = parse(czech);
    const a = await extractForm(doc, URL_);
    (doc.getElementById("jmeno") as HTMLInputElement).value = "Someone";
    const b = await extractForm(doc, "https://mv.example/zadost?other=2");
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(await fingerprint("https://mv.example/other", a.fields)).not.toBe(a.fingerprint);
  });

  it("round-trips values through writeValues and readValues", async () => {
    const doc = parse(czech);
    const s = await extractForm(doc, URL_);
    const values = {
      jmeno: "Olena",
      prijmeni: "Kovalenko",
      datum: "1990-01-01",
      rc: "900101/1234",
      stav: "zenaty",
      email: "olena@example.com",
      tel: "+420 777 123 456",
      stat: "UA",
      duvod: "prace,rodina",
      poznamka: "Dobrý den",
      souhlas: "true",
    };
    const res = writeValues(doc, s, values);
    expect(res.failed).toEqual([]);
    expect(res.written.sort()).toEqual(Object.keys(values).sort());
    expect(readValues(doc, s)).toEqual(values);
  });

  it("converts DD.MM.YYYY for date fields, fails unknown ids and unknown options", async () => {
    const doc = parse(czech);
    const s = await extractForm(doc, URL_);
    const res = writeValues(doc, s, { datum: "5.3.1990", nope: "x", stat: "Atlantis", stav: "neznamy" });
    expect(res.written).toEqual(["datum"]);
    expect(res.failed.sort()).toEqual(["nope", "stat", "stav"]);
    expect(readValues(doc, s).datum).toBe("1990-03-05");
  });

  it("fires bubbling input and change events", async () => {
    const doc = parse(czech);
    const s = await extractForm(doc, URL_);
    const seen: string[] = [];
    doc.body.addEventListener("input", (e) => seen.push("input:" + (e.target as Element).id));
    doc.body.addEventListener("change", (e) => seen.push("change:" + (e.target as Element).id));
    writeValues(doc, s, { jmeno: "Anna" });
    expect(seen).toEqual(["input:jmeno", "change:jmeno"]);
  });

  it("uses the native value setter, so a framework-patched instance setter does not swallow the write", async () => {
    const doc = parse(czech);
    const s = await extractForm(doc, URL_);
    const el = doc.getElementById("jmeno") as HTMLInputElement;
    let patched = 0;
    Object.defineProperty(el, "value", {
      configurable: true,
      get: () => "",
      set: () => {
        patched++;
      },
    });
    writeValues(doc, s, { jmeno: "Anna" });
    expect(patched).toBe(0);
    delete (el as unknown as Record<string, unknown>).value;
    expect(el.value).toBe("Anna");
  });

  it("labels fields from aria-label, aria-labelledby, wrapping label and nearby text", async () => {
    const doc = parse(`<html lang="de"><body><form>
      <input name="a" aria-label="Straße">
      <span id="l1">Ort</span><input name="b" aria-labelledby="l1">
      <label>Land <input name="c"></label>
      <p>Postleitzahl</p><input name="d">
      <input name="e" placeholder="Hausnummer">
      <input name="f">
    </form></body></html>`);
    const s = await extractForm(doc, "https://x.example/f");
    expect(s.fields.map((f) => f.label)).toEqual(["Straße", "Ort", "Land", "Postleitzahl", "Hausnummer", "f"]);
    expect(s.fields.map((f) => f.fieldId)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("names unnamed fields f<n>", async () => {
    const doc = parse(`<html><body><form><input aria-label="One"><input aria-label="Two"></form></body></html>`);
    const s = await extractForm(doc, "https://x.example/");
    expect(s.fields.map((f) => f.fieldId)).toEqual(["f0", "f1"]);
    expect(writeValues(doc, s, { f1: "x" }).written).toEqual(["f1"]);
  });
});
