// Filling a copy of a PDF: Czech and Ukrainian text drawn with an embedded font, writes confirmed by a fresh parse,
// anything that cannot be written honestly failed, and the person's own file never changed.
import fontkit from "@cantoo/fontkit";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { fillPdf, readPdf, readPdfValues, type PdfReading } from "../src/index.js";
import { PDFJS, seenByPdfJs } from "./bench/pdf-forms.js";
import { buildPdf, fontBytes, readLayout, type Layout } from "./corpus/build.js";

async function open(slug: string): Promise<{ bytes: Uint8Array; r: PdfReading; id: (label: string) => string }> {
  const bytes = await buildPdf((readLayout(slug) as { layout: Layout }).layout);
  const r = await readPdf(bytes, { pdfjs: PDFJS });
  const id = (label: string) => {
    const f = r.structure?.fields.find((x) => x.label === label);
    if (!f) throw new Error(`no field ${label}`);
    return f.fieldId;
  };
  return { bytes, r, id };
}

/** The fonts the appearance streams of a field's widgets use, and whether each is embedded (has a font file). */
async function appearanceFonts(bytes: Uint8Array, name: string): Promise<{ name: string; embedded: boolean }[]> {
  const doc = await PDFDocument.load(bytes);
  const out: { name: string; embedded: boolean }[] = [];
  for (const w of doc.getForm().getField(name).acroField.getWidgets()) {
    const n = w.getAppearances()?.normal;
    if (!(n instanceof PDFStream)) continue;
    const fonts = n.dict.lookupMaybe(PDFName.of("Resources"), PDFDict)?.lookupMaybe(PDFName.of("Font"), PDFDict);
    for (const key of fonts?.keys() ?? []) {
      const font = fonts?.lookup(key, PDFDict);
      const descendants = font?.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
      const cid = descendants ? descendants.lookup(0, PDFDict) : font;
      const fd = cid?.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
      out.push({ name: key.decodeText(), embedded: !!fd && (fd.has(PDFName.of("FontFile2")) || fd.has(PDFName.of("FontFile3")) || fd.has(PDFName.of("FontFile"))) });
    }
  }
  return out;
}

describe("Czech and Ukrainian in the saved file", () => {
  it("the standard PDF fonts cannot carry Czech: pdf-lib's own default path silently draws 'Žlu?ou?ký k??'", async () => {
    const { bytes } = await open("zmena-adresy");
    const doc = await PDFDocument.load(bytes);
    doc.getForm().getTextField("Text7").setText("Žluťoučký kůň");
    doc.getForm().updateFieldAppearances(); // Helvetica, WinAnsi encoding: no ť, no ů, no ň
    const seen = (await seenByPdfJs(await doc.save())).get("Text7")!;
    expect(seen.value).toBe("Žluťoučký kůň"); // the value is right...
    expect(seen.shown).toBe("Žlu?ou?ký k??"); // ...and a viewer that draws the appearance shows garbage
  });

  it("'Žluťoučký kůň' is drawn by an embedded font, and pdf.js reads exactly those letters back from the drawing", async () => {
    const { bytes, r, id } = await open("zmena-adresy");
    const out = await fillPdf(bytes, r, { [id("Ulice")]: "Žluťoučký kůň" }, fontBytes());
    expect(out).toMatchObject({ written: [id("Ulice")], failed: [] });
    const seen = (await seenByPdfJs(out.bytes)).get("Text7")!;
    expect(seen.value).toBe("Žluťoučký kůň");
    expect(seen.shown).toBe("Žluťoučký kůň");
    expect(seen.missingGlyph).toBe(false);
    const fonts = await appearanceFonts(out.bytes, "Text7");
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((f) => f.embedded)).toBe(true);
    // A viewer that redraws the field finds the same font in the form's resources.
    const doc = await PDFDocument.load(out.bytes);
    const dr = doc.getForm().acroForm.dict.lookup(PDFName.of("DR"), PDFDict).lookup(PDFName.of("Font"), PDFDict);
    const da = doc.getForm().getTextField("Text7").acroField.getDefaultAppearance() ?? "";
    expect(dr.has(PDFName.of(/\/(\S+)\s+[\d.]+\s+Tf/.exec(da)?.[1] ?? "?"))).toBe(true);
  });

  it("Ukrainian (Cyrillic) is written and drawn too", async () => {
    const { bytes, r, id } = await open("prohlaseni-poplatnika");
    const out = await fillPdf(bytes, r, { [id("Příjmení a jméno")]: "Шевченко Олена Іванівна, ґ є ї" }, fontBytes());
    expect(out.failed).toEqual([]);
    const seen = (await seenByPdfJs(out.bytes)).get("ctl00_f3")!;
    expect(seen.shown).toBe("Шевченко Олена Іванівна, ґ є ї");
    expect(seen.missingGlyph).toBe(false);
  });

  it("a character the embedded font lacks fails its field, never drawn as garbage; the other answers are written", async () => {
    const { bytes, r, id } = await open("zmena-adresy");
    const out = await fillPdf(bytes, r, { [id("Jméno")]: "Olena 漢字", [id("Obec")]: "Brno", [id("Ulice")]: "Ulice 😀" }, fontBytes());
    expect(out.written).toEqual([id("Obec")]);
    expect(out.failed.sort()).toEqual([id("Jméno"), id("Ulice")].sort());
    const seen = await seenByPdfJs(out.bytes);
    expect(seen.get("Text2")?.value ?? "").toBe("");
    expect(seen.get("Text7")?.value ?? "").toBe("");
    expect(seen.get("Text9")?.shown).toBe("Brno");
  });
});

describe("confirmed writes", () => {
  it("never changes the person's file: every write makes new bytes", async () => {
    const { bytes, r, id } = await open("zmena-adresy");
    const copy = bytes.slice();
    const out = await fillPdf(bytes, r, { [id("Obec")]: "Praha" }, fontBytes());
    expect(Buffer.from(bytes).equals(Buffer.from(copy))).toBe(true);
    expect(out.bytes).not.toBe(bytes);
  });

  it("fails what the form cannot take: too long, not an option, not a date, a field it does not have", async () => {
    const { bytes, r, id } = await open("zadost-pobyt");
    const out = await fillPdf(bytes, r, {
      [id("Číslo cestovního dokladu")]: "FX12345678901",
      [id("Doba prodloužení")]: "5 let",
      [id("Účel pobytu")]: "Volba9",
      [id("Platnost od")]: "31.13.2026",
      nope: "x",
      [id("E-mail")]: "huong@example.com",
    }, fontBytes());
    expect(out.written).toEqual([id("E-mail")]);
    expect(out.failed).toHaveLength(5);
  });

  it("a comb field and a row of boxes take a birth number or a postcode written with a slash or a space", async () => {
    const a = await open("prihlaska-pojistence");
    const out = await fillPdf(a.bytes, a.r, { [a.id("Rodné číslo")]: "870619/4321" }, fontBytes());
    expect(out.failed).toEqual([]);
    expect((await seenByPdfJs(out.bytes)).get("form1[0].#subform[0].TextField3[0]")?.value).toBe("8706194321");
    const b = await open("zmena-adresy");
    const psc = await fillPdf(b.bytes, b.r, { [b.id("PSČ")]: "602 00" }, fontBytes());
    expect(psc.failed).toEqual([]);
    expect(await readPdfValues(psc.bytes, b.r)).toMatchObject({ [b.id("PSČ")]: "60200" });
  });

  it("a split date takes 5.3.1990 or 1990-03-05 and reads back as 1990-03-05", async () => {
    const { bytes, r, id } = await open("zmena-adresy");
    for (const v of ["5.3.1990", "1990-03-05"]) {
      const out = await fillPdf(bytes, r, { [id("Datum narození")]: v }, fontBytes());
      expect(out.failed).toEqual([]);
      expect((await readPdfValues(out.bytes, r))[id("Datum narození")]).toBe("1990-03-05");
    }
  });

  it("reads what a partly filled form already holds (device-only), and can clear it", async () => {
    const { bytes, r, id } = await open("prohlaseni-poplatnika");
    const held = await readPdfValues(bytes, r);
    expect(held).toMatchObject({ [id("Název plátce")]: "Stavební firma Zqxvbrt s.r.o.", [id("IČO")]: "27082440", [id("Uplatňuji slevu na poplatníka")]: "true" });
    const out = await fillPdf(bytes, r, { [id("IČO")]: "", [id("Uplatňuji slevu na poplatníka")]: "" }, fontBytes());
    expect(out.failed).toEqual([]);
    const after = await readPdfValues(out.bytes, r);
    expect(after[id("IČO")]).toBeUndefined();
    expect(after[id("Uplatňuji slevu na poplatníka")]).toBeUndefined();
    expect(after[id("Název plátce")]).toBe("Stavební firma Zqxvbrt s.r.o.");
  });

  it("radio buttons, a dropdown with codes, and tick boxes are written as pdf.js reads them", async () => {
    const { bytes, r, id } = await open("prihlaska-pojistence");
    const out = await fillPdf(bytes, r, { [id("Pohlaví")]: "2", [id("Zdravotní pojišťovna")]: "111", [id("Jsem zaměstnanec")]: "true" }, fontBytes());
    expect(out.failed).toEqual([]);
    const seen = await seenByPdfJs(out.bytes);
    expect(seen.get("form1[0].#subform[0].RadioButtonList[0]")?.value).toBe("2");
    expect(seen.get("form1[0].#subform[0].DropDownList1[0]")?.value).toEqual(["111"]);
    expect(seen.get("form1[0].#subform[0].DropDownList1[0]")?.shown).toBe("Všeobecná zdravotní pojišťovna");
    expect(seen.get("form1[0].#subform[0].CheckBox1[0]")?.value).toBe("Yes");
  });

  it("the font is fetched only when text is written", async () => {
    const { bytes, r, id } = await open("prihlaska-pojistence");
    let asked = 0;
    const font = async () => { asked++; return fontBytes(); };
    await fillPdf(bytes, r, { [id("Jsem zaměstnanec")]: "true", [id("Pohlaví")]: "1" }, font);
    expect(asked).toBe(0);
    await fillPdf(bytes, r, { [id("Jméno")]: "Ľudmila" }, font);
    expect(asked).toBe(1);
  });

  it("uses fontkit's glyph table, so a font without a letter fails it rather than drawing a blank", () => {
    const f = fontkit.create(fontBytes() as never) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
    expect(f.hasGlyphForCodePoint("ř".codePointAt(0)!)).toBe(true);
    expect(f.hasGlyphForCodePoint("ї".codePointAt(0)!)).toBe(true);
    expect(f.hasGlyphForCodePoint("漢".codePointAt(0)!)).toBe(false);
  });
});
