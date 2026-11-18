// Payload privacy on the PDF path (the engine's privacy.test.ts covers web pages; this never weakens it). A PDF can
// already hold a person's answers, and its file name can be their name: neither may reach a FormStructure, a PageModel,
// the fingerprint's input or any cloud-eligible prompt.
import { fingerprint, prompts, route, type FormStructure, type PageModel, type Task } from "@distill/engine";
import { describe, expect, it } from "vitest";
import { PDFDocument, rgb } from "@cantoo/pdf-lib";
import fontkit from "@cantoo/fontkit";
import { fillPdf, PDF_URL, readPdf } from "../src/index.js";
import { PDFJS } from "./bench/pdf-forms.js";
import { buildPdf, fontBytes, readLayout, type Layout } from "./corpus/build.js";

/** Every cloud-eligible prompt the app can build from a page model and a form structure. */
function cloudPrompts(page: PageModel, s: FormStructure): string[] {
  const eligible: Task[] = ["classifyPage", "simplifyBlocks", "recast", "buildWizard", "explainField"];
  for (const t of eligible) expect(route(t, "prefer_in_cloud").promptClass).not.toBe("values");
  return [
    prompts.classifyPage(page), prompts.simplifyBlocks(page, "plain", "en"), prompts.recast(page, ["summary", "steps"]),
    prompts.buildWizard(s, "en"), ...s.fields.map((f) => prompts.explainField(s, f.fieldId, "en")),
  ];
}

function expectAbsent(secrets: string[], ...where: string[]): void {
  for (const text of where) for (const s of secrets) expect(text).not.toContain(s);
}

const SECRETS = { name: "Zqxvlenka Wbrtnovska", rc: "870619/4321", street: "Wbrtnovska 88", kids: "7" };

describe("payload privacy, PDF", () => {
  it("values a partly filled PDF already holds never reach the structure, the page model or a prompt", async () => {
    const fx = readLayout("prohlaseni-poplatnika") as { layout: Layout; prefilled: string[] };
    const r = await readPdf(await buildPdf(fx.layout), { pdfjs: PDFJS, fileName: "prohlaseni.pdf" });
    const s = r.structure as FormStructure;
    expect(fx.prefilled).toContain("Stavební firma Zqxvbrt s.r.o.");
    // The labels around them are read; the values in the boxes are not.
    expect(JSON.stringify(r.page)).toContain("Název plátce");
    expectAbsent([...fx.prefilled, "Zqxvbrt", "27082440"], JSON.stringify(s), JSON.stringify(r.page), ...cloudPrompts(r.page, s));
  });

  it("answers written into the PDF never reach the structure, the page model or a prompt when it is read again", async () => {
    const fx = readLayout("prohlaseni-poplatnika") as { layout: Layout };
    const bytes = await buildPdf(fx.layout);
    const before = await readPdf(bytes, { pdfjs: PDFJS });
    const id = (label: string) => (before.structure as FormStructure).fields.find((f) => f.label === label)!.fieldId;
    const out = await fillPdf(bytes, before, {
      [id("Příjmení a jméno")]: SECRETS.name, [id("Rodné číslo")]: SECRETS.rc, [id("Adresa bydliště")]: SECRETS.street, [id("Počet vyživovaných dětí")]: SECRETS.kids,
    }, fontBytes());
    expect(out.failed).toEqual([]);
    const after = await readPdf(out.bytes, { pdfjs: PDFJS });
    expect(after.structure).toEqual(before.structure);
    expect(after.page).toEqual(before.page);
    expectAbsent([SECRETS.name, SECRETS.rc, SECRETS.street, "Zqxvlenka", "Wbrtnovsk", "870619"], JSON.stringify(after.structure), JSON.stringify(after.page),
      ...cloudPrompts(after.page, after.structure as FormStructure));
  });

  it("the file name never reaches the url, the title, the fingerprint's input or a prompt, even when the PDF's own metadata repeats it", async () => {
    const cases: { meta: string; file: string }[] = [
      { meta: "zadost_Zqxvbrt", file: "zadost_Zqxvbrt.pdf" },
      { meta: "Zqxvbrt Wbrtnovsky zadost", file: "Zqxvbrt Wbrtnovsky zadost.pdf" },
      { meta: "Microsoft Word - Zqxvbrt.docx", file: "formular.pdf" },
    ];
    for (const c of cases) {
      // No printed heading, so the title could only come from the metadata.
      const layout: Layout = { title: c.meta, pages: [{ text: [{ at: [50, 712], text: "Příjmení:" }, { at: [50, 688], text: "Jméno:" }],
        fields: [{ type: "text", name: "Text1", rect: [150, 706, 250, 18] }, { type: "text", name: "Text2", rect: [150, 682, 250, 18] }] }] };
      const r = await readPdf(await buildPdf(layout), { pdfjs: PDFJS, fileName: c.file });
      const s = r.structure as FormStructure;
      expect(s.url).toBe(PDF_URL);
      expect(s.title, c.meta).toBe("");
      expect(s.fingerprint).toBe(await fingerprint(PDF_URL, s.fields));
      expectAbsent(["Zqxvbrt", "Wbrtnovsky"], JSON.stringify(s), JSON.stringify(r.page), ...cloudPrompts(r.page, s));
    }
  });

  it("a document title that is the document's own words is kept", async () => {
    const layout: Layout = { title: "Žádost o vydání potvrzení", pages: [{ text: [{ at: [50, 712], text: "Příjmení:" }], fields: [{ type: "text", name: "Text1", rect: [150, 706, 250, 18] }] }] };
    const r = await readPdf(await buildPdf(layout), { pdfjs: PDFJS, fileName: "potvrzeni.pdf" });
    expect(r.structure?.title).toBe("Žádost o vydání potvrzení");
  });
});

describe("payload privacy, print-only PDF", () => {
  const printLayout = async (): Promise<Layout> => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { CORPUS_DIR } = await import("./corpus/build.js");
    return (JSON.parse(readFileSync(join(CORPUS_DIR, "tisk-zmena-pobytu.print.json"), "utf8")) as { layout: Layout }).layout;
  };

  it("answers Distill drew onto a copy never reach the structure, the page model or a prompt when it is read again", async () => {
    const bytes = await buildPdf(await printLayout());
    const before = await readPdf(bytes, { pdfjs: PDFJS, fileName: "oznameni_Wbrtnovska.pdf" });
    const s = before.structure as FormStructure;
    const id = (prefix: string) => s.fields.find((f) => f.label.startsWith(prefix))!.fieldId;
    const out = await fillPdf(bytes, before, { [id("Jméno")]: SECRETS.name, [id("Telefon")]: "+420 608 431 977", [id("Adresa")]: SECRETS.street }, fontBytes(), { pdfjs: PDFJS });
    expect(out.failed).toEqual([]);
    const after = await readPdf(out.bytes, { pdfjs: PDFJS, fileName: "oznameni_Wbrtnovska (filled).pdf" });
    expect(after.structure).toEqual(before.structure);
    expect(after.page).toEqual(before.page);
    expectAbsent([SECRETS.name, SECRETS.street, "Zqxvlenka", "Wbrtnov", "608 431"], JSON.stringify(after.structure), JSON.stringify(after.page),
      ...cloudPrompts(after.page, after.structure as FormStructure));
  });

  it("text another program typed onto a line is kept out of the structure, the page model and every prompt", async () => {
    const doc = await PDFDocument.load(await buildPdf(await printLayout()));
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes(), { subset: true });
    doc.getPage(0).drawText(SECRETS.name, { x: 300, y: 700, size: 10, font, color: rgb(0, 0, 0.5) });
    doc.getPage(0).drawText("Wbrtnovska 88, Ostrava", { x: 300, y: 628, size: 10, font, color: rgb(0, 0, 0.5) });
    const r = await readPdf(await doc.save(), { pdfjs: PDFJS });
    const s = r.structure as FormStructure;
    expect(s.fields.length).toBeGreaterThan(5);
    expectAbsent(["Zqxvlenka", "Wbrtnov", "Ostrava"], JSON.stringify(s), JSON.stringify(r.page), ...cloudPrompts(r.page, s));
  });
});
