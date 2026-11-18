// The guide library as the shared UI sees it (guides/README.md). The web app loads the whole library from its own
// origin (guides/library.json, one fixed address); the extension carries it inside its bundle. Either way the guide
// for a form is found on the device: looking one up sends nothing about the page the person is on.
//
// A guide is not an AI result, so these words never say "on this device" or "in the cloud". And a guide is shown as
// checked only when a person checked it: a draft says it is a draft, the demo guide says it is an example.
import type { FormGuide } from "@distill/engine";
import { engine } from "./engine";

export interface GuideLibrary {
  /** Every guide that passed the door. Loaded once; never rejects (a library that cannot be loaded is empty). */
  load(): Promise<FormGuide[]>;
  /** Drafts are matched too. A developer's switch (VITE_GUIDE_DRAFTS=1 in a dev build); never on in a build people use. */
  drafts: boolean;
}

/** A library from a source of raw guides. Every guide passes engine.parseLibrary (the door) before it is used. */
export function guideLibrary(source: () => Promise<unknown>, opts: { drafts?: boolean } = {}): GuideLibrary {
  let loaded: Promise<FormGuide[]> | null = null;
  return {
    drafts: opts.drafts === true,
    load: () => (loaded ??= source().then(
      (raw) => {
        const { guides, rejected } = engine.parseLibrary(raw);
        for (const r of rejected) console.warn(`[distill] guide ${r.id} left out: ${r.problems.join("; ")}`);
        return guides;
      },
      (e: unknown) => {
        console.warn("[distill] the guide library could not be loaded:", e);
        loaded = null; // try again next time
        return [];
      },
    )),
  };
}

/**
 * The web app's source: one GET of the whole library from the app's own origin. The address is fixed and the request
 * carries no body, no cookies and no referrer, so it says nothing about the form on screen; matching happens after.
 */
export function fetchedLibrary(url: string, fetchFn: typeof fetch = (...a) => fetch(...a)): () => Promise<unknown> {
  return async () => {
    const res = await fetchFn(url, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
}

export type GuideKind = "reviewed" | "draft" | "demo";
export const guideKind = (g: FormGuide): GuideKind => (g.demo === true ? "demo" : g.status);

/** The chip in the guide's toolbar: what kind of guide this is. Never an AI chip. */
export function guideChip(g: FormGuide): { text: string; title: string } {
  switch (guideKind(g)) {
    case "reviewed":
      return { text: "Checked guide", title: "Written from the official instructions and checked by a person. No AI made these steps." };
    case "demo":
      return { text: "Example guide", title: "An example of a guide from Distill's library, for a made-up form. No AI made these steps." };
    default:
      return { text: "Draft guide, not checked", title: "No person has checked this guide yet. No AI made these steps." };
  }
}

/** The words under the toolbar that say what the guide rests on. `link` is the part shown as a link to the instructions. */
export function guideSource(g: FormGuide): { before: string; link?: string; after: string; by?: string } {
  switch (guideKind(g)) {
    case "reviewed":
      return {
        before: "Checked against ",
        link: `${g.authority.nameEn}'s instructions`,
        after: ` on ${g.reviewedOn ?? ""}.`,
        by: g.reviewer ? `Checked by ${g.reviewer}.` : undefined,
      };
    case "demo":
      return { before: "An example guide for Distill's made-up demo form. No office issues this form, so no official instructions were checked.", after: "" };
    default:
      return {
        before: "This guide is a draft. No person has checked it against the official instructions yet, so do not rely on it. It was written from ",
        link: `${g.authority.nameEn}'s instructions`,
        after: ` on ${g.draftedOn}.`,
      };
  }
}

/** The notice when the form changed since the guide was written: `n` fields of the form on screen are new or changed. */
export function guideChangedText(g: FormGuide, n: number): string {
  const when = g.status === "reviewed" && g.reviewedOn ? `checked on ${g.reviewedOn}` : `written on ${g.draftedOn}`;
  return n === 1
    ? `This form changed since the guide was ${when}: 1 of its fields is new or different, so its step is not from the guide.`
    : `This form changed since the guide was ${when}: ${n} of its fields are new or different, so their steps are not from the guide.`;
}

/** The note on a step that is not from the guide (the form changed after the guide was written). */
export function notFromGuideText(g: FormGuide): string {
  return g.status === "reviewed" ? "This step is not from the checked guide: this part of the form changed after it was checked." : "This step is not from the guide: this part of the form changed after it was written.";
}

const LANG_NAMES: Record<string, string> = { cs: "Czech", en: "English", uk: "Ukrainian", sk: "Slovak", de: "German" };

/** The caption over a step's quote. */
export function quoteCaption(g: FormGuide, lang: string): string {
  const inLang = LANG_NAMES[lang] ? ` (in ${LANG_NAMES[lang]})` : "";
  return guideKind(g) === "demo" ? `The demo form's own words${inLang}` : `The official instructions say${inLang}`;
}
