// Print-only PDFs: forms with printed lines and boxes but no form field. Distill finds the places to write on, names them
// from the printed text (or by their position, or leaves them out), draws the answers onto a copy, and counts an answer
// as written only when pdf.js reads it back at its place.
import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import fontkit from "@cantoo/fontkit";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { fillPdf, PDF_URL, PRINT_ONLY_NOTE, readPdf, readPdfValues, type PdfReading } from "../src/index.js";
import { REASONS } from "../src/overlay.js";
import { PDFJS } from "./bench/pdf-forms.js";
import { buildPdf, fontBytes, type Layout } from "./corpus/build.js";

const DOTS = "..............................................................................";

/** A small print-only form: two dotted leaders, a ruled line, a box with a label above, a tick square, a signature line. */
const form = (): Layout => ({
  pages: [{
    fields: [],
    text: [
      { at: [60, 790], size: 16, text: "Žádost o potvrzení" },
      { at: [40, 740], text: "Příjmení:" },
      { at: [140, 740], text: DOTS },
      { at: [40, 720], text: "Místo narození:" },
      { at: [140, 720], text: DOTS },
      { at: [40, 690], text: "Telefon:" },
      { at: [42, 660], size: 8, text: "Číslo pasu" },
      { at: [62, 612], text: "Souhlasím se zpracováním údajů" },
      { at: [320, 560], text: "......................................." },
      { at: [360, 548], size: 8, text: "Podpis žadatele" },
    ],
    lines: [{ from: [100, 688], to: [300, 688] }],
    rects: [{ rect: [40, 640, 160, 16] }, { rect: [40, 608, 14, 14] }],
  }],
});

async function read(layout: Layout = form()): Promise<{ bytes: Uint8Array; r: PdfReading; id: (label: string) => string }> {
  const bytes = await buildPdf(layout);
  const r = await readPdf(bytes, { pdfjs: PDFJS, fileName: "zadost_Novakova.pdf" });
  const id = (label: string) => {
    const f = r.structure?.fields.find((x) => x.label === label);
    if (!f) throw new Error(`no field ${label}: ${r.structure?.fields.map((x) => x.label).join(" | ")}`);
    return f.fieldId;
  };
  return { bytes, r, id };
}

/** Text items pdf.js reads on page 1: string and baseline position. */
async function textOf(bytes: Uint8Array): Promise<{ str: string; x: number; y: number; w: number }[]> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const items = (await (await doc.getPage(1)).getTextContent()).items as { str: string; transform: number[]; width: number }[];
    return items.filter((i) => i.str?.trim()).map((i) => ({ str: i.str, x: i.transform[4] as number, y: i.transform[5] as number, w: i.width }));
  } finally {
    await task.destroy();
  }
}

describe("reading a print-only PDF", () => {
  it("finds the places to write on, with their printed labels, and says it is print-only", async () => {
    const { r } = await read();
    expect(r.problem).toBeUndefined();
    expect(r.printOnly).toBe(true);
    const s = r.structure!;
    expect(s.url).toBe(PDF_URL);
    expect(s.fields.map((f) => [f.label, f.kind])).toEqual([
      ["Příjmení", "text"], ["Místo narození", "text"], ["Telefon", "text"], ["Číslo pasu", "text"], ["Souhlasím se zpracováním údajů", "checkbox"],
    ]);
    for (const b of r.bindings) {
      expect(b.via).toBe("print");
      expect(b.names).toEqual([]);
      expect(b.print?.label).toBe("printed");
      expect(b.boxes.length).toBeGreaterThan(0);
    }
    // The signature line is left out: nobody types a signature.
    expect(JSON.stringify(s)).not.toContain("Podpis");
  });

  it("the note every print-only form carries is plain and says to check the page", () => {
    expect(PRINT_ONLY_NOTE.title).toBe("Distill found the places to write on this form by itself");
    expect(PRINT_ONLY_NOTE.detail).toMatch(/may have missed some/);
    expect(PRINT_ONLY_NOTE.detail).toMatch(/check every answer on the page itself/);
  });

  it("a place whose label cannot be told is named by its position, never given a confident label", async () => {
    // A dotted line with nothing printed on its row: only a heading well above it, not aligned with it.
    const layout: Layout = { pages: [{ fields: [], text: [{ at: [200, 760], size: 9, text: "Další údaje" }, { at: [40, 730], text: DOTS }] }] };
    const { r } = await read(layout);
    const f = r.structure!.fields[0]!;
    expect(f.label).toBe('the line under "Další údaje"');
    expect(r.bindings[0]?.print?.label).toBe("position");
  });

  it("a ruled line with no label at all is not offered (it may be a decoration)", async () => {
    const layout: Layout = { pages: [{ fields: [], text: [{ at: [40, 760], text: "Jméno:" }, { at: [100, 760], text: DOTS }], lines: [{ from: [40, 100], to: [200, 100] }] }] };
    const { r } = await read(layout);
    expect(r.structure!.fields.map((f) => f.label)).toEqual(["Jméno"]);
  });

  it("the file name never reaches the structure, the title or the page model", async () => {
    const { r } = await read();
    expect(JSON.stringify(r.structure)).not.toMatch(/Novakova|zadost_/);
    expect(JSON.stringify(r.page)).not.toMatch(/Novakova|zadost_/);
  });
});

describe("writing answers onto a copy of a print-only PDF", () => {
  it("draws each answer at its place in the embedded font; pdf.js reads it back; the original is untouched", async () => {
    const { bytes, r, id } = await read();
    const before = bytes.slice();
    const out = await fillPdf(bytes, r, { [id("Příjmení")]: "Řeháková-Ďurčová", [id("Telefon")]: "+420 777 123 456", [id("Číslo pasu")]: "FX4471902" }, fontBytes(), { pdfjs: PDFJS });
    expect(out.failed).toEqual([]);
    expect(out.written.sort()).toEqual([id("Číslo pasu"), id("Příjmení"), id("Telefon")].sort());
    expect(bytes).toEqual(before);
    const seen = await textOf(out.bytes);
    const name = seen.find((i) => i.str === "Řeháková-Ďurčová");
    expect(name).toBeDefined();
    // On the dotted line of "Příjmení", inside its width.
    expect(name!.x).toBeGreaterThanOrEqual(140);
    expect(name!.y).toBeGreaterThan(739);
    expect(name!.y).toBeLessThan(746);
    expect(seen.find((i) => i.str === "FX4471902")!.y).toBeGreaterThan(640);
  });

  it("a tick is a cross drawn inside its square", async () => {
    const { bytes, r, id } = await read();
    const out = await fillPdf(bytes, r, { [id("Souhlasím se zpracováním údajů")]: "true" }, fontBytes(), { pdfjs: PDFJS });
    expect(out.written).toEqual([id("Souhlasím se zpracováním údajů")]);
    const x = (await textOf(out.bytes)).find((i) => i.str === "X")!;
    expect(x.x).toBeGreaterThan(40);
    expect(x.x + x.w).toBeLessThan(54);
    expect(x.y).toBeGreaterThan(608);
    expect(x.y).toBeLessThan(622);
  });

  it("an answer too long for its place is shrunk, and below the smallest size reported failed with the reason, not drawn", async () => {
    const { bytes, r, id } = await read();
    const long = "Velmi dlouhé číslo pasu, které se do políčka nevejde ani malým písmem, protože je opravdu příliš dlouhé";
    const out = await fillPdf(bytes, r, { [id("Číslo pasu")]: long, [id("Příjmení")]: "Nováková" }, fontBytes(), { pdfjs: PDFJS });
    expect(out.failed).toEqual([id("Číslo pasu")]);
    expect(out.reasons[id("Číslo pasu")]).toBe(REASONS.long);
    expect(out.written).toEqual([id("Příjmení")]);
    expect((await textOf(out.bytes)).some((i) => i.str.includes("Velmi"))).toBe(false);
    // Shrunk to fit, not failed: a long place name on its dotted line.
    const fits = await fillPdf(bytes, r, { [id("Místo narození")]: "Ústí nad Labem, okres Ústí nad Labem, Česká republika" }, fontBytes(), { pdfjs: PDFJS });
    expect(fits.failed).toEqual([]);
  });

  it("without pdf.js to read the copy back, nothing drawn is claimed written", async () => {
    const { bytes, r, id } = await read();
    const out = await fillPdf(bytes, r, { [id("Příjmení")]: "Nováková" }, fontBytes());
    expect(out.written).toEqual([]);
    expect(out.failed).toEqual([id("Příjmení")]);
    expect(out.reasons[id("Příjmení")]).toBe(REASONS.noReader);
  });

  it("a date place takes a date in any common writing and draws it as DD.MM.YYYY; anything else fails with the reason", async () => {
    const layout: Layout = { pages: [{ fields: [], text: [{ at: [42, 700], size: 8, text: "Datum narození" }], rects: [{ rect: [40, 680, 120, 16] }] }] };
    const { bytes, r } = await read(layout);
    const f = r.structure!.fields[0]!;
    expect(f.kind).toBe("date");
    const ok = await fillPdf(bytes, r, { [f.fieldId]: "1990-03-05" }, fontBytes(), { pdfjs: PDFJS });
    expect(ok.written).toEqual([f.fieldId]);
    expect((await textOf(ok.bytes)).some((i) => i.str === "05.03.1990")).toBe(true);
    const bad = await fillPdf(bytes, r, { [f.fieldId]: "brzy" }, fontBytes(), { pdfjs: PDFJS });
    expect(bad.failed).toEqual([f.fieldId]);
    expect(bad.reasons[f.fieldId]).toBe(REASONS.date);
  });

  it("text another tool already typed on a line is not a label and not in the page model; Distill does not write over it", async () => {
    const blank = await buildPdf(form());
    // Typed onto the "Příjmení" line by another program: plain page text, no Distill tag.
    const doc = await PDFDocument.load(blank);
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes(), { subset: true });
    doc.getPage(0).drawText("Zqxvbrtová", { x: 150, y: 742, size: 10, font, color: rgb(0, 0, 0.6) });
    const typed = await doc.save();
    const r = await readPdf(typed, { pdfjs: PDFJS });
    expect(JSON.stringify(r.structure)).not.toContain("Zqxvbrt");
    expect(JSON.stringify(r.page)).not.toContain("Zqxvbrt");
    const id = r.structure!.fields.find((f) => f.label === "Příjmení")!.fieldId;
    const out = await fillPdf(typed, r, { [id]: "Nováková" }, fontBytes(), { pdfjs: PDFJS });
    expect(out.failed).toEqual([id]);
    expect(out.reasons[id]).toBe(REASONS.taken);
  });

  it("a filled copy read again gives the same structure and page model, with none of the answers in them", async () => {
    const { bytes, r, id } = await read();
    const out = await fillPdf(bytes, r, { [id("Příjmení")]: "Zqxvlenka Wbrtnovská", [id("Telefon")]: "+420 608 111 222" }, fontBytes(), { pdfjs: PDFJS });
    expect(out.failed).toEqual([]);
    const again = await readPdf(out.bytes, { pdfjs: PDFJS });
    expect(again.structure).toEqual(r.structure);
    expect(again.page).toEqual(r.page);
    expect(JSON.stringify(again)).not.toMatch(/Zqxvlenka|Wbrtnov|608 111/);
    // There is no form field to read a value from.
    expect(await readPdfValues(out.bytes, again)).toEqual({});
  });
});
