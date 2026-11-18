// A print-only PDF in the form guide: the host's note (Distill found the places itself, may have missed some, check the
// page) is shown above every step, and an answer the host could not write says the host's own reason.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldStructure, FormStructure, FormValues, UserSettingsDoc } from "@distill/engine";

vi.mock("../firebase", async (importOriginal) => ({ ...(await importOriginal<typeof import("../firebase")>()), isFirebaseConfigured: () => false }));
const { Wayfill, writeProblemText } = await import("./Wayfill");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root!.render(node); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const q = (testId: string) => el.querySelector(`[data-testid="${testId}"]`);
const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  el.remove();
  vi.restoreAllMocks();
});

const settings: UserSettingsDoc = { readingLevel: "plain", readerLang: "en", recastEnabled: true, aiMode: "off" } as UserSettingsDoc;
const model = { state: "unavailable" as const, progress: null, download: async () => undefined, refresh: async () => undefined };
const FIELDS: FieldStructure[] = [
  { fieldId: "p1-x293-y630", kind: "text", label: "Jméno a příjmení", required: false },
  { fieldId: "p1-x293-y595", kind: "text", label: "Státní příslušnost", required: false },
];
const structure: FormStructure = { fingerprint: "f".repeat(64), url: "pdf://local/", lang: "cs", title: "OZNÁMENÍ ZMĚN", fields: FIELDS };
const NOTE = { title: "Distill found the places to write on this form by itself", detail: "It may have missed some. Check every answer on the page itself." };
const TOO_LONG = "The answer is too long for its place on the page, even in small print. Shorten it, or write it on the printed page by hand.";

function host(note: typeof NOTE | null, failWith?: string) {
  return {
    label: () => "form.pdf",
    getPage: vi.fn(),
    getForm: vi.fn(async () => structure),
    readValues: vi.fn(async () => ({})),
    writeValues: vi.fn(async (_s: FormStructure, v: FormValues) => (failWith
      ? { written: [], failed: Object.keys(v), reasons: Object.fromEntries(Object.keys(v).map((id) => [id, failWith])) }
      : { written: Object.keys(v), failed: [] })),
    highlight: vi.fn(async () => undefined),
    showOriginal: vi.fn(async () => undefined),
    ...(note ? { formNote: vi.fn(async () => note) } : {}),
  };
}

describe("Wayfill on a print-only PDF", () => {
  it("shows the host's note above the steps, and keeps it on every step", async () => {
    await render(<Wayfill host={host(NOTE)} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    expect(q("form-note")?.textContent).toContain(NOTE.title);
    expect(q("form-note")?.textContent).toContain("Check every answer on the page itself.");
    await act(async () => { button("Skip")?.click(); });
    expect(q("form-note")?.textContent).toContain(NOTE.title);
  });

  it("shows no note for a form whose host has none", async () => {
    await render(<Wayfill host={host(null)} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    expect(q("form-note")).toBeNull();
  });

  it("an answer the host could not write says the host's reason, by the field's label", async () => {
    await render(<Wayfill host={host(NOTE, TOO_LONG)} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    const input = el.querySelector("input[type=text], textarea") as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(input, "Olena Kovalenko");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Next")?.click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(q("write-problem")?.textContent).toContain(`Could not fill in "Jméno a příjmení": ${TOO_LONG}`);
  });

  it("writeProblemText falls back to the general words when a reason is missing", () => {
    expect(writeProblemText({ fieldIds: ["a", "b"], unreachable: false, reasons: { a: "Too long." } }, (id) => id)).toMatch(/^Could not fill in "a", "b" on the original form/);
    expect(writeProblemText({ fieldIds: ["a"], unreachable: false, reasons: { a: "Too long." } }, (id) => id)).toBe('Could not fill in "a": Too long.');
  });
});
