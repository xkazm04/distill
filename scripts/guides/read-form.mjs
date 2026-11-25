// Reads a real form the way the product does, for the authoring scripts: a web page through the engine's extractForm
// (in happy-dom, with the page's scripts off), a PDF through @distill/pdf's readPdf (pdf.js and pdf-lib). Used by
// `npm run guide:new` and `npm run guides:drift`. Only these scripts touch the network, and only to fetch the form.
// readInstructions reads the official instructions a guide quotes into text blocks the same way (a PDF's page model, a
// web page through the engine's page reader), for `npm run guides:review` and `npm run guides:drift`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runnerImport } from "vite";
import { REPO_ROOT } from "./library.mjs";

const load = async (rel) => (await runnerImport(join(REPO_ROOT, rel), { configFile: false, logLevel: "error" })).module;
export const engine = () => load("packages/engine/src/index.ts");
const pdfPackage = () => load("packages/pdf/src/index.ts");

const UA = "Mozilla/5.0 (compatible; distill-guide-tool; +https://github.com/xkazm04/distill)";

const isUrl = (s) => /^https?:\/\//i.test(s);

/** The bytes and content type of a source: an https address (fetched, no cookies) or a local file. */
async function fetchSource(source) {
  if (!isUrl(source)) {
    const bytes = new Uint8Array(readFileSync(source));
    return { bytes, type: source.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/html", finalUrl: null };
  }
  const res = await fetch(source, { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" } });
  if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "", finalUrl: res.url };
}

const looksPdf = (bytes) => new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * What identifies a web form as published, whatever reads it: each control's tag, type, id and name, and the form's
 * text, in order, with whitespace collapsed. Values are left out (a page may come pre-filled or carry a token). A
 * change here is a change to the form; a change to the labels read from the same form is a change to the reader.
 */
function formSource(form) {
  const controls = [...form.querySelectorAll("input, select, textarea, button")]
    .map((el) => [el.tagName.toLowerCase(), el.getAttribute("type") ?? "", el.id ?? "", el.getAttribute("name") ?? ""].join("|"));
  return sha256(JSON.stringify({ controls, text: (form.textContent ?? "").replace(/\s+/g, " ").trim() }));
}

/**
 * Reads the form at `source`. Returns { format: "html" | "pdf", structure, address (html: origin + path),
 * problem (pdf: why it cannot be filled), forms (html: how many forms the page has), reader (the reader's version,
 * FORM_READER or PDF_READER), source (sha-256 of the form as published: a PDF's bytes, a web form's controls and text),
 * printOnly (pdf: no form field; places found from the printed page) }.
 * `as` overrides the address used for an html source read from a local file (its fingerprint holds the address).
 */
export async function readForm(source, { formIndex = 0, as } = {}) {
  const { bytes, type, finalUrl } = await fetchSource(source);
  if (looksPdf(bytes) || /pdf/i.test(type)) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { readPdf, PDF_READER } = await pdfPackage();
    const r = await readPdf(bytes, { pdfjs, fileName: source.split(/[\\/]/).pop() });
    return { format: "pdf", structure: r.structure ?? null, problem: r.problem ?? null, page: r.page, bytes: bytes.length, reader: PDF_READER, source: sha256(bytes), printOnly: r.printOnly === true };
  }
  const { Window } = await import("happy-dom");
  const url = as ?? finalUrl ?? source;
  const w = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  try {
    w.document.write(new TextDecoder("utf-8").decode(bytes));
    await w.happyDOM.waitUntilComplete();
    const e = await engine();
    const all = (await load("packages/engine/src/form.ts")).listForms(w.document);
    const structure = await e.extractForm(w.document, url, formIndex);
    const form = all[formIndex];
    return { format: "html", structure, address: e.formAddress(url), forms: all.length, reader: e.FORM_READER, source: form ? formSource(form) : sha256(bytes) };
  } finally {
    await w.happyDOM.close();
  }
}

/**
 * Reads the official instructions at `source` (an https address or a local file) into text blocks: a PDF through
 * @distill/pdf's readPdf (its page model), a web page through the engine's extractPage in happy-dom with the page's
 * scripts off. Returns { format: "html" | "pdf", title, blocks: [{ id, text }] }. Throws when the source cannot be
 * fetched or opened; a page that needs its scripts to show its text comes back with few or no blocks.
 */
export async function readInstructions(source) {
  const { bytes, type, finalUrl } = await fetchSource(source);
  if (looksPdf(bytes) || /pdf/i.test(type)) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { readPdf } = await pdfPackage();
    const r = await readPdf(bytes, { pdfjs, fileName: source.split(/[\\/]/).pop() });
    return { format: "pdf", title: r.page.title, blocks: r.page.blocks.map((b) => ({ id: b.id, text: b.text })) };
  }
  const { Window } = await import("happy-dom");
  const url = finalUrl ?? (isUrl(source) ? source : "https://local.invalid/instructions");
  const w = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  try {
    // Inline SVG is dropped first: it holds no instruction text, and happy-dom's parser stops for good at a <style>
    // inside an SVG (ipc.gov.cz's logo), which left the whole instructions page empty.
    w.document.write(new TextDecoder("utf-8").decode(bytes).replace(/<svg\b[\s\S]*?<\/svg>/gi, ""));
    await w.happyDOM.waitUntilComplete();
    const page = (await engine()).extractPage(w.document, url);
    return { format: "html", title: page.title, blocks: page.blocks.map((b) => ({ id: b.id, text: b.text })) };
  } finally {
    await w.happyDOM.close();
  }
}
