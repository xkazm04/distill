import { looksLikeHtml, textToHtml } from "./ui/dom";
import type { Tab } from "./ui";

export const DEMOS: { id: string; title: string; blurb: string; tab: Tab; file: string }[] = [
  { id: "form", title: "A form in Czech", blurb: "Fill it in step by step, in English.", tab: "wayfill", file: "form.html" },
  { id: "guide", title: "A form with a ready guide", blurb: "Steps from the guide library, written in advance: no AI runs.", tab: "wayfill", file: "guided-form.html" },
  { id: "article", title: "A cluttered article", blurb: "Read only the part that matters.", tab: "focus", file: "article.html" },
  { id: "pricing", title: "A pricing page", blurb: "Compare the plans in a clearer layout.", tab: "recast", file: "pricing.html" },
];

export interface Loaded { html: string; url: string; name: string }

export async function loadDemo(id: string): Promise<Loaded | null> {
  const d = DEMOS.find((x) => x.id === id);
  if (!d) return null;
  const res = await fetch(`${import.meta.env.BASE_URL}demo/${d.file}`);
  if (!res.ok) throw new Error("Could not open the example page.");
  return { html: await res.text(), url: new URL(`demo/${d.file}`, location.href).href, name: d.title };
}

/** A PDF the person opened from their own device. The bytes stay in this tab's memory: never uploaded, never stored. */
export interface OpenedPdf { bytes: Uint8Array; name: string }

/** The largest PDF Distill opens: forms are small, and the whole file is held in memory. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** Reads a chosen file as a PDF. Rejects in plain words when it is too large or is not a PDF. Nothing is sent anywhere. */
export async function readPdfFile(file: File): Promise<OpenedPdf> {
  if (file.size > MAX_PDF_BYTES) throw new Error("This file is larger than 50 MB. Distill opens PDF forms up to 50 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) throw new Error("This file is not a PDF. Choose a PDF form.");
  return { bytes, name: file.name || "form.pdf" };
}

export function fromPaste(input: string): Loaded {
  const html = looksLikeHtml(input) ? input : textToHtml(input);
  return { html, url: "https://pasted.local/", name: "Pasted page" };
}
