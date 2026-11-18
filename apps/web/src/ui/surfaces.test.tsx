// Renders Wayfill, Recast and FocusView against a stubbed `run()` and a fake PageHost, to prove the designed states:
// no form, a failed write, a kept layout, an empty simplify answer and a failed AI call in plain words.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldStructure, FormStructure, FormValues, PageModel, UserSettingsDoc } from "@distill/engine";
import { AiError, type RunResult } from "../ai";

const runMock = vi.hoisted(() => vi.fn());
vi.mock("../ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ai")>()), run: runMock }));

const { Wayfill, writeProblemText } = await import("./Wayfill");
const { Recast, forgetLayouts, layoutKey } = await import("./Recast");
const { FocusView } = await import("./FocusView");
const { engine } = await import("./engine");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root!.render(node); });
  await settle();
}
/** Lets pending promises (the async effects) finish inside act. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const q = (testId: string) => el.querySelector(`[data-testid="${testId}"]`);
const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
async function click(b: Element | null | undefined): Promise<void> {
  expect(b, "button").toBeTruthy();
  await act(async () => { (b as HTMLButtonElement).click(); });
  await settle();
}

beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  runMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  el.remove();
  vi.restoreAllMocks();
});

const ok = <T,>(data: T): RunResult<T> => ({ data, source: "in_cloud", ms: 1200, reason: "Runs in the cloud." });
const settings: UserSettingsDoc = { readingLevel: "plain", readerLang: "en", recastEnabled: true };

// ---- Wayfill -----------------------------------------------------------------------------------------------------

const field = (fieldId: string, label: string): FieldStructure => ({ fieldId, kind: "text", label, required: false });
const form = (fields: FieldStructure[]): FormStructure => ({ fingerprint: "fp", url: "https://mv.example/", lang: "cs", title: "Žádost", fields });

function fakeHost(structure: FormStructure, writeValues: (v: FormValues) => Promise<{ written: string[]; failed: string[] }>) {
  return {
    label: () => "Test",
    getPage: vi.fn(),
    getForm: vi.fn(async () => structure),
    readValues: vi.fn(async () => ({})),
    writeValues: vi.fn(async (_s: FormStructure, v: FormValues) => writeValues(v)),
    highlight: vi.fn(async () => undefined),
    showOriginal: vi.fn(async () => undefined),
  };
}
const model = { state: "unavailable" as const, progress: null, download: async () => undefined, refresh: async () => undefined };

function wizardFor(s: FormStructure) {
  return ok({ steps: s.fields.map((f) => ({ stepId: f.fieldId, fieldIds: [f.fieldId], question: `What is ${f.label}?`, explanation: "Plain words." })) });
}

describe("Wayfill", () => {
  it("a page with no fillable field says so, and asks no AI", async () => {
    const host = fakeHost(form([]), async () => ({ written: [], failed: [] }));
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    expect(q("no-form")?.textContent).toContain("There is no form to fill on this page");
    expect(q("wf-step")).toBeNull();
    expect(q("wf-done")).toBeNull();
    expect(runMock).not.toHaveBeenCalled();
  });

  it("a page that cannot be read gets the designed state, not the raw error", async () => {
    const host = fakeHost(form([]), async () => ({ written: [], failed: [] }));
    host.getForm.mockRejectedValueOnce(new Error("no reply"));
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    expect(q("no-form")?.textContent).toContain("Distill could not read a form on this page");
    expect(el.textContent).not.toContain("no reply");
  });

  it("when Next cannot write a value, the step names the field, stays, and offers the original form", async () => {
    const s = form([field("jmeno", "Jméno"), field("rc", "Rodné číslo")]);
    runMock.mockResolvedValue(wizardFor(s));
    const host = fakeHost(s, async (v) => ({ written: [], failed: Object.keys(v) }));
    const onShowOriginal = vi.fn();
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={onShowOriginal} />);
    expect(q("wf-step")?.textContent).toContain("What is Jméno?");
    await click(button("Next"));
    expect(q("write-problem")?.textContent).toContain(
      'Could not fill in "Jméno" on the original form: the page did not take the answer, or Distill could not confirm it did. Please fill it in there yourself.',
    );
    expect(q("wf-step")?.textContent).toContain("What is Jméno?"); // did not advance
    await click(button("Show original form"));
    expect(onShowOriginal).toHaveBeenCalled();
    await click(button("Go to the next step"));
    expect(q("wf-step")?.textContent).toContain("What is Rodné číslo?");
    expect(q("write-problem")).toBeNull();
  });

  it("when the page is gone, Next keeps the answer and offers Try again", async () => {
    const s = form([field("jmeno", "Jméno")]);
    runMock.mockResolvedValue(wizardFor(s));
    let reachable = false;
    const host = fakeHost(s, async (v) => {
      if (!reachable) throw new Error("Could not establish connection. Receiving end does not exist.");
      return { written: Object.keys(v), failed: [] };
    });
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    const input = el.querySelector<HTMLInputElement>("#wf-jmeno")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Jana");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Finish"));
    expect(q("write-problem")?.textContent).toContain('The original page could not be reached, so "Jméno" was not filled in.');
    expect(el.textContent).not.toContain("Receiving end");
    expect(el.querySelector<HTMLInputElement>("#wf-jmeno")!.value).toBe("Jana");
    reachable = true;
    await click(button("Try again"));
    expect(q("wf-done")?.textContent).toContain("1 field was filled in");
  });

  it("a failed wizard call shows the plain words on the basic steps' chip", async () => {
    runMock.mockRejectedValue(new AiError("busy"));
    const host = fakeHost(form([field("a", "A")]), async () => ({ written: [], failed: [] }));
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    expect(q("origin-chip")?.getAttribute("title")).toContain("The AI is busy right now.");
  });

  it("writeProblemText names several fields", () => {
    expect(writeProblemText({ fieldIds: ["a", "b"], unreachable: false }, (id) => id.toUpperCase())).toBe(
      'Could not fill in "A", "B" on the original form: the page did not take these answers, or Distill could not confirm it did. Please fill them in there yourself.',
    );
  });

  it("a choice field whose options the page has not shown yet is answered by typing, not an empty dropdown", async () => {
    const s = form([{ fieldId: "kraj", kind: "select", label: "Kraj", required: false }]);
    runMock.mockResolvedValue(wizardFor(s));
    const host = fakeHost(s, async (v) => ({ written: Object.keys(v), failed: [] }));
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    const input = el.querySelector("#wf-kraj");
    expect(input?.tagName).toBe("INPUT");
    expect(input?.getAttribute("type")).toBe("text");
  });
});

// ---- Recast --------------------------------------------------------------------------------------------------------

const page = (text = "The office is open on Monday. Bring your passport."): PageModel => ({
  url: "https://office.example/visit",
  title: "Visit",
  lang: "en",
  kind: "article",
  blocks: [{ id: "b0", kind: "heading", level: 1, text: "Visit" }, { id: "b1", kind: "paragraph", text }],
});
const layout = ok({ version: 1, nodes: [{ kind: "summary", text: "Open Monday.", sourceBlockIds: ["b1"] }] });

describe("Recast", () => {
  beforeEach(() => forgetLayouts());

  it("keeps the built layout when the person leaves the tab and comes back: no second AI call", async () => {
    runMock.mockResolvedValue(layout);
    const view = (p: PageModel) => <Recast page={p} enabled fallback={<p>focus</p>} onSource={() => undefined} />;
    await render(view(page()));
    expect(q("recast-count")?.textContent).toContain("1 section built from the page");
    await act(async () => root!.render(<p>other tab</p>));
    await render(view(page())); // a new object for the same page
    expect(q("recast-count")?.textContent).toContain("1 section built from the page");
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("'Rebuild the layout' asks the AI again on purpose", async () => {
    runMock.mockResolvedValue(layout);
    await render(<Recast page={page()} enabled fallback={<p>focus</p>} onSource={() => undefined} />);
    await click(q("recast-rebuild"));
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(q("recast-count")).not.toBeNull();
  });

  it("a page with different content is a different layout", () => {
    expect(layoutKey(page())).toBe(layoutKey(page()));
    expect(layoutKey(page("Closed on Monday."))).not.toBe(layoutKey(page()));
  });

  it("a busy AI shows plain words, Try again, and the focus view; nothing is kept", async () => {
    runMock.mockRejectedValueOnce(new AiError("busy")).mockResolvedValueOnce(layout);
    await render(<Recast page={page()} enabled fallback={<p>focus view here</p>} onSource={() => undefined} />);
    expect(q("ai-problem")?.textContent).toContain("The AI is busy right now. Try again in a moment. Here is the focus view instead.");
    expect(el.textContent).toContain("focus view here");
    await click(q("ai-retry"));
    expect(q("recast-count")).not.toBeNull();
    expect(runMock).toHaveBeenCalledTimes(2);
  });
});

// ---- FocusView -----------------------------------------------------------------------------------------------------

describe("FocusView", () => {
  const view = () => <FocusView page={page()} settings={settings} onSettings={() => undefined} />;

  it("sends schemas.simplify as the reply constraint and shows the rewrite with its source", async () => {
    runMock.mockResolvedValue(ok({ blocks: [{ id: "b1", text: "Open Monday. Bring a passport." }] }));
    await render(view());
    expect(runMock.mock.calls[0]?.[0]).toBe("simplifyBlocks");
    expect(runMock.mock.calls[0]?.[2]).toBe(engine.schemas.simplify);
    expect(el.textContent).toContain("Open Monday. Bring a passport.");
    expect(q("source-chip")).not.toBeNull();
  });

  it("when nothing usable came back, it says so plainly, shows the page as written and no source chip", async () => {
    runMock.mockResolvedValue(ok({ blocks: [{ id: "zz", text: "unknown id" }, { id: "b1", text: "  " }] }));
    await render(view());
    expect(q("simplify-nothing")?.textContent).toContain("Could not simplify this time. Showing the page as written.");
    expect(q("source-chip")).toBeNull();
    expect(el.textContent).toContain("The office is open on Monday. Bring your passport.");
  });

  it("an in-shape empty answer means the page was already plain: a success with its source, not a failure", async () => {
    runMock.mockResolvedValue(ok({ blocks: [] }));
    await render(view());
    expect(q("simplify-already-plain")?.textContent).toContain("already easy to read");
    expect(q("simplify-nothing")).toBeNull();
    expect(q("source-chip")).not.toBeNull();
    expect(el.textContent).toContain("The office is open on Monday. Bring your passport.");
  });

  it("a failed call shows the router's words, never the raw message, with Try again", async () => {
    runMock.mockRejectedValueOnce(new AiError("not-genuine"));
    await render(view());
    expect(q("ai-problem")?.textContent).toBe("This app could not prove it is genuine to the AI service. Showing the page as written.");
    expect(q("ai-retry")).toBeNull(); // trying again cannot help here
    runMock.mockReset();
    runMock.mockRejectedValueOnce(new AiError("busy")).mockResolvedValueOnce(ok({ blocks: [{ id: "b1", text: "Simple." }] }));
    await render(<FocusView page={{ ...page(), url: "https://office.example/other" }} settings={settings} onSettings={() => undefined} />);
    await click(q("ai-retry"));
    expect(el.textContent).toContain("Simple.");
  });
});
