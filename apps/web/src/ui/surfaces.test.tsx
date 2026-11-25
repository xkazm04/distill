// Renders Wayfill, Recast and FocusView against a stubbed `run()` and a fake PageHost, to prove the designed states:
// no form, a failed write, a kept layout, an empty simplify answer and a failed AI call in plain words.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldStructure, FormErrors, FormStructure, FormValues, PageModel, UserSettingsDoc } from "@distill/engine";
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
  // The page holds what was written to it, so a read (on entering a step, at the finish) sees it.
  const page: FormValues = {};
  return {
    label: () => "Test",
    getPage: vi.fn(),
    getForm: vi.fn(async () => structure),
    readValues: vi.fn(async () => ({ ...page })),
    writeValues: vi.fn(async (_s: FormStructure, v: FormValues) => {
      const r = await writeValues(v);
      for (const id of r.written) page[id] = v[id] ?? "";
      return r;
    }),
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

  it("a page the host knows it cannot fill (an XFA PDF) shows the host's own plain words, and asks no AI", async () => {
    const host = fakeHost(form([]), async () => ({ written: [], failed: [] }));
    host.getForm.mockRejectedValueOnce(Object.assign(new Error("x"), {
      problem: { title: "This PDF is an XFA form, which Distill cannot fill", detail: "XFA is an older Adobe form format." },
    }));
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    expect(q("no-form")?.getAttribute("data-reason")).toBe("problem");
    expect(q("no-form")?.querySelector("h3")?.textContent).toBe("This PDF is an XFA form, which Distill cannot fill");
    expect(q("no-form")?.textContent).toContain("XFA is an older Adobe form format.");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("a host that fills a copy (a PDF) offers to save it once an answer is written, and says the opened file is unchanged", async () => {
    const s = form([field("jmeno", "Jméno")]);
    runMock.mockResolvedValue(wizardFor(s));
    const saveCopy = vi.fn(async () => undefined);
    const host = { ...fakeHost(s, async (v) => ({ written: Object.keys(v), failed: [] })), saveCopy };
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    expect(q("save-copy")).toBeNull(); // nothing written yet
    const input = el.querySelector<HTMLInputElement>("#wf-jmeno")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Olena");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Finish"));
    expect(q("wf-done")?.textContent).toContain("1 field is filled in on a copy of the form, read back from it just now.");
    expect(q("wf-done")?.textContent).toContain("The file you opened stays as it was.");
    await click(q("wf-done")?.querySelector('[data-testid="save-copy"]'));
    expect(saveCopy).toHaveBeenCalledOnce();
    expect(q("save-note")?.textContent).toBe("Saved as a new file on this device. The file you opened is unchanged.");
  });

  it("a web page's host has no copy to save: no save button", async () => {
    const s = form([field("jmeno", "Jméno")]);
    runMock.mockResolvedValue(wizardFor(s));
    const host = fakeHost(s, async (v) => ({ written: Object.keys(v), failed: [] }));
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    await click(button("Skip"));
    expect(q("wf-done")?.textContent).toContain("on the original form");
    expect(q("save-copy")).toBeNull();
  });

  it("when Next cannot write a value, the step names the field, stays, and offers the original form", async () => {
    const s = form([field("jmeno", "Jméno"), field("rc", "Rodné číslo")]);
    runMock.mockResolvedValue(wizardFor(s));
    const host = fakeHost(s, async (v) => ({ written: [], failed: Object.keys(v) }));
    const onShowOriginal = vi.fn();
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={onShowOriginal} />);
    expect(q("wf-step")?.textContent).toContain("What is Jméno?");
    // An answer to write: an empty answer the person did not make is never written (Next never erases the page).
    const input = el.querySelector<HTMLInputElement>("#wf-jmeno")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Jana");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
    expect(q("wf-done")?.textContent).toContain("1 field is filled in on the original form, read back from it just now.");
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

// ---- Wayfill: the errors the page shows -----------------------------------------------------------------------------

describe("Wayfill: the page's errors", () => {
  const s = form([field("jmeno", "Jméno"), field("rc", "Rodné číslo")]);
  const RC_ERROR = "Rodné číslo '870619/43' není ve správném tvaru";
  const ready = { ...model, state: "available" as const };
  /** wizardFor for buildWizard; explainError answers in plain text, as the device model does. */
  const runs = (explanation = "The birth number needs 9 or 10 digits after the date, like 900101/1234.") =>
    runMock.mockImplementation(async (task: string) => (task === "explainError" ? { data: explanation, source: "on_device", ms: 300, reason: "Runs only on this device." } : wizardFor(s)));
  const withErrors = (errors: FormErrors) => {
    const host = fakeHost(s, async (v) => ({ written: Object.keys(v), failed: [] }));
    return Object.assign(host, { readErrors: vi.fn(async () => errors) });
  };

  it("with no model on this device: the form's own words on the step, and a sentence saying why there is no explanation", async () => {
    runs();
    const host = withErrors({ fields: { jmeno: { text: "Jméno je povinné", source: "nearby" } }, form: [] });
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    const err = q("field-error");
    expect(err?.getAttribute("data-field")).toBe("jmeno");
    expect(err?.querySelector('[data-testid="error-original"]')?.textContent).toBe("Jméno je povinné");
    expect(err?.querySelector('[data-testid="error-original"]')?.getAttribute("lang")).toBe("cs");
    expect(err?.querySelector('[data-testid="error-note"]')?.textContent).toBe(
      "Explaining this message needs the model on this device, and there is none here. This is the form's own message, as written.",
    );
    expect(runMock.mock.calls.map((c) => c[0])).not.toContain("explainError"); // never degraded to the cloud
    expect(el.querySelector(".wf-stepbtn.flagged")?.textContent).toContain("(the form shows an error)");
  });

  it("with the model ready: the explanation in the reader's language, with where it ran, from an on-device values task", async () => {
    runs();
    const host = withErrors({ fields: { rc: { text: RC_ERROR, source: "aria" } }, form: [] });
    await render(<Wayfill host={host} settings={{ ...settings, readerLang: "uk" }} model={ready as never} onShowOriginal={() => undefined} />);
    const call = runMock.mock.calls.find((c) => c[0] === "explainError");
    expect(call?.[1]).toContain(RC_ERROR);
    expect(call?.[1]).toContain("in Ukrainian");
    expect(call?.[2]).toBeNull();
    expect(engine.route("explainError", "prefer_in_cloud").mode).toBe("only_on_device");
    // The error is on the second step: go there.
    await click(button("Skip"));
    const err = q("field-error");
    expect(err?.getAttribute("data-field")).toBe("rc");
    expect(err?.querySelector('[data-testid="error-explained"]')?.textContent).toContain("needs 9 or 10 digits");
    expect(err?.querySelector('[data-testid="source-chip"]')?.textContent).toContain("On this device");
    // Read again with the same message: it is not explained twice.
    expect(runMock.mock.calls.filter((c) => c[0] === "explainError")).toHaveLength(1);
  });

  it("a failed explanation says so in plain words and keeps the form's message", async () => {
    runMock.mockImplementation(async (task: string) => {
      if (task === "explainError") throw new AiError("device-only");
      return wizardFor(s);
    });
    const host = withErrors({ fields: { jmeno: { text: "Jméno je povinné", source: "nearby" } }, form: [] });
    await render(<Wayfill host={host} settings={settings} model={ready as never} onShowOriginal={() => undefined} />);
    expect(q("field-error")?.querySelector('[data-testid="error-original"]')?.textContent).toBe("Jméno je povinné");
    expect(q("field-error")?.querySelector('[data-testid="error-note"]')?.textContent).toBe(new AiError("device-only").message);
  });

  it("an error of the whole form gets one place at the top of the guide", async () => {
    runs("The form could not be sent. Check the answers marked below and send it again.");
    const host = withErrors({ fields: {}, form: ["Žádost se nepodařilo odeslat"] });
    await render(<Wayfill host={host} settings={settings} model={ready as never} onShowOriginal={() => undefined} />);
    const box = q("form-errors");
    expect(box?.textContent).toContain("The form shows an error for the whole form.");
    expect(box?.querySelectorAll('[data-testid="form-error"]')).toHaveLength(1);
    expect(box?.textContent).toContain("Žádost se nepodařilo odeslat");
    expect(box?.textContent).toContain("Check the answers marked below");
    expect(q("field-error")).toBeNull();
  });

  it("after Next writes an answer, the page's errors are read again and shown on that step", async () => {
    runs();
    const host = withErrors({ fields: {}, form: [] });
    await render(<Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} />);
    expect(q("field-error")).toBeNull();
    host.readErrors.mockResolvedValue({ fields: { jmeno: { text: "Jméno nesmí obsahovat číslice", source: "nearby" } }, form: [] });
    const input = el.querySelector<HTMLInputElement>("#wf-jmeno")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Jana2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Next"));
    expect(host.readErrors).toHaveBeenCalledTimes(2);
    await click(button("Back"));
    expect(q("field-error")?.textContent).toContain("Jméno nesmí obsahovat číslice");
  });

  it("when the page changes in place (a failed submit), the errors are read again", async () => {
    runs();
    const host = withErrors({ fields: {}, form: [] });
    const view = (changeKey: number) => <Wayfill host={host} settings={settings} model={model as never} onShowOriginal={() => undefined} changeKey={changeKey} />;
    await render(view(0));
    host.readErrors.mockResolvedValue({ fields: { jmeno: { text: "Jméno je povinné", source: "aria" } }, form: [] });
    await render(view(1));
    expect(q("form-changed")).toBeNull(); // the same form: the guide keeps its place
    expect(q("field-error")?.textContent).toContain("Jméno je povinné");
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
