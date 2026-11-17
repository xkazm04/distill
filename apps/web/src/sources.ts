import { looksLikeHtml, textToHtml } from "./ui/dom";
import type { Tab } from "./ui";

export const DEMOS: { id: string; title: string; blurb: string; tab: Tab; file: string }[] = [
  { id: "form", title: "A form in Czech", blurb: "Fill it in step by step, in English.", tab: "wayfill", file: "form.html" },
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

export function fromPaste(input: string): Loaded {
  const html = looksLikeHtml(input) ? input : textToHtml(input);
  return { html, url: "https://pasted.local/", name: "Pasted page" };
}
