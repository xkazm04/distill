// Wayfill against a real page (a happy-dom document, filled through the engine as the web host does): Next never
// erases or unticks what the person did not change, and a tick group takes several ticks.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ariaChoicesHtml from "../../../../packages/engine/test/corpus/aria-choices.html?raw";
import healthInsuranceHtml from "../../../../packages/engine/test/corpus/health-insurance.html?raw";
import * as eng from "@distill/engine";
import type { FormStructure, FormValues, UserSettingsDoc } from "@distill/engine";
import type { GuideStore } from "./guideStore";

vi.mock("../firebase", async (importOriginal) => ({ ...(await importOriginal<typeof import("../firebase")>()), isFirebaseConfigured: () => false }));
/** The model's answer for buildWizard, when a test gives one; otherwise no AI runs and the steps are the form's labels. */
const ai: { wizard: unknown } = { wizard: null };
vi.mock("../ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ai")>();
  return {
    ...real,
    aiAvailable: () => ai.wizard !== null,
    run: async (task: string) => {
      if (task === "buildWizard" && ai.wizard) return { data: ai.wizard, source: "in_cloud", reason: "test", ms: 1 };
      throw new Error("no AI in this test");
    },
  };
});
const { Wayfill } = await import("./Wayfill");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement;
let page: Window | null = null;
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root!.render(node); });
  await settle();
}
const q = (testId: string) => el.querySelector(`[data-testid="${testId}"]`);
const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const click = async (b: Element | null | undefined) => { expect(b).toBeTruthy(); await act(async () => { (b as HTMLElement).click(); }); await settle(); };
const stepTitle = () => q("wf-step")?.querySelector("h3")?.textContent ?? "";
async function typeInto(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  ai.wizard = null;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  el.remove();
  await page?.happyDOM.close();
  page = null;
  vi.restoreAllMocks();
});

const settings = { readingLevel: "plain", readerLang: "en", recastEnabled: true, aiMode: "off" } as UserSettingsDoc;
const model = { state: "unavailable" as const, progress: null, download: async () => undefined, refresh: async () => undefined };

/** A page in its own window, and a host over it that reads and writes through the engine, as the web host does. Page
 *  scripts do not run: a test wires the page's behaviour itself. */
async function open(html: string) {
  page = new Window({ url: "https://forms.example/f" });
  page.document.write(html);
  await page.happyDOM.waitUntilComplete();
  const doc = page.document as unknown as Document;
  const writes: FormValues[] = [];
  const host = {
    label: () => "form",
    getPage: vi.fn(),
    getForm: vi.fn(async () => eng.extractForm(doc, "https://forms.example/f")),
    readValues: vi.fn(async (s: FormStructure) => eng.readValues(doc, s)),
    writeValues: vi.fn(async (s: FormStructure, v: FormValues) => { writes.push(v); return eng.writeValues(doc, s, v); }),
    readErrors: vi.fn(async (s: FormStructure) => eng.readErrors(doc, s)),
    highlight: vi.fn(async () => undefined),
    showOriginal: vi.fn(async () => undefined),
  };
  return { doc, host, writes };
}

/** A device-only guide store in memory, so "Forget my answers" is offered. */
function memoryStore(): GuideStore {
  const m = new Map<string, unknown>();
  return {
    load: async (k: string) => (m.get(k) ?? null) as never,
    save: async (k: string, v: unknown) => { m.set(k, v); },
    clear: async (k: string) => { m.delete(k); },
  } as unknown as GuideStore;
}

const TWO_TEXT = `<form><p><label for="jmeno">Jméno</label><input id="jmeno" required></p>
  <p><label for="pozn">Poznámka</label><input id="pozn"></p><p><label for="mesto">Město</label><input id="mesto"></p></form>`;

describe("Next never erases what the person did not change", () => {
  it("keeps a value typed into the original after the steps were built, on an optional step", async () => {
    const { doc, host } = await open(TWO_TEXT);
    await render(<Wayfill host={host as never} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    await typeInto(el.querySelector("#wf-jmeno") as HTMLInputElement, "Olena");
    // The person types into the original pane while the wizard is on step 1.
    (doc.querySelector("#pozn") as HTMLInputElement).value = "Bez poznámky";
    await click(button("Next"));
    expect(stepTitle()).toContain("Poznámka");
    await click(button("Next"));
    expect((doc.querySelector("#pozn") as HTMLInputElement).value).toBe("Bez poznámky");
    expect((doc.querySelector("#jmeno") as HTMLInputElement).value).toBe("Olena");
  });

  it("shows a value the page holds on entering the step as already on the form", async () => {
    const { doc, host } = await open(TWO_TEXT);
    await render(<Wayfill host={host as never} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    (doc.querySelector("#pozn") as HTMLInputElement).value = "Bez poznámky";
    await click(button("Skip"));
    expect((el.querySelector("#wf-pozn") as HTMLInputElement).value).toBe("Bez poznámky");
    expect(q("on-form")?.textContent).toContain("Already on the form");
  });

  it("keeps an answer the page took while the step was on screen (an agent's answer the person accepted)", async () => {
    const { doc, host, writes } = await open(TWO_TEXT);
    await render(<Wayfill host={host as never} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    await click(button("Skip"));
    (doc.querySelector("#pozn") as HTMLInputElement).value = "Od agenta";
    await click(button("Next"));
    expect((doc.querySelector("#pozn") as HTMLInputElement).value).toBe("Od agenta");
    expect(writes).toEqual([]);
  });

  it("Forget my answers, then Next: the page keeps every value", async () => {
    const { doc, host } = await open(TWO_TEXT);
    await render(<Wayfill host={host as never} settings={settings} model={model as never} onShowOriginal={() => undefined} guideStore={memoryStore()} />);
    await typeInto(el.querySelector("#wf-jmeno") as HTMLInputElement, "Olena");
    await click(button("Next"));
    await typeInto(el.querySelector("#wf-pozn") as HTMLInputElement, "Bez poznámky");
    await click(button("Next"));
    await click(button("Back"));
    await click(button("Forget my answers"));
    await click(button("Next"));
    await click(button("Back"));
    await click(button("Back"));
    await click(button("Next"));
    expect((doc.querySelector("#jmeno") as HTMLInputElement).value).toBe("Olena");
    expect((doc.querySelector("#pozn") as HTMLInputElement).value).toBe("Bez poznámky");
  });

  it("empties a field when the person empties it in the wizard: clearing is the person's own action", async () => {
    const { doc, host } = await open(TWO_TEXT);
    (doc.querySelector("#pozn") as HTMLInputElement).value = "Stará poznámka";
    await render(<Wayfill host={host as never} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    await click(button("Skip"));
    await typeInto(el.querySelector("#wf-pozn") as HTMLInputElement, "");
    await click(button("Next"));
    expect((doc.querySelector("#pozn") as HTMLInputElement).value).toBe("");
  });
});

/** aria-choices.html with its page script wired by hand: a click flips aria-checked. */
async function ariaChoices() {
  const p = await open(ariaChoicesHtml);
  p.doc.querySelectorAll("[role=checkbox], [role=switch]").forEach((c) => {
    c.addEventListener("click", () => c.setAttribute("aria-checked", String(c.getAttribute("aria-checked") !== "true")));
  });
  p.doc.querySelectorAll("[role=radio]").forEach((r) => {
    r.addEventListener("click", () => r.parentElement?.querySelectorAll("[role=radio]").forEach((o) => o.setAttribute("aria-checked", String(o === r))));
  });
  return p;
}
const checked = (doc: Document, id: string) => doc.querySelector(`#${id}`)?.getAttribute("aria-checked");
const tick = (label: string) => [...el.querySelectorAll("label.choice")].find((l) => l.textContent?.includes(label))?.querySelector("input");

describe("a tick group takes several ticks", () => {
  it("ticks two of four boxes, both hold on the page and read back, and a box the page had ticked stays ticked", async () => {
    const { doc, host } = await ariaChoices();
    await render(<Wayfill host={host as never} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    await click(button("Skip")); // name
    await click(button("Skip")); // kind of trade
    expect(stepTitle()).toContain("Obory činnosti");
    // The page ticks one box itself after the step was entered: the wizard holds the box the page had already.
    (doc.querySelector("#obor-48") as HTMLElement).click();
    expect(el.querySelectorAll("label.choice input[type=checkbox]")).toHaveLength(4);
    await click(tick("Poskytování software"));
    await click(tick("Překladatelská"));
    await click(button("Next"));
    expect(["obor-56", "obor-63", "obor-72", "obor-48"].map((id) => checked(doc, id))).toEqual(["true", "true", "false", "true"]);
    const s = await eng.extractForm(doc, "https://forms.example/f");
    expect(eng.readValues(doc, s).obory?.split(",")).toHaveLength(3);
  });

  it("a page-ticked box the person never touched stays ticked after Next", async () => {
    const { doc, host } = await ariaChoices();
    (doc.querySelector("#obor-72") as HTMLElement).click();
    await render(<Wayfill host={host as never} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    await click(button("Skip"));
    await click(button("Skip"));
    expect(tick("Mimoškolní")?.checked).toBe(true);
    await click(tick("Poskytování software"));
    await click(button("Next"));
    expect(["obor-56", "obor-63", "obor-72", "obor-48"].map((id) => checked(doc, id))).toEqual(["true", "false", "true", "false"]);
    expect(el.querySelector(".wf-steps")?.textContent).toContain("Poskytování software a poradenství v oblasti IT, Mimoškolní výchova a vzdělávání");
  });
});
