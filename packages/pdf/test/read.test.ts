// What Distill says about a PDF it cannot fill, and what it reads from one it can.
import { describe, expect, it } from "vitest";
import { PdfOpenError, PROBLEMS, readPdf, isCryptic, cleanLabel } from "../src/index.js";
import { PDFJS } from "./bench/pdf-forms.js";
import { buildPdf, readLayout, type Layout } from "./corpus/build.js";
import { REFUSALS } from "./corpus/refusals.js";

const refusal = (slug: string) => REFUSALS.find((r) => r.slug === slug)!.build();

describe("PDFs Distill cannot fill", () => {
  it("a print-only form: says it has no fields, and the Read view still has its text", async () => {
    const r = await readPdf(await refusal("flat-scan"), { pdfjs: PDFJS });
    expect(r.structure).toBeUndefined();
    expect(r.problem).toEqual({ kind: "flat", ...PROBLEMS.flat });
    expect(r.page.blocks.map((b) => b.text).join(" ")).toContain("Zadost o vydani potvrzeni");
    expect(r.page.formCount).toBeUndefined();
  });

  it("an XFA form, dynamic or static: says so, even when ordinary fields are also there", async () => {
    for (const slug of ["xfa-dynamic", "xfa-static"]) {
      const r = await readPdf(await refusal(slug), { pdfjs: PDFJS });
      expect(r.problem?.kind, slug).toBe("xfa");
      expect(r.structure, slug).toBeUndefined();
      expect(r.problem?.detail).toMatch(/Adobe/);
    }
  });

  it("an encrypted PDF that opens without a password but forbids filling in forms: shown and read, never changed", async () => {
    const r = await readPdf(await refusal("encrypted"), { pdfjs: PDFJS });
    expect(r.problem?.kind).toBe("encrypted");
    expect(r.structure).toBeUndefined();
    expect(r.page.blocks.map((b) => b.text).join(" ")).toContain("Žádost o vydání potvrzení");
  });

  it("a PDF that needs a password: rejected in plain words, nothing read", async () => {
    const err = await readPdf(await refusal("password"), { pdfjs: PDFJS }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfOpenError);
    expect((err as PdfOpenError).problem.kind).toBe("password");
    expect((err as Error).message).toMatch(/^This PDF needs a password to open\./);
  });

  it("a signed PDF: locked; an unsigned signature box does not lock a form", async () => {
    expect((await readPdf(await refusal("signed"), { pdfjs: PDFJS })).problem?.kind).toBe("locked");
    const fx = readLayout("prohlaseni-poplatnika") as { layout: Layout };
    const open = await readPdf(await buildPdf(fx.layout), { pdfjs: PDFJS });
    expect(open.problem).toBeUndefined();
    expect(open.bindings.some((b) => b.names.includes("Podpis"))).toBe(false);
  });

  it("bytes that are not a PDF: rejected as broken", async () => {
    const err = await readPdf(new TextEncoder().encode("<html>not a pdf</html>"), { pdfjs: PDFJS }).catch((e: unknown) => e);
    expect((err as PdfOpenError).problem.kind).toBe("broken");
  });
});

describe("reading a fillable PDF", () => {
  it("gives a neutral address, the document's own heading as title, and its language", async () => {
    const fx = readLayout("zmena-adresy") as { layout: Layout };
    const r = await readPdf(await buildPdf(fx.layout), { pdfjs: PDFJS, fileName: "zmena-adresy.pdf" });
    expect(r.structure?.url).toBe("pdf://local/");
    expect(r.page.url).toBe("pdf://local/");
    expect(r.structure?.title).toBe("Oznámení o změně místa pobytu");
    expect(r.structure?.lang).toBe("cs");
    expect(r.page.kind).toBe("form");
    expect(r.page.formCount).toBe(1);
    expect(r.page.blocks[0]).toMatchObject({ kind: "heading", level: 1, text: "Oznámení o změně místa pobytu" });
    expect(r.structure?.fields.find((f) => f.label === "Příjmení")?.section).toBe("1. Údaje o cizinci");
  });

  it("guesses the language from the text when the file does not declare one", async () => {
    const fx = readLayout("zadost-pobyt") as { layout: Layout };
    const r = await readPdf(await buildPdf(fx.layout), { pdfjs: PDFJS });
    expect(r.structure?.lang).toBe("cs");
  });

  it("knows a tool's name from a person's: Text12, ctl00_f1, Check Box3 are cryptic, Prijmeni is not", () => {
    for (const n of ["Text12", "Text Field 3", "Check Box3", "ctl00_f1", "f1_23", "form1[0].#subform[0].TextField1[0]", "Group1", "Pole12", "42", "undefined", "undefined_3", "Untitled 2"]) expect(isCryptic(n), n).toBe(true);
    for (const n of ["Prijmeni", "datum_narozeni", "form1[0].page1[0].Jmeno[0]", "Obchodní firma"]) expect(isCryptic(n), n).toBe(false);
  });

  it("cleans a printed label: colon, star, dot leaders and handwriting lines go", () => {
    expect(cleanLabel("Příjmení *")).toBe("Příjmení");
    expect(cleanLabel("Jméno:")).toBe("Jméno");
    expect(cleanLabel("Obec ..........")).toBe("Obec");
    expect(cleanLabel("Ulice ____")).toBe("Ulice");
  });
});

describe("labels on forms a tool made fillable", () => {
  const read = async (text: Layout["pages"][number]["text"], fields: Layout["pages"][number]["fields"]) => {
    const r = await readPdf(await buildPdf({ pages: [{ text, fields }] }), { pdfjs: PDFJS });
    return Object.fromEntries(r.bindings.map((b) => [b.names[0], r.structure!.fields.find((f) => f.fieldId === b.fieldId)!.label]));
  };

  it("a label in the same line as the underscores the box covers, two of them in one printed line", async () => {
    const got = await read([{ at: [50, 700], text: "Jméno: ______________________ Příjmení: ______________________" }],
      [{ type: "text", name: "undefined", rect: [86, 694, 110, 18] }, { type: "text", name: "undefined_2", rect: [262, 694, 110, 18] }]);
    expect(got).toEqual({ undefined: "Jméno", undefined_2: "Příjmení" });
  });

  it("a label printed inside the left of its own box wins over the previous row's label above it", async () => {
    const got = await read([{ at: [50, 718], text: "Sídlo: ______________________________" }, { at: [56, 689], text: "Předmět podnikání:" }],
      [{ type: "text", name: "undefined", rect: [84, 712, 200, 18] }, { type: "text", name: "undefined_2", rect: [50, 682, 380, 22] }]);
    expect(got).toEqual({ undefined: "Sídlo", undefined_2: "Předmět podnikání" });
  });

  it("a box with no label of its own keeps its own name rather than take the previous row's label", async () => {
    const got = await read([{ at: [50, 718], text: "Obec:" }],
      [{ type: "text", name: "Text1", rect: [84, 712, 200, 18] }, { type: "text", name: "Text2", rect: [50, 682, 380, 22] }]);
    expect(got).toEqual({ Text1: "Obec", Text2: "Text2" });
  });

  it("the question left of Ano/Ne radio buttons labelled on their left", async () => {
    const r = await readPdf(await buildPdf({ pages: [{ text: [{ at: [50, 590], text: "Máte trvalý pobyt v ČR?" }, { at: [350, 590], text: "Ano" }, { at: [410, 590], text: "Ne" }],
      fields: [{ type: "radio", name: "Group1", options: [{ value: "Choice1", rect: [374, 588, 10, 10] }, { value: "Choice2", rect: [428, 588, 10, 10] }] }] }] }), { pdfjs: PDFJS });
    expect(r.structure?.fields[0]).toMatchObject({ label: "Máte trvalý pobyt v ČR?", options: [{ value: "Choice1", label: "Ano" }, { value: "Choice2", label: "Ne" }] });
  });

  it("a column header on two lines placed on their own is read whole", async () => {
    const got = await read([{ at: [262, 652], size: 9, text: "Doba trvání" }, { at: [258, 642], size: 9, text: "(na dobu určitou do)" }],
      [{ type: "text", name: "undefined_4", rect: [240, 612, 120, 18] }]);
    expect(got).toEqual({ undefined_4: "Doba trvání (na dobu určitou do)" });
  });
});
