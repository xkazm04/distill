// The PDF side of Wayfill. A PDF form is read into the engine's own wire types (FormStructure, PageModel) and filled
// from FormValues, so the shared UI and the AI tasks need nothing new. Everything here is package-internal: the wire
// contract stays packages/engine/src/types.ts.
import type { FormStructure, PageModel } from "@distill/engine";

/**
 * The address every PDF form carries in FormStructure.url and PageModel.url, and the base of its fingerprint. Neutral
 * on purpose: the file name can hold a person's name ("zadost_Novak.pdf"), so it never goes into anything that can
 * reach a prompt, Firestore or the agent.
 */
export const PDF_URL = "pdf://local/";

/** A rectangle on a page, in the page's own PDF units (points, origin bottom-left). `page` is 0-based. */
export interface Box {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Why a PDF cannot be filled, in plain words for the person. The document may still be readable (the Read view works
 * for everything but `password` and `broken`).
 * - `flat`: no field that can hold an answer (a scan, or a form made for printing).
 * - `xfa`: an XFA form; its boxes are not ordinary PDF form fields.
 * - `encrypted`: the file is encrypted; Distill does not remove an office's protection.
 * - `locked`: signed, or locked against changes; changing it would break the signature.
 * - `password`: the file needs a password to open at all.
 * - `broken`: not a PDF that can be read (or changed).
 */
export type PdfProblemKind = "flat" | "xfa" | "encrypted" | "locked" | "password" | "broken";

export interface PdfProblem {
  kind: PdfProblemKind;
  title: string;
  detail: string;
}

export type DatePart = "day" | "month" | "year";

/**
 * How one field of the FormStructure is made of PDF fields:
 * - `text`: one text field (also a comb field: one field, one box per character);
 * - `chars`: a row of one-character text fields read as one answer (a postcode in five boxes);
 * - `date`: three text fields for day, month and year;
 * - `checkbox`, `radio`, `choice` (a dropdown or a list).
 */
export interface PdfBinding {
  fieldId: string;
  via: "text" | "chars" | "date" | "checkbox" | "radio" | "choice";
  /** The PDF fields (fully qualified names) in order: the pieces of a date or of a row of boxes. */
  names: string[];
  /** For `date`: the part each of `names` holds. */
  parts?: DatePart[];
  /** Every widget of these fields, for outlining them on the page. */
  boxes: Box[];
}

export interface PdfReading {
  /** Present when the document opened, also when it cannot be filled: the Read view still works. */
  page: PageModel;
  /** Present only when the PDF can be filled. Structure only: never a value the file holds. */
  structure?: FormStructure;
  bindings: PdfBinding[];
  /** Why the PDF cannot be filled. Absent when `structure` is present. */
  problem?: PdfProblem;
  /** Where each block of `page` sits, for pointing at it in the original. */
  blockBoxes: Record<string, Box>;
  /** Page sizes in PDF units, in page order. */
  pages: { width: number; height: number }[];
}

/** The part of pdf.js this package uses. The web app passes the browser build (with its worker); tests the legacy
 *  build for Node. */
export interface PdfJs {
  getDocument(src: { data: Uint8Array; useWasm?: boolean; enableXfa?: boolean; stopAtErrors?: boolean; verbosity?: number }): {
    promise: Promise<PdfJsDocument>;
    destroy(): Promise<void>;
  };
}

/** The slice of pdf.js's PDFDocumentProxy that is read here. */
export interface PdfJsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfJsPage>;
  getMetadata(): Promise<{ info: object }>;
}

export interface PdfJsPage {
  view: number[];
  getTextContent(): Promise<{ items: unknown[] }>;
}

/** A text item as pdf.js gives it. */
export interface PdfJsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
