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
 * - `flat`: no field that can hold an answer, and no place to write on the printed page was found either.
 * - `scan`: the pages are pictures (a scan or a photo) with no text Distill can read; finding where to write on a
 *   picture needs text recognition, which Distill does not do yet.
 * - `xfa`: an XFA form; its boxes are not ordinary PDF form fields.
 * - `encrypted`: the file is encrypted and its permissions do not allow filling in forms (or it uses a kind of
 *   encryption other than the standard password one); Distill does not remove an office's protection.
 * - `locked`: signed, or locked against changes; changing it would break the signature.
 * - `password`: the file needs a password to open at all.
 * - `broken`: not a PDF that can be read (or changed).
 */
export type PdfProblemKind = "flat" | "scan" | "xfa" | "encrypted" | "locked" | "password" | "broken";

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
 * - `checkbox`, `radio`, `choice` (a dropdown or a list);
 * - `print`: a place on a print-only page (no form field at all): the answer is drawn onto a copy of the page. `names`
 *   is empty; `print` says where and how.
 */
export interface PdfBinding {
  fieldId: string;
  via: "text" | "chars" | "date" | "checkbox" | "radio" | "choice" | "print";
  /** The PDF fields (fully qualified names) in order: the pieces of a date or of a row of boxes. */
  names: string[];
  /** For `date`: the part each of `names` holds. */
  parts?: DatePart[];
  /** Every widget of these fields, for outlining them on the page. For `print`, where the answer will be written. */
  boxes: Box[];
  /** For `print` only. */
  print?: PrintSpot;
}

/**
 * A place to write on a print-only page, found by Distill from what the page prints and draws. A guess, and treated as
 * one: every answer drawn there is checked by reading the saved copy back with pdf.js.
 * - `line`: text on one or more writing lines (a dotted or underscored leader, a ruled line, the free part of a box).
 *   Each area is one line; a long answer continues on the next.
 * - `cells`: one character per box (a row of character boxes, or several rows read as one answer).
 * - `tick`: a cross inside a square.
 * - `date`: three writing places for day, month and year (".... / .... / ....").
 */
export interface PrintSpot {
  kind: "line" | "cells" | "tick" | "date";
  /** Where text goes: one area per line, per character box, per date part, or the square. In page units. */
  areas: Box[];
  /** For `line` and `date`: the baseline of each area. */
  baselines?: number[];
  /** What the place was found from: a leader printed as text, a ruled line, a drawn box, a row of character boxes,
   *  a drawn square, or a box printed as a character (☐). */
  from: "leader" | "rule" | "box" | "cells" | "square" | "glyph";
  /** For a `line` whose label asks for a date ("Datum narození"): the answer is written as DD.MM.YYYY. */
  asDate?: true;
  /** `printed`: the label is the text printed for this place (beside, above or inside it). `position`: no label could
   *  be told with confidence, so the field is named by where it is ("the line under ..."). */
  label: "printed" | "position";
}

export interface PdfReading {
  /** Present when the document opened, also when it cannot be filled: the Read view still works. */
  page: PageModel;
  /** Present only when the PDF can be filled. Structure only: never a value the file holds. */
  structure?: FormStructure;
  bindings: PdfBinding[];
  /** Why the PDF cannot be filled. Absent when `structure` is present. */
  problem?: PdfProblem;
  /** True when the PDF has no form fields and the places to write on were found from the printed page (PrintSpot).
   *  The person is told so, always, in PRINT_ONLY_NOTE's words. */
  printOnly?: true;
  /** True when the file is protected by its author (encrypted, opens without a password, permissions allow filling
   *  in forms). Its filled copy is encrypted again with the same permissions. */
  protected?: true;
  /** Where each block of `page` sits, for pointing at it in the original. */
  blockBoxes: Record<string, Box>;
  /** Page sizes in PDF units, in page order. */
  pages: { width: number; height: number }[];
}

/** The part of pdf.js this package uses. The web app passes the browser build (with its worker); tests the legacy
 *  build for Node. */
export interface PdfJs {
  /** pdf.js's operator codes (the module's own OPS table). Without it, only places printed as text are found. */
  OPS?: Record<string, number>;
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
  rotate?: number;
  getTextContent(params?: { includeMarkedContent?: boolean }): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
}

/** A text item as pdf.js gives it. */
export interface PdfJsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
