// The guide library in the form guide: a reviewed guide is shown with its own label and source link and no AI chip; a
// draft is never shown as checked; a changed form says so and only its new fields go to the model; the order is
// library guide, the person's saved guide, the model, the form's own labels; and looking a guide up sends nothing
// about the form (one fixed GET of the whole library, no body, no cookies, no referrer).
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldStructure, FormGuide, FormStructure, FormValues, UserSettingsDoc, Wizard } from "@distill/engine";
import { fingerprint, guideTextDigest } from "@distill/engine";
import { AiError, type RunResult } from "../ai";

const runMock = vi.hoisted(() => vi.fn());
const configured = vi.hoisted(() => ({ on: false }));
const getFormGuide = vi.hoisted(() => vi.fn());
const saveFormGuide = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ai")>()), run: runMock }));
vi.mock("../firebase", async (importOriginal) => ({ ...(await importOriginal<typeof import("../firebase")>()), isFirebaseConfigured: () => configured.on }));
vi.mock("./data", async (importOriginal) => ({ ...(await importOriginal<typeof import("./data")>()), getFormGuide, saveFormGuide }));

const { Wayfill } = await import("./Wayfill");
const { fetchedLibrary, guideLibrary } = await import("./guides");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root!.render(node); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const q = (testId: string) => el.querySelector(`[data-testid="${testId}"]`);
const qa = (testId: string) => [...el.querySelectorAll(`[data-testid="${testId}"]`)];
const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
async function click(b: Element | null | undefined): Promise<void> {
  expect(b, "button").toBeTruthy();
  await act(async () => { (b as HTMLButtonElement).click(); });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  runMock.mockReset();
  getFormGuide.mockReset();
  saveFormGuide.mockClear();
  configured.on = false;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  el.remove();
  vi.restoreAllMocks();
});

const settings: UserSettingsDoc = { readingLevel: "plain", readerLang: "en", recastEnabled: true };
const model = { state: "unavailable" as const, progress: null, download: async () => undefined, refresh: async () => undefined };
const ok = <T,>(data: T): RunResult<T> => ({ data, source: "in_cloud", ms: 900, reason: "Runs in the cloud." });

const URL_FORM = "https://ipc.gov.cz/formular/zmena";
const FIELDS: FieldStructure[] = [
  { fieldId: "prijmeni", kind: "text", label: "Příjmení", required: true },
  { fieldId: "jmeno", kind: "text", label: "Jméno", required: true },
  { fieldId: "obec", kind: "text", label: "Obec", required: true },
];

async function form(fields = FIELDS, url = URL_FORM): Promise<FormStructure> {
  return { fingerprint: await fingerprint(url, fields), url, lang: "cs", title: "Oznámení", fields };
}

async function guide(over: Partial<FormGuide> = {}): Promise<FormGuide> {
  const step = (l: "en" | "uk") => [
    {
      stepId: "name", fieldIds: ["prijmeni", "jmeno"],
      question: l === "en" ? "Your surname and first name" : "Ваше прізвище та ім'я",
      explanation: l === "en" ? "As in your passport." : "Як у паспорті.",
      official: { text: "Uveďte jméno a příjmení podle cestovního dokladu.", lang: "cs" },
    },
    { stepId: "town", fieldIds: ["obec"], question: l === "en" ? "Your town" : "Ваше місто", explanation: l === "en" ? "Where you live now." : "Де ви живете зараз." },
  ];
  const g: FormGuide = {
    guideVersion: 1, id: "cz/zmena", status: "reviewed",
    authority: { name: "Ministerstvo vnitra", nameEn: "the Ministry of the Interior" },
    formName: { cs: "Oznámení změny", en: "Report of a change", uk: "Повідомлення про зміну" },
    formLang: "cs",
    officialFormUrl: "https://ipc.gov.cz/formular/zmena",
    instructionsUrl: "https://ipc.gov.cz/navod",
    draftedOn: "2026-11-18", reviewer: "Jana Testová", reviewedOn: "2026-11-20",
    match: { format: "html", fingerprints: [(await form()).fingerprint], urls: [URL_FORM], fields: FIELDS.map(({ fieldId, kind, label }) => ({ fieldId, kind, label })) },
    wizards: { en: { notes: ["Fill the form in Czech."], steps: step("en") }, uk: { notes: ["Заповнюйте чеською."], steps: step("uk") } },
    ...over,
  };
  // A reviewed test guide carries the text lock of its own text, as the review commit would.
  if (g.status === "reviewed" && !("reviewedLangs" in over)) g.reviewedLangs = ["en", "uk"];
  if (g.status === "reviewed" && !("reviewedText" in over)) g.reviewedText = guideTextDigest(g, g.reviewedLangs);
  return g;
}
const asDraft = (g: FormGuide): FormGuide => { const d = { ...g, status: "draft" as const }; delete d.reviewer; delete d.reviewedOn; delete d.reviewedText; delete d.reviewedLangs; return d; };

function fakeHost(structure: FormStructure) {
  return {
    label: () => "Test",
    getPage: vi.fn(),
    getForm: vi.fn(async () => structure),
    readValues: vi.fn(async () => ({})),
    writeValues: vi.fn(async (_s: FormStructure, v: FormValues) => ({ written: Object.keys(v), failed: [] })),
    highlight: vi.fn(async () => undefined),
    showOriginal: vi.fn(async () => undefined),
  };
}
const lib = (guides: unknown[], drafts = false) => guideLibrary(async () => ({ version: 1, guides }), { drafts });
const view = (s: FormStructure, guides?: ReturnType<typeof lib>, readerLang = "en") =>
  <Wayfill host={fakeHost(s)} settings={{ ...settings, readerLang }} model={model as never} onShowOriginal={() => undefined} guides={guides} />;
const text = () => el.textContent ?? "";

describe("a reviewed guide from the library", () => {
  it("is shown with its own label, who it was checked against and when, the link, and no AI chip", async () => {
    const g = await guide();
    await render(view(await form(), lib([g])));
    expect(q("guide-chip")?.textContent).toBe("Checked guide");
    expect(q("guide-chip")?.getAttribute("data-kind")).toBe("reviewed");
    expect(q("guide-source")?.textContent).toContain("Checked against the Ministry of the Interior's instructions on 2026-11-20. Checked by Jana Testová.");
    const link = q("guide-instructions") as HTMLAnchorElement;
    expect(link.textContent).toBe("the Ministry of the Interior's instructions");
    expect(link.getAttribute("href")).toBe("https://ipc.gov.cz/navod");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    // Not an inference result: no device/cloud chip, no "No AI used" chip, and no model was asked.
    expect(qa("source-chip")).toHaveLength(0);
    expect(qa("origin-chip")).toHaveLength(0);
    expect(text()).not.toMatch(/On this device|In the cloud/);
    expect(runMock).not.toHaveBeenCalled();
    expect(saveFormGuide).not.toHaveBeenCalled();
    // The guide's steps, notes and the official words in their own language.
    expect(q("wf-step")?.querySelector("h3")?.textContent).toBe("Your surname and first name");
    expect(q("guide-notes")?.textContent).toBe("Fill the form in Czech.");
    const quote = q("guide-quote")!;
    expect(quote.querySelector("figcaption")?.textContent).toBe("The official instructions say (in Czech):");
    expect(quote.querySelector("blockquote")?.getAttribute("lang")).toBe("cs");
    expect(quote.querySelector("blockquote")?.textContent).toBe("Uveďte jméno a příjmení podle cestovního dokladu.");
    expect(q("guide-changed")).toBeNull();
    expect(q("not-from-guide")).toBeNull();
  });

  it("speaks Ukrainian to a Ukrainian reader, and is not used for a language the library does not carry", async () => {
    const g = await guide();
    await render(view(await form(), lib([g]), "uk"));
    expect(q("wf-step")?.querySelector("h3")?.textContent).toBe("Ваше прізвище та ім'я");
    expect(q("guide-chip")?.textContent).toBe("Checked guide");

    runMock.mockResolvedValue(ok({ steps: [{ stepId: "a", fieldIds: ["prijmeni"], question: "Nachname?", explanation: "" }] }));
    await render(<p>reset</p>);
    await render(view(await form(), lib([g]), "de"));
    expect(q("guide-chip")).toBeNull();
    expect(q("source-chip")?.textContent).toContain("In the cloud");
  });

  it("signed off for English only: English readers get the checked guide, Ukrainian readers the normal path", async () => {
    const g = await guide({ reviewer: "Test Reviewer (fixture) (cs, en)", reviewedLangs: ["en"] });
    await render(view(await form(), lib([g]), "en"));
    expect(q("guide-chip")?.textContent).toBe("Checked guide");
    expect(q("guide-chip")?.getAttribute("data-kind")).toBe("reviewed");
    expect(q("wf-step")?.querySelector("h3")?.textContent).toBe("Your surname and first name");

    runMock.mockRejectedValue(new AiError("busy"));
    await render(<p>reset</p>);
    await render(view(await form(), lib([g]), "uk"));
    expect(q("guide-chip")).toBeNull();
    expect(q("guide-source")).toBeNull();
    expect(text()).not.toContain("Ваше прізвище та ім'я");
    expect(q("origin-chip")?.textContent).toBe("No AI used");
  });

  it("is refused at the door when it carries HTML or a script address, and the normal path runs instead", async () => {
    const g = await guide();
    g.wizards.en.steps[0]!.explanation = "<b>As in your passport.</b>";
    runMock.mockRejectedValue(new AiError("busy"));
    await render(view(await form(), lib([g])));
    expect(q("guide-chip")).toBeNull();
    expect(q("origin-chip")?.textContent).toBe("No AI used");
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).toMatch(/guide cz\/zmena left out/);
  });
});

describe("a draft is never shown as checked", () => {
  it("is not used at all unless drafts are switched on", async () => {
    runMock.mockRejectedValue(new AiError("busy"));
    await render(view(await form(), lib([asDraft(await guide())])));
    expect(q("guide-chip")).toBeNull();
    expect(q("guide-source")).toBeNull();
    expect(q("origin-chip")?.textContent).toBe("No AI used");
  });

  it("with drafts on (a developer's build): labelled a draft, in warning colours, with no 'checked' wording", async () => {
    await render(view(await form(), lib([asDraft(await guide())], true)));
    expect(q("guide-chip")?.textContent).toBe("Draft guide, not checked");
    expect(q("guide-chip")?.className).toContain("chip-guide-draft");
    const source = q("guide-source")!;
    expect(source.className).toContain("wf-guide-draft");
    expect(source.textContent).toContain("This guide is a draft. No person has checked it against the official instructions yet, so do not rely on it.");
    expect(source.textContent).not.toMatch(/Checked against|Checked by|Checked guide/);
    expect(text()).not.toContain("Checked guide");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("the demo guide is an example, never checked", async () => {
    const g = asDraft(await guide({ demo: true }));
    g.match = { ...g.match, urls: ["/demo/guided-form.html"], fingerprints: ["0".repeat(64)] };
    await render(view(await form(FIELDS, "https://distill-hybrid-ai.web.app/demo/guided-form.html"), lib([g])));
    expect(q("guide-chip")?.textContent).toBe("Example guide");
    expect(q("guide-source")?.textContent).toContain("An example guide for Distill's made-up demo form. No office issues this form, so no official instructions were checked.");
    expect(q("guide-source")?.textContent).not.toMatch(/Checked against/);
    expect(q("guide-quote")?.querySelector("figcaption")?.textContent).toBe("The demo form's own words (in Czech):");
  });
});

describe("a form that changed since the guide was checked", () => {
  const changed: FieldStructure[] = [...FIELDS, { fieldId: "telefon", kind: "tel", label: "Telefon", required: false }];

  it("says so, keeps the guide's steps for the unchanged fields, and asks the model about the new field only", async () => {
    runMock.mockResolvedValue(ok({ steps: [{ stepId: "phone", fieldIds: ["telefon"], question: "Your phone number", explanation: "Optional." }] }));
    await render(view(await form(changed), lib([await guide()])));
    expect(q("guide-chip")?.textContent).toBe("Checked guide");
    expect(q("guide-changed")?.textContent).toBe("This form changed since the guide was checked on 2026-11-20: 1 of its fields is new or different, so its step is not from the guide.");
    // The model saw a structure with the new field only.
    expect(runMock).toHaveBeenCalledTimes(1);
    const ctx = runMock.mock.calls[0]![3] as { structure: FormStructure };
    expect(ctx.structure.fields.map((f) => f.fieldId)).toEqual(["telefon"]);
    expect(String(runMock.mock.calls[0]![1])).not.toContain("Příjmení");
    expect(saveFormGuide).not.toHaveBeenCalled();
    // Steps: the guide's two, then the model's. The guide's steps carry no AI chip; the model's step says so and shows
    // where it ran.
    expect([...el.querySelectorAll(".wf-q")].map((x) => x.textContent)).toEqual(["Your surname and first name", "Your town", "Your phone number"]);
    expect(q("not-from-guide")).toBeNull();
    expect(qa("source-chip")).toHaveLength(0);
    await click(button("Skip"));
    await click(button("Skip"));
    expect(q("wf-step")?.querySelector("h3")?.textContent).toBe("Your phone number");
    expect(q("not-from-guide")?.textContent).toContain("This step is not from the checked guide: this part of the form changed after it was checked.");
    expect(q("not-from-guide")?.querySelector("[data-testid=source-chip]")?.textContent).toContain("In the cloud");
  });

  it("without AI the new field gets the form's own label, marked as not from the guide", async () => {
    runMock.mockRejectedValue(new AiError("busy"));
    await render(view(await form(changed), lib([await guide()])));
    await click(button("Skip"));
    await click(button("Skip"));
    expect(q("wf-step")?.querySelector("h3")?.textContent).toBe('Fill in: "Telefon"');
    expect(q("not-from-guide")?.querySelector("[data-testid=origin-chip]")?.textContent).toBe("No AI used");
  });

  it("below half overlap the guide is not used", async () => {
    runMock.mockRejectedValue(new AiError("busy"));
    const mostlyNew: FieldStructure[] = [FIELDS[0]!, ...["a", "b", "c"].map((id): FieldStructure => ({ fieldId: id, kind: "text", label: id, required: false }))];
    await render(view(await form(mostlyNew), lib([await guide()])));
    expect(q("guide-chip")).toBeNull();
  });
});

describe("precedence: library guide, then the person's saved guide, then the model, then the form's own labels", () => {
  const saved = (s: FormStructure): { structure: FormStructure; wizard: Wizard; updatedAt: string } => ({
    structure: s, updatedAt: "2026-11-01", wizard: { fingerprint: s.fingerprint, readerLang: "en", steps: s.fields.map((f) => ({ stepId: f.fieldId, fieldIds: [f.fieldId], question: `Saved: ${f.label}`, explanation: "" })) },
  });

  it("a matching reviewed guide wins: the saved guide is not even read, the model not asked", async () => {
    configured.on = true;
    const s = await form();
    getFormGuide.mockResolvedValue(saved(s));
    await render(view(s, lib([await guide()])));
    expect(q("guide-chip")?.textContent).toBe("Checked guide");
    expect(getFormGuide).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it("no guide: the saved guide, then the model, then the labels", async () => {
    configured.on = true;
    const other = await form(FIELDS, "https://jiny.example/formular");
    getFormGuide.mockResolvedValueOnce(saved(other));
    await render(view(other, lib([await guide()])));
    expect(q("origin-chip")?.textContent).toBe("Saved guide (no AI used)");
    expect(runMock).not.toHaveBeenCalled();

    await render(<p>reset</p>);
    getFormGuide.mockResolvedValueOnce(null);
    runMock.mockResolvedValueOnce(ok({ steps: [{ stepId: "a", fieldIds: ["prijmeni"], question: "Model: surname", explanation: "" }] }));
    await render(view(other, lib([await guide()])));
    expect(q("source-chip")?.textContent).toContain("In the cloud");

    await render(<p>reset</p>);
    getFormGuide.mockResolvedValueOnce(null);
    runMock.mockRejectedValueOnce(new AiError("busy"));
    await render(view(other, lib([await guide()])));
    expect(q("origin-chip")?.textContent).toBe("No AI used");
  });
});

describe("looking a guide up sends nothing about the form", () => {
  it("one GET of the whole library at a fixed address, with no body, cookies or referrer, whatever the form", async () => {
    const LIB = "https://distill-hybrid-ai.web.app/guides/library.json";
    const g = await guide();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ version: 1, guides: [g] }), { status: 200 }));
    const guides = guideLibrary(fetchedLibrary(LIB, fetchSpy as unknown as typeof fetch));
    const a = await form();
    const b = await form([{ fieldId: "x", kind: "text", label: "Rodné číslo", required: true }], "https://other.example/private/path");
    await render(view(a, guides));
    expect(q("guide-chip")?.textContent).toBe("Checked guide");
    await render(<p>reset</p>);
    runMock.mockRejectedValue(new AiError("busy"));
    await render(view(b, guides));

    expect(fetchSpy).toHaveBeenCalledTimes(1); // loaded once, matched locally for both forms
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LIB);
    expect(init).toEqual({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-cache" });
    expect(init.body).toBeUndefined();
    const sent = JSON.stringify([url, init]);
    for (const s of [a, b]) {
      for (const secret of [s.fingerprint, s.url, new URL(s.url).pathname, ...s.fields.flatMap((f) => [f.fieldId, f.label])]) {
        expect(sent, secret).not.toContain(secret);
      }
    }
  });

  it("a library that cannot be loaded is empty: the normal path runs and the next form tries again", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { status: 503 }));
    const guides = guideLibrary(fetchedLibrary("https://x.example/guides/library.json", fetchSpy as unknown as typeof fetch));
    runMock.mockRejectedValue(new AiError("busy"));
    await render(view(await form(), guides));
    expect(q("origin-chip")?.textContent).toBe("No AI used");
    expect(await guides.load()).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
