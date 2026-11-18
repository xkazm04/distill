// Reading a PDF the person opened: what it says (the page model) and, when it can be filled, its form (a
// FormStructure). Three kinds of PDF cannot be filled, and each is said in plain words rather than half-handled: a
// PDF with no fields (a scan or a print-only form), an XFA form, and a file that is encrypted, signed or locked.
// pdf.js reads the text and the document facts; pdf-lib reads the form, as it is also what writes it.
import { PDFDocument } from "@cantoo/pdf-lib";
import { fingerprint, type FormStructure } from "@distill/engine";
import { lockReason, readFields } from "./fields.js";
import { buildFields } from "./labels.js";
import { buildPage, buildRuns, documentLang, documentTitle, readItems } from "./text.js";
import { PDF_URL, type PdfJs, type PdfJsDocument, type PdfProblem, type PdfProblemKind, type PdfReading } from "./types.js";

const READ_ELSEWHERE = "You can still read it in Distill's other views.";

/** The plain words for each problem. Shown as they are; no AI rewrites them. */
export const PROBLEMS: Record<PdfProblemKind, { title: string; detail: string }> = {
  flat: {
    title: "This PDF has no fields to fill in",
    detail: `It is a scan or a form made for printing: there are no boxes in the file that can hold an answer. Print it and fill it in by hand, or ask the office for a fillable version. ${READ_ELSEWHERE}`,
  },
  xfa: {
    title: "This PDF is an XFA form, which Distill cannot fill",
    detail: `XFA is an older Adobe form format that some offices use. Its boxes are not ordinary PDF form fields, so answers written here would not show in Adobe Reader, and the form's own checks would not run. Open it in Adobe Acrobat Reader to fill it in, or ask the office for another version. ${READ_ELSEWHERE}`,
  },
  encrypted: {
    title: "This PDF is protected, so Distill cannot change it",
    detail: `The file is encrypted. Distill does not remove an office's protection from a file. Fill it in with a PDF reader, or ask the office for an unprotected version. ${READ_ELSEWHERE}`,
  },
  locked: {
    title: "This PDF is signed or locked, so Distill does not change it",
    detail: `The file carries a digital signature, or a lock that allows no changes. Changing it would break the signature. ${READ_ELSEWHERE}`,
  },
  password: {
    title: "This PDF needs a password to open",
    detail: "Distill does not ask for passwords. Open it in a PDF reader instead.",
  },
  broken: {
    title: "Distill could not read this file as a PDF",
    detail: "The file may be damaged, or it may not be a PDF. Try opening it in a PDF reader.",
  },
};

const problem = (kind: PdfProblemKind, extra?: string): PdfProblem => ({
  kind, title: PROBLEMS[kind].title, detail: extra ? `${extra} ${PROBLEMS[kind].detail}` : PROBLEMS[kind].detail,
});

/** Thrown by readPdf when the document cannot even be opened (`password`, `broken`). Its message is plain words. */
export class PdfOpenError extends Error {
  constructor(readonly problem: PdfProblem) {
    super(`${problem.title}. ${problem.detail}`);
    this.name = "PdfOpenError";
  }
}

interface Info {
  Title?: unknown;
  Language?: unknown;
  EncryptFilterName?: unknown;
  IsXFAPresent?: unknown;
  IsAcroFormPresent?: unknown;
}

/**
 * Opens bytes with pdf.js. pdf.js may take ownership of the buffer it is given, so it always gets a copy. No
 * WebAssembly (the web app's CSP has no 'wasm-unsafe-eval'; pdf.js decodes in JavaScript instead) and no XFA
 * rendering. `close` ends the document and its worker side.
 */
export async function openWithPdfJs(pdfjs: PdfJs, bytes: Uint8Array): Promise<{ pdf: PdfJsDocument; close: () => Promise<void> }> {
  const task = pdfjs.getDocument({ data: bytes.slice(), useWasm: false, enableXfa: false, stopAtErrors: false, verbosity: 0 });
  try {
    return { pdf: await task.promise, close: () => task.destroy().catch(() => undefined) };
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const name = (e as { name?: string })?.name ?? "";
    throw new PdfOpenError(problem(name === "PasswordException" ? "password" : "broken"));
  }
}

/**
 * Reads a PDF. Rejects with PdfOpenError when it cannot be opened at all. Otherwise returns the page model, and either
 * the form's structure and bindings or the plain-words reason it cannot be filled. `fileName` is used only to keep
 * the file's name out of the title (a name the person gave the file can be their own name); it is never stored.
 */
export async function readPdf(bytes: Uint8Array, opts: { pdfjs: PdfJs; fileName?: string }): Promise<PdfReading> {
  const { pdf, close } = await openWithPdfJs(opts.pdfjs, bytes);
  try {
    const info = ((await pdf.getMetadata().catch(() => ({ info: {} }))).info ?? {}) as Info;
    const { items, pages } = await readItems(pdf);

    let found: PdfProblem | undefined;
    let fields: ReturnType<typeof readFields> = [];
    if (typeof info.EncryptFilterName === "string" && info.EncryptFilterName) found = problem("encrypted");
    else if (info.IsXFAPresent === true) found = problem("xfa");
    else {
      let doc: PDFDocument | null = null;
      try {
        doc = await PDFDocument.load(bytes, { preserveXFA: true, updateMetadata: false, throwOnInvalidObject: false });
      } catch (e) {
        found = /encrypt/i.test(String((e as Error)?.message)) ? problem("encrypted") : problem("broken", "Distill can show this PDF but not change it.");
      }
      if (doc) {
        if (doc.isEncrypted) found = problem("encrypted");
        else if (doc.getForm().hasXFA()) found = problem("xfa");
        else if (lockReason(doc)) found = problem("locked");
        else {
          fields = readFields(doc);
          if (!fields.length) found = problem("flat");
        }
      }
    }

    const boxes = fields.flatMap((f) => f.widgets.map((w) => w.box));
    const runs = buildRuns(items, boxes);
    const title = documentTitle(runs, typeof info.Title === "string" ? info.Title : "", opts.fileName);
    const lang = documentLang(typeof info.Language === "string" ? info.Language : "", runs.map((r) => r.text).join(" "));
    const built = found ? { fields: [], bindings: [] } : buildFields(fields, runs, title);
    const { page, blockBoxes } = buildPage(runs, { title, lang, formCount: built.fields.length ? 1 : 0 });
    const reading: PdfReading = { page, bindings: built.bindings, blockBoxes, pages: pages.map((p) => ({ width: p.width, height: p.height })) };
    if (found) reading.problem = found;
    else {
      const structure: FormStructure = {
        fingerprint: await fingerprint(PDF_URL, built.fields),
        url: PDF_URL,
        lang,
        title,
        fields: built.fields,
      };
      reading.structure = structure;
    }
    return reading;
  } finally {
    await close();
  }
}
