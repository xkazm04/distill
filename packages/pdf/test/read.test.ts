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

  it("an encrypted PDF that opens without a password: shown and read, never changed", async () => {
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
    for (const n of ["Text12", "Text Field 3", "Check Box3", "ctl00_f1", "f1_23", "form1[0].#subform[0].TextField1[0]", "Group1", "Pole12", "42"]) expect(isCryptic(n), n).toBe(true);
    for (const n of ["Prijmeni", "datum_narozeni", "form1[0].page1[0].Jmeno[0]", "Obchodní firma"]) expect(isCryptic(n), n).toBe(false);
  });

  it("cleans a printed label: colon, star, dot leaders and handwriting lines go", () => {
    expect(cleanLabel("Příjmení *")).toBe("Příjmení");
    expect(cleanLabel("Jméno:")).toBe("Jméno");
    expect(cleanLabel("Obec ..........")).toBe("Obec");
    expect(cleanLabel("Ulice ____")).toBe("Ulice");
  });
});
