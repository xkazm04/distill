// Wayfill against a real page (a happy-dom document, filled through the engine as the web host does), tiger 2026-11-25
// lane C: the script check stops letters the form does not take (S3), the saved papers propose identity facts on the
// next form with no AI (L1), and "Put into Czech" runs on this device only, chosen by the person (L2).
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import healthInsuranceHtml from "../../../../packages/engine/test/corpus/health-insurance.html?raw";
import addressChangeHtml from "../../../../packages/engine/test/corpus/address-change.html?raw";
import * as eng from "@distill/engine";
import type { FormStructure, FormValues, UserSettingsDoc } from "@distill/engine";

vi.mock("../firebase", async (importOriginal) => ({ ...(await importOriginal<typeof import("../firebase")>()), isFirebaseConfigured: () => false }));
/** Every AI call, so a test can say none ran. AI is off: no step comes from a model. */
const runs = vi.hoisted(() => [] as string[]);
vi.mock("../ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ai")>();
  return {
    ...real,
    aiAvailable: () => false,
    run: async (task: string) => { runs.push(task); throw new Error("no AI in this test"); },
  };
});
const { Wayfill } = await import("./Wayfill");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement;
const pages: Window[] = [];
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root!.render(node); });
  await settle();
}
const q = (testId: string) => el.querySelector(`[data-testid="${testId}"]`);
const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const click = async (b: Element | null | undefined) => { expect(b).toBeTruthy(); await act(async () => { (b as HTMLElement).click(); }); await settle(); };
const stepInput = (): HTMLInputElement | null => q("wf-step")?.querySelector("input[id^='wf-'], textarea[id^='wf-']") as HTMLInputElement | null;
async function typeInto(input: HTMLInputElement, text: string) {
  await act(async () => {
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(2);
}

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  runs.length = 0;
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  el.remove();
  for (const p of pages.splice(0)) await p.happyDOM.close();
  delete (globalThis as { Translator?: unknown }).Translator;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settings = { readingLevel: "plain", readerLang: "en", recastEnabled: true } as UserSettingsDoc;
const model = { state: "unavailable" as const, progress: null, download: async () => undefined, refresh: async () => undefined };

/** A page in its own window, and a host over it that reads and writes through the engine, as the web host does. */
async function open(html: string, url = "https://forms.example/f") {
  const page = new Window({ url });
  pages.push(page);
  page.document.write(html);
  await page.happyDOM.waitUntilComplete();
  const doc = page.document as unknown as Document;
  const writes: FormValues[] = [];
  const host = {
    label: () => "form",
    getPage: vi.fn(),
    getForm: vi.fn(async () => eng.extractForm(doc, url)),
    readValues: vi.fn(async (s: FormStructure) => eng.readValues(doc, s)),
    writeValues: vi.fn(async (s: FormStructure, v: FormValues) => { writes.push(v); return eng.writeValues(doc, s, v); }),
    readErrors: vi.fn(async (s: FormStructure) => eng.readErrors(doc, s)),
    highlight: vi.fn(async () => undefined),
    showOriginal: vi.fn(async () => undefined),
  };
  return { doc, host, writes };
}
const wayfill = (host: unknown) => <Wayfill host={host as never} settings={settings} model={model as never} onShowOriginal={() => undefined} />;

const CZECH = `<!doctype html><html lang="cs"><head><title>Žádost</title></head><body><form>
  <p><label for="jmeno">Jméno</label><input id="jmeno"></p>
  <p><label for="ucel">Účel pobytu</label><input id="ucel"></p></form></body></html>`;

describe("the script check (S3)", () => {
  it("Cyrillic on a Czech form never reaches writeValues: the step stays, with one sentence beside the field", async () => {
    const { doc, host, writes } = await open(CZECH);
    await render(wayfill(host));
    await typeInto(el.querySelector("#wf-jmeno") as HTMLInputElement, "Олена");
    await click(button("Next"));
    expect(writes).toEqual([]);
    expect(host.writeValues).not.toHaveBeenCalled();
    const p = q("script-problem");
    expect(p?.getAttribute("role")).toBe("alert");
    expect(p?.textContent).toBe("Write this in Latin letters (A-Z), as in your passport: this form does not take Cyrillic letters.");
    expect(el.querySelector("#wf-jmeno")?.getAttribute("aria-describedby")).toContain("wf-jmeno-script");
    expect(q("wf-step")?.querySelector("h3")?.textContent).toContain("Jméno");
    expect((doc.querySelector("#jmeno") as HTMLInputElement).value).toBe("");

    // Czech letters with every accent are Latin: written and read back.
    await typeInto(el.querySelector("#wf-jmeno") as HTMLInputElement, "Šárka Ěščřžýáíéůú");
    expect(q("script-problem")).toBeNull();
    await click(button("Next"));
    expect((doc.querySelector("#jmeno") as HTMLInputElement).value).toBe("Šárka Ěščřžýáíéůú");
    expect(q("wf-step")?.querySelector("h3")?.textContent).toContain("Účel pobytu");
  });
});

/** Walks every step: types the answer for a step whose field is in `answers` and presses Next, else Skip. Returns what
 *  each step's input showed on entry. */
async function walk(answers: Record<string, string> = {}): Promise<Record<string, string>> {
  const seen: Record<string, string> = {};
  for (let i = 0; i < 30 && q("wf-step"); i++) {
    const input = stepInput();
    const id = input?.id.replace(/^wf-/, "") ?? "";
    if (input && (input.type === "text" || input.type === "tel" || input.type === "email" || input.tagName === "TEXTAREA")) seen[id] = input.value;
    if (input && answers[id] !== undefined) {
      await typeInto(input, answers[id] as string);
      await click(button("Next"));
    } else {
      await click(button("Skip"));
    }
  }
  return seen;
}

describe("papers by label (L1), with AI off", () => {
  it("fill health-insurance with Remember on, open address-change: surname, first name and phone are proposed, the address stays empty", async () => {
    expect((globalThis as { LanguageModel?: unknown }).LanguageModel).toBeUndefined();
    const first = await open(healthInsuranceHtml, "https://pojistovna.example/prihlaska");
    await render(wayfill(first.host));
    await click(el.querySelector("label.remember input"));
    await walk({ prijmeni: "Kovalenko", jmeno: "Olena", telefon: "777123456", email: "olena@example.cz" });
    expect(q("wf-done")).toBeTruthy();
    // Saved by fact, from what the page read back.
    expect(JSON.parse(localStorage.getItem("distill.papers.v1") ?? "{}")).toEqual({ surname: "Kovalenko", givenName: "Olena", phone: "777123456", email: "olena@example.cz" });

    await act(async () => root?.unmount());
    root = createRoot(el);
    const second = await open(addressChangeHtml, "https://mv.example/zmena-pobytu");
    await render(wayfill(second.host));
    expect((el.querySelector("#wf-prijmeni") as HTMLInputElement).value).toBe("Kovalenko");
    expect(q("from-papers")?.textContent).toBe("From your saved papers on this device. Check it, then press Next.");
    const seen = await walk();
    expect(seen).toEqual({ prijmeni: "Kovalenko", jmeno: "Olena", doklad: "", telefon: "777123456", "datum-zmeny": "", ulice: "", cp: "", obec: "", psc: "", byt: "" });
    // Nothing is written before Next: every step was skipped, so the page is untouched.
    expect(second.writes).toEqual([]);
    expect((second.doc.querySelector("#prijmeni") as HTMLInputElement).value).toBe("");
    expect(runs).toEqual([]);
  });

  it("one tap deletes the saved answers and the saved papers together", async () => {
    localStorage.setItem("distill.papers.v1", JSON.stringify({ surname: "Kovalenko", phone: "777123456" }));
    const { host } = await open(CZECH);
    await render(wayfill(host));
    expect(q("wf-saved-answers")?.textContent).toContain("2 saved answers are on this device only.");
    await click(button("Delete them"));
    expect(localStorage.getItem("distill.papers.v1")).toBeNull();
    expect(q("wf-saved-answers")).toBeNull();
  });
});

describe("Put into Czech (L2), on this device only", () => {
  const DICT: Record<string, string> = { "en>cs:studies": "studium", "cs>en:studium": "studies" };
  const stub = () => {
    const create = vi.fn(async ({ sourceLanguage, targetLanguage }: { sourceLanguage: string; targetLanguage: string }) => ({
      translate: async (text: string) => DICT[`${sourceLanguage}>${targetLanguage}:${text}`] ?? text,
      destroy: () => undefined,
    }));
    globalThis.Translator = { availability: async () => "available", create };
    return create;
  };

  it("offers the translation, shows it and what it says, and writes the words the person chose, read back", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const create = stub();
    const { doc, host } = await open(CZECH);
    await render(wayfill(host));
    await click(button("Skip"));
    // Never for a name: the first step offered nothing.
    await typeInto(el.querySelector("#wf-ucel") as HTMLInputElement, "studies");
    expect(create).not.toHaveBeenCalled(); // never automatic
    await click(q("translate-offer"));
    expect(q("translate-text")?.textContent).toBe("studium");
    expect(q("translate-text")?.getAttribute("lang")).toBe("cs");
    expect(q("translate-back")?.textContent).toBe("studies");
    expect(q("translate-result")?.querySelector("[data-testid='source-chip']")?.textContent).toContain("On this device");
    expect((el.querySelector("#wf-ucel") as HTMLInputElement).value).toBe("studies"); // nothing chosen yet
    await click(q("translate-use"));
    expect((el.querySelector("#wf-ucel") as HTMLInputElement).value).toBe("studium");
    await click(button("Finish"));
    expect((doc.querySelector("#ucel") as HTMLInputElement).value).toBe("studium");
    expect(q("wf-done")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
  });

  it("with no translator on this device: a plain note, no offer, and nothing sent", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { host, writes } = await open(CZECH);
    await render(wayfill(host));
    await click(button("Skip"));
    await typeInto(el.querySelector("#wf-ucel") as HTMLInputElement, "studies");
    expect(q("translate-offer")).toBeNull();
    expect(q("translate-note")?.textContent).toBe("Putting answers into Czech needs the translator built into Chrome on a computer, and there is none here. Your answers are not sent anywhere to translate them.");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(runs).toEqual([]);
  });

  it("is not offered for an answer the on-device detector says is already Czech, nor to a Czech reader", async () => {
    stub();
    globalThis.LanguageDetector = { availability: async () => "available", create: async () => ({ detect: async () => [{ detectedLanguage: "cs", confidence: 0.95 }] }) };
    const { host } = await open(CZECH);
    await render(wayfill(host));
    await click(button("Skip"));
    await typeInto(el.querySelector("#wf-ucel") as HTMLInputElement, "studium");
    await settle();
    expect(q("translate-offer")).toBeNull();
    delete (globalThis as { LanguageDetector?: unknown }).LanguageDetector;
  });
});
