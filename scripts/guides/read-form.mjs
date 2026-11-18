// Reads a real form the way the product does, for the authoring scripts: a web page through the engine's extractForm
// (in happy-dom, with the page's scripts off), a PDF through @distill/pdf's readPdf (pdf.js and pdf-lib). Used by
// `npm run guide:new` and `npm run guides:drift`. Only these scripts touch the network, and only to fetch the form.
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

/**
 * Reads the form at `source`. Returns { format: "html" | "pdf", structure, address (html: origin + path),
 * problem (pdf: why it cannot be filled), forms (html: how many forms the page has) }.
 * `as` overrides the address used for an html source read from a local file (its fingerprint holds the address).
 */
export async function readForm(source, { formIndex = 0, as } = {}) {
  const { bytes, type, finalUrl } = await fetchSource(source);
  if (looksPdf(bytes) || /pdf/i.test(type)) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const { readPdf } = await pdfPackage();
    const r = await readPdf(bytes, { pdfjs, fileName: source.split(/[\\/]/).pop() });
    return { format: "pdf", structure: r.structure ?? null, problem: r.problem ?? null, page: r.page, bytes: bytes.length };
  }
  const { Window } = await import("happy-dom");
  const url = as ?? finalUrl ?? source;
  const w = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  try {
    w.document.write(new TextDecoder("utf-8").decode(bytes));
    await w.happyDOM.waitUntilComplete();
    const e = await engine();
    const forms = (await load("packages/engine/src/form.ts")).listForms(w.document).length;
    const structure = await e.extractForm(w.document, url, formIndex);
    return { format: "html", structure, address: e.formAddress(url), forms };
  } finally {
    await w.happyDOM.close();
  }
}
