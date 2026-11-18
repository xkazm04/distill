// Reading a PDF the person opened: what it says (the page model) and, when it can be filled, its form (a
// FormStructure). Three kinds of PDF cannot be filled, and each is said in plain words rather than half-handled: a
// PDF with no fields (a scan or a print-only form), an XFA form, and a file that is signed or locked, or encrypted in a
// way that does not allow filling it in. A file encrypted with only an owner password whose permissions allow filling
// in forms is read and filled; its filled copy is protected again with the same permissions (protect.ts).
// pdf.js reads the text and the document facts; pdf-lib reads the form, as it is also what writes it.
import { PDFDocument } from "@cantoo/pdf-lib";
import { fingerprint, type FormStructure } from "@distill/engine";
import { lockReason, readFields } from "./fields.js";
import { fillAllowed, protectionOf } from "./protect.js";
import { readDrawing } from "./drawing.js";
import { buildFields } from "./labels.js";
import { readPrinted } from "./printed.js";
import { buildPage, buildRuns, documentLang, documentTitle, readItems, type Run } from "./text.js";
import { PDF_URL, type PdfJs, type PdfJsDocument, type PdfProblem, type PdfProblemKind, type PdfReading } from "./types.js";

const READ_ELSEWHERE = "You can still read it in Distill's other views.";

/** The plain words for each problem. Shown as they are; no AI rewrites them. */
export const PROBLEMS: Record<PdfProblemKind, { title: string; detail: string }> = {
  flat: {
    title: "This PDF has no fields to fill in",
    detail: `There are no boxes in the file that can hold an answer, and Distill found no lines or boxes printed on it to write on. Print it and fill it in by hand, or ask the office for a fillable version. ${READ_ELSEWHERE}`,
  },
  scan: {
    title: "This PDF is a scan, so Distill cannot fill it in yet",
    detail: `Its pages are pictures, with no text Distill can read, so Distill cannot tell where the answers go. Print it and fill it in by hand, or ask the office for a version made on a computer. ${READ_ELSEWHERE}`,
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

/**
 * Said above every step of a print-only PDF (one with no form fields, whose places to write on Distill found from the
 * printed page), always. Plain words, shown as they are.
 */
export const PRINT_ONLY_NOTE = {
  title: "Distill found the places to write on this form by itself",
  detail: "This PDF has no fields to fill in, so Distill looked at the printed page for the lines and boxes where answers go. It may have missed some, or misread one. Before you print or send the form, check every answer on the page itself.",
} as const;

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
    let isProtected = false;
    if (info.IsXFAPresent === true) found = problem("xfa");
    else {
      let doc: PDFDocument | null = null;
      try {
        // An encrypted file gets this far only when it opens without a password (pdf.js opened it above). It is
        // filled only when its own permissions allow filling in forms, and its copy is protected again (protect.ts).
        const raw = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
        const prot = protectionOf(raw);
        if (prot && (prot.filter !== "Standard" || !fillAllowed(prot))) found = problem("encrypted");
        else {
          doc = await PDFDocument.load(bytes, { password: "", preserveXFA: true, updateMetadata: false, throwOnInvalidObject: false });
          isProtected = prot !== null;
        }
      } catch (e) {
        const encrypted = (typeof info.EncryptFilterName === "string" && info.EncryptFilterName !== "") || /encrypt|password/i.test(String((e as Error)?.message));
        found = encrypted ? problem("encrypted") : problem("broken", "Distill can show this PDF but not change it.");
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
    let runs = buildRuns(items, boxes);
    // A box printed as a character (☐) is not part of the document's title.
    const titled = items.map((it) => ({ ...it, text: it.text.replace(/[☐□▢❏❐❑❒⬜]\s*/gu, "") })).filter((it) => it.text.trim());
    const title = documentTitle(titled.length === items.length && titled.every((t, i) => t.text === items[i]?.text) ? runs : buildRuns(titled, boxes), typeof info.Title === "string" ? info.Title : "", opts.fileName);
    const lang = documentLang(typeof info.Language === "string" ? info.Language : "", runs.map((r) => r.text).join(" "));
    let built: { fields: FormStructure["fields"]; bindings: PdfReading["bindings"] } = found ? { fields: [], bindings: [] } : buildFields(fields, runs, title);
    let printOnly = false;
    if (found?.kind === "flat") {
      // No form field: look for the places a person writes on the printed page.
      const printed = readPrinted(items, await readDrawing(pdf, opts.pdfjs.OPS), pages, title);
      if (printed.scan) found = problem("scan");
      else if (printed.fields.length) {
        found = undefined;
        printOnly = true;
        built = { fields: printed.fields, bindings: printed.bindings };
        // Text that sits where an answer goes is someone's answer: it stays out of the page model too.
        const answer = (it: Run) => printed.answers.some((a) => a.page === it.page && Math.abs(a.y - it.y) <= 0.35 * it.size && it.x0 >= a.x0 - 1 && it.x1 <= a.x1 + 1);
        if (printed.answers.length) runs = buildRuns(items.filter((it) => !answer(it)));
      }
    }
    const { page, blockBoxes } = buildPage(runs, { title, lang, formCount: built.fields.length ? 1 : 0 });
    const reading: PdfReading = { page, bindings: built.bindings, blockBoxes, pages: pages.map((p) => ({ width: p.width, height: p.height })) };
    if (printOnly) reading.printOnly = true;
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
      if (isProtected) reading.protected = true;
    }
    return reading;
  } finally {
    await close();
  }
}
