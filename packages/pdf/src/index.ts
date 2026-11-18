// @distill/pdf: Wayfill for PDF forms. Reads a fillable PDF into the engine's FormStructure and PageModel, fills a copy
// from FormValues and confirms every write by parsing the new bytes. Loaded by the web app only when a person opens a
// PDF. Values never leave the device: nothing here fetches or uploads anything.
export { PDF_URL, type Box, type DatePart, type PdfBinding, type PdfJs, type PdfJsDocument, type PdfProblem, type PdfProblemKind, type PdfReading } from "./types.js";
export { readPdf, openWithPdfJs, PdfOpenError, PROBLEMS } from "./read.js";
export { fillPdf, readPdfValues, parseDate, type FontSource } from "./fill.js";
export { ProtectionError } from "./protect.js";
export { cleanLabel, isCryptic, shortName } from "./labels.js";
