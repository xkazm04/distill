// The workbench around the views: view keys, the Original control (Hide / Beside / Full), the divider, and pointing
// at the source in the original while it is beside Distill. The AI is stubbed; the width is set per test.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormStructure, FormValues, PageModel } from "@distill/engine";
import type { RunResult } from "../ai";
import type { LocateTarget, PageHost } from "./host";
import type { GuideState, GuideStore } from "./guideStore";

const runMock = vi.hoisted(() => vi.fn());
vi.mock("../ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("../ai")>()), run: runMock }));

const { Workspace, BESIDE_MIN_WIDTH } = await import("./Workspace");
const { forgetLayouts } = await import("./Recast");
const { ORIGINAL_KEY, SPLIT_KEY } = await import("./prefs");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE: PageModel = {
  url: "https://office.example/visit", title: "Visit the office", lang: "cs", kind: "form", formCount: 1,
  blocks: [
    { id: "b0", kind: "heading", level: 2, text: "Opening hours" },
    { id: "b1", kind: "paragraph", text: "The office is open on Monday." },
    { id: "b2", kind: "paragraph", text: "Bring your passport." },
  ],
};
const FORM: FormStructure = {
  fingerprint: "fp", url: PAGE.url, lang: "cs", title: "Žádost",
  fields: [
    { fieldId: "jmeno", kind: "text", label: "Jméno", required: false },
    { fieldId: "mesto", kind: "text", label: "Město", required: false },
  ],
};
const ok = <T,>(data: T): RunResult<T> => ({ data, source: "on_device", ms: 900, reason: "Ran on this device." });

function answer(task: string) {
  if (task === "simplifyBlocks") return ok({ blocks: [{ id: "b1", text: "Open Monday." }] });
  if (task === "buildWizard") return ok({ steps: FORM.fields.map((f) => ({ stepId: f.fieldId, fieldIds: [f.fieldId], question: `What is ${f.label}?`, explanation: "Plain words." })) });
  if (task === "recast") return ok({ version: 1, nodes: [{ kind: "summary", title: "In short", text: "Open Monday.", sourceBlockIds: ["b1"] }] });
  throw new Error(`unexpected task ${task}`);
}

class FakeHost implements PageHost {
  locate = vi.fn(async (_t: LocateTarget | null) => undefined);
  showOriginal = vi.fn(async (_on: boolean) => undefined);
  label() { return "Visit"; }
  async getPage() { return PAGE; }
  async getForm() { return FORM; }
  async readValues() { return {}; }
  async writeValues(_s: FormStructure, v: FormValues) { return { written: Object.keys(v), failed: [] }; }
  async highlight() { /* nothing to outline */ }
}
/** The web host: it has a pane for the original. */
class PaneHost extends FakeHost {
  originalPane(visible: boolean): ReactNode { return <div data-testid="original-pane" hidden={!visible}>the original</div>; }
}

let root: Root | null = null;
let el: HTMLElement;
let width = 1600;

beforeEach(() => {
  localStorage.clear();
  forgetLayouts();
  runMock.mockReset();
  runMock.mockImplementation(async (task: string) => answer(task));
  width = 1600;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  el.remove();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(host: PageHost, initialTab: "focus" | "wayfill" | "recast" = "focus") {
  await act(async () => { root!.render(<Workspace host={host} initialTab={initialTab} />); });
  await settle();
}
const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const selected = () => el.querySelector('[role="tab"][aria-selected="true"]')?.id;
const radio = (mode: string) => q(`original-${mode}`) as HTMLInputElement | null;
async function choose(mode: string) { await act(async () => { radio(mode)!.click(); }); await settle(); }
async function key(target: EventTarget, k: string, init: KeyboardEventInit = {}) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init })); });
  await settle();
}
async function fire(target: Element, type: string) {
  await act(async () => { target.dispatchEvent(new Event(type, { bubbles: true })); });
}
const button = (text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("view keys", () => {
  it("1-4 switch views, and a key typed into a field does not", async () => {
    await mount(new FakeHost());
    expect(selected()).toBe("tab-focus");
    await key(document.body, "2");
    expect(selected()).toBe("tab-wayfill");
    await key(document.body, "3");
    expect(selected()).toBe("tab-recast");
    await key(document.body, "1");
    expect(selected()).toBe("tab-focus");
    const select = el.querySelector("select")!; // "I read in"
    await key(select, "2");
    expect(selected()).toBe("tab-focus");
    const input = document.createElement("input");
    el.append(input);
    await key(input, "3");
    expect(selected()).toBe("tab-focus");
    await key(document.body, "2", { ctrlKey: true });
    expect(selected()).toBe("tab-focus");
  });
});

describe("reader languages", () => {
  it("offers English and Ukrainian, the two reader languages of the Czechia corridor", async () => {
    await mount(new FakeHost());
    const select = el.querySelector<HTMLSelectElement>("select")!; // "I read in"
    const offered = [...select.options].map((o) => [o.value, o.textContent]);
    expect(offered).toContainEqual(["en", "English"]);
    expect(offered).toContainEqual(["uk", "Ukrainian"]);
  });
});

describe("the Original control", () => {
  it("offers Beside only with a pane for the original and room for it", async () => {
    await mount(new PaneHost());
    expect(radio("beside")).not.toBeNull();
    await act(async () => root!.unmount());
    root = createRoot(el);

    width = BESIDE_MIN_WIDTH - 1;
    await mount(new PaneHost());
    expect(radio("beside")).toBeNull();
    expect(radio("hide")?.checked).toBe(true);
    expect(radio("full")).not.toBeNull();
  });

  it("is not there on a host without a pane (the extension): the tab beside the panel is the original", async () => {
    await mount(new FakeHost());
    expect(q("original-control")).toBeNull();
    expect(radio("full")).toBeNull();
    expect((el.querySelector("#panel") as HTMLElement).hidden).toBe(false);
  });

  it("reads the kept choice back and keeps a new one", async () => {
    localStorage.setItem(ORIGINAL_KEY, "beside");
    await mount(new PaneHost());
    expect(radio("beside")?.checked).toBe(true);
    expect(q("split")).not.toBeNull();
    expect(q("original-pane")?.hidden).toBe(false);
    await choose("hide");
    expect(localStorage.getItem(ORIGINAL_KEY)).toBe("hide");
    expect(q("split")).toBeNull();
    await choose("full"); // a moment, not a kept layout
    expect(localStorage.getItem(ORIGINAL_KEY)).toBe("hide");
  });

  it("Full and Hide behave as the old switch did", async () => {
    const host = new PaneHost();
    await mount(host);
    expect((el.querySelector("#panel") as HTMLElement).hidden).toBe(false);
    expect(q("original-pane")?.hidden).toBe(true);
    await choose("full");
    expect((el.querySelector("#panel") as HTMLElement).hidden).toBe(true);
    expect(q("original-pane")?.hidden).toBe(false);
    expect(host.showOriginal).toHaveBeenLastCalledWith(true);
    await choose("hide");
    expect((el.querySelector("#panel") as HTMLElement).hidden).toBe(false);
    expect(q("original-pane")?.hidden).toBe(true);
    expect(host.showOriginal).toHaveBeenLastCalledWith(false);
  });

  it("choosing a view from Full shows Distill again", async () => {
    await mount(new PaneHost());
    await choose("full");
    await key(document.body, "3");
    expect((el.querySelector("#panel") as HTMLElement).hidden).toBe(false);
  });
});

describe("the divider", () => {
  it("moves with the keyboard and keeps the width", async () => {
    localStorage.setItem(ORIGINAL_KEY, "beside");
    await mount(new PaneHost());
    const sep = q("split")!;
    expect(sep.getAttribute("role")).toBe("separator");
    expect(sep.getAttribute("aria-valuenow")).toBe("45");
    await key(sep, "ArrowRight");
    expect(sep.getAttribute("aria-valuenow")).toBe("47");
    expect(localStorage.getItem(SPLIT_KEY)).toBe("47");
    await key(sep, "ArrowLeft", { shiftKey: true });
    expect(sep.getAttribute("aria-valuenow")).toBe("37");
    await key(sep, "Home");
    expect(sep.getAttribute("aria-valuenow")).toBe("25");
    await key(sep, "ArrowLeft");
    expect(sep.getAttribute("aria-valuenow")).toBe("25"); // never below the minimum
    await key(sep, "End");
    expect(sep.getAttribute("aria-valuenow")).toBe("70");
    await key(sep, "Enter");
    expect(sep.getAttribute("aria-valuenow")).toBe("45");
    expect(localStorage.getItem(SPLIT_KEY)).toBe("45");
  });

  it("starts from the kept width", async () => {
    localStorage.setItem(ORIGINAL_KEY, "beside");
    localStorage.setItem(SPLIT_KEY, "60");
    await mount(new PaneHost());
    expect(q("split")?.getAttribute("aria-valuenow")).toBe("60");
  });
});

describe("pointing at the source in the original", () => {
  const block = (id: string) => el.querySelector(`[data-block="${id}"]`)!;

  it("Read: pointing at or focusing a block locates it, leaving clears it", async () => {
    localStorage.setItem(ORIGINAL_KEY, "beside");
    const host = new PaneHost();
    await mount(host);
    host.locate.mockClear();
    await fire(block("b1"), "pointerover");
    expect(host.locate).toHaveBeenLastCalledWith({ blockId: "b1" });
    await fire(el.querySelector("article.reading")!, "pointerout");
    await act(async () => { el.querySelector("article.reading")!.dispatchEvent(new Event("pointerleave")); });
    expect(host.locate).toHaveBeenLastCalledWith(null);
    await act(async () => { (block("b2") as HTMLElement).focus(); });
    expect(host.locate).toHaveBeenLastCalledWith({ blockId: "b2" });
    expect(block("b2").getAttribute("tabindex")).toBe("0");
  });

  it("Fill a form: every step change locates the step's fields", async () => {
    localStorage.setItem(ORIGINAL_KEY, "beside");
    const host = new PaneHost();
    await mount(host, "wayfill");
    expect(host.locate).toHaveBeenLastCalledWith({ fieldIds: ["jmeno"] });
    await act(async () => { button("Skip")!.click(); });
    await settle();
    expect(host.locate).toHaveBeenLastCalledWith({ fieldIds: ["mesto"] });
  });

  it("New layout: From the page locates the source block instead of jumping to Read", async () => {
    localStorage.setItem(ORIGINAL_KEY, "beside");
    const host = new PaneHost();
    await mount(host, "recast");
    const src = el.querySelector<HTMLButtonElement>(".src")!;
    expect(src.textContent).toBe("The office is open on Monday.");
    await act(async () => { src.click(); });
    expect(host.locate).toHaveBeenLastCalledWith({ blockId: "b1" });
    expect(selected()).toBe("tab-recast");
  });

  it("never locates while the original is hidden; From the page jumps to Read as before", async () => {
    localStorage.setItem(ORIGINAL_KEY, "hide");
    const host = new PaneHost();
    await mount(host);
    await fire(block("b1"), "pointerover");
    await act(async () => { (block("b2") as HTMLElement).focus(); });
    expect(block("b2").getAttribute("tabindex")).toBeNull();
    await key(document.body, "2");
    await act(async () => { button("Skip")!.click(); });
    await settle();
    await key(document.body, "3");
    await act(async () => { el.querySelector<HTMLButtonElement>(".src")!.click(); });
    await settle();
    expect(selected()).toBe("tab-focus");
    expect(host.locate).not.toHaveBeenCalled();
  });
});

describe("one way to the original", () => {
  it("Fill a form has no original button of its own in its toolbar", async () => {
    await mount(new PaneHost(), "wayfill");
    expect(el.querySelector(".wayfill .ws-toolbar button")).toBeNull();
    expect(button("Show original form")).toBeUndefined();
  });

  it("opens beside on a wide web screen when the person never chose, and keeps an explicit choice", async () => {
    await mount(new PaneHost(), "wayfill");
    expect(radio("beside")?.checked).toBe(true);
    await act(async () => root!.unmount());
    root = createRoot(el);
    localStorage.setItem(ORIGINAL_KEY, "hide");
    await mount(new PaneHost(), "wayfill");
    expect(radio("hide")?.checked).toBe(true);
  });

  it("the done step's Show original form opens beside on a wide web host", async () => {
    localStorage.setItem(ORIGINAL_KEY, "hide");
    await mount(new PaneHost(), "wayfill");
    await act(async () => { button("Skip")!.click(); });
    await act(async () => { button("Skip")!.click(); });
    await settle();
    expect(q("wf-done")).not.toBeNull();
    await act(async () => { button("Show original form")!.click(); });
    await settle();
    expect(radio("beside")?.checked).toBe(true);
    expect((el.querySelector("#panel") as HTMLElement).hidden).toBe(false);
  });

  it("the done step's Show original form only outlines the fields without a pane: the tab is the original", async () => {
    const host = new FakeHost();
    const highlight = vi.spyOn(host, "highlight");
    await mount(host, "wayfill");
    await act(async () => { button("Skip")!.click(); });
    await act(async () => { button("Skip")!.click(); });
    await settle();
    await act(async () => { button("Show original form")!.click(); });
    await settle();
    expect(highlight).toHaveBeenCalled();
    expect((el.querySelector("#panel") as HTMLElement).hidden).toBe(false);
    expect(q("original-control")).toBeNull();
  });
});

describe("loading never looks frozen", () => {
  it("Read shows the page's shape and a status line while the AI works, then the text", async () => {
    let release: () => void = () => undefined;
    runMock.mockImplementation((task: string) => new Promise((r) => { release = () => r(answer(task)); }));
    await mount(new FakeHost());
    expect(q("skeleton")).not.toBeNull();
    expect(q("skeleton")?.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector('.ws-read .ws-toolbar [role="status"]')?.textContent).toBe("Making this easier to read...");
    await act(async () => release());
    await settle();
    expect(q("skeleton")).toBeNull();
    expect(el.querySelector("article.reading.ws-enter")?.textContent).toContain("Open Monday.");
  });

  it("Fill a form and New layout show their skeletons while they are built", async () => {
    runMock.mockImplementation(() => new Promise(() => undefined));
    await mount(new FakeHost(), "wayfill");
    expect(el.querySelector('[data-testid="wayfill-pane"] [data-testid="skeleton"]')).not.toBeNull();
    await key(document.body, "3");
    expect(el.querySelector(".recast [data-testid='skeleton']")).not.toBeNull();
    expect(el.querySelector(".recast [role='status']")?.textContent).toBe("Building a clearer layout...");
  });
});

// ---- the extension's host: no pane of its own, the tab itself is beside the panel ---------------------------------

describe("pointing at the source in the tab (a host without a pane)", () => {
  const block = (id: string) => el.querySelector(`[data-block="${id}"]`)!;

  it("Read: pointing at a block locates it in the tab, with no Beside to choose first", async () => {
    const host = new FakeHost();
    await mount(host);
    host.locate.mockClear();
    await fire(block("b1"), "pointerover");
    expect(host.locate).toHaveBeenLastCalledWith({ blockId: "b1" });
  });

  it("Fill a form: every step change locates the step's fields in the tab", async () => {
    const host = new FakeHost();
    await mount(host, "wayfill");
    expect(host.locate).toHaveBeenLastCalledWith({ fieldIds: ["jmeno"] });
    await act(async () => { button("Skip")!.click(); });
    await settle();
    expect(host.locate).toHaveBeenLastCalledWith({ fieldIds: ["mesto"] });
  });

  it("New layout: From the page locates the source block in the tab and stays in the layout", async () => {
    const host = new FakeHost();
    await mount(host, "recast");
    await act(async () => { el.querySelector<HTMLButtonElement>(".src")!.click(); });
    expect(host.locate).toHaveBeenLastCalledWith({ blockId: "b1" });
    expect(selected()).toBe("tab-recast");
  });
});

/** A page whose text (and form) can change under the panel, as a live tab does. */
class LiveHost extends FakeHost {
  page: PageModel = PAGE;
  form: FormStructure = FORM;
  override async getPage() { return this.page; }
  override async getForm() { return this.form; }
}

type WsProps = Parameters<typeof Workspace>[0];
async function show(props: WsProps) {
  await act(async () => { root!.render(<Workspace {...props} />); });
  await settle();
}

describe("the page changes under the panel (changeKey)", () => {
  it("Read refreshes in place: the new text shows with no reading skeleton in between", async () => {
    const host = new LiveHost();
    await show({ host, initialTab: "focus", changeKey: 0 });
    expect(el.textContent).toContain("Bring your passport.");
    host.page = { ...PAGE, blocks: [...PAGE.blocks, { id: "b3", kind: "paragraph", text: "Parking is behind the building." }] };
    await act(async () => { root!.render(<Workspace host={host} initialTab="focus" changeKey={1} />); });
    expect(el.querySelector(".ws-status")).toBeNull(); // never back to "Reading the page..."
    await settle();
    expect(el.textContent).toContain("Parking is behind the building.");
  });

  it("Fill a form keeps its step when the form is the same one", async () => {
    const host = new LiveHost();
    await show({ host, initialTab: "wayfill", changeKey: 0 });
    await act(async () => { button("Skip")!.click(); });
    await settle();
    expect(q("wf-step")?.textContent).toContain("Step 2 of 2");
    const builds = runMock.mock.calls.filter(([t]) => t === "buildWizard").length;
    const reads = vi.spyOn(host, "getForm");
    await show({ host, initialTab: "wayfill", changeKey: 1 });
    expect(reads).toHaveBeenCalled(); // the form was read again, and found to be the same one
    expect(q("wf-step")?.textContent).toContain("Step 2 of 2");
    expect(q("form-changed")).toBeNull();
    expect(runMock.mock.calls.filter(([t]) => t === "buildWizard").length).toBe(builds); // no new guide was built
  });

  it("Fill a form offers to start again when the form changed, and then starts at step 1", async () => {
    const host = new LiveHost();
    await show({ host, initialTab: "wayfill", changeKey: 0 });
    await act(async () => { button("Skip")!.click(); });
    await settle();
    host.form = { ...FORM, fingerprint: "fp2", fields: [{ fieldId: "ulice", kind: "text", label: "Ulice", required: false }] };
    await show({ host, initialTab: "wayfill", changeKey: 1 });
    expect(q("form-changed")?.textContent).toContain("This form changed");
    expect(q("wf-step")?.textContent).toContain("Step 2 of 2"); // nothing moved until the person chooses
    await act(async () => { button("Start again")!.click(); });
    await settle();
    expect(q("form-changed")).toBeNull();
    expect(q("wf-step")?.textContent).toContain("Step 1 of 1");
  });
});

describe("the guide keeps its place (GuideStore)", () => {
  const memoryStore = () => {
    const m = new Map<string, GuideState>();
    const store = {
      load: vi.fn(async (k: string) => m.get(k) ?? null),
      save: vi.fn(async (k: string, s: GuideState) => { m.set(k, structuredClone(s)); }),
      clear: vi.fn(async (k: string) => { m.delete(k); }),
    } satisfies GuideStore;
    return { m, store };
  };
  const type = async (id: string, v: string) => {
    const input = el.querySelector<HTMLInputElement>(`#wf-${id}`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("saves every step change and restores the step and answers after a reload", async () => {
    const { m, store } = memoryStore();
    await show({ host: new FakeHost(), initialTab: "wayfill", guideStore: store });
    await type("jmeno", "Jana");
    await act(async () => { button("Next")!.click(); });
    await settle();
    expect(m.get("fp")).toEqual({ stepIndex: 1, answers: { jmeno: "Jana" } });

    await act(async () => root!.unmount()); // the page is reloaded: a new panel, the same tab
    root = createRoot(el);
    await show({ host: new FakeHost(), initialTab: "wayfill", guideStore: store });
    expect(q("wf-step")?.textContent).toContain("Step 2 of 2");
    expect(q("wf-restored")?.textContent).toContain("back in the form");
    expect(q("wf-answered")?.textContent).toBe("1 of 2 answered"); // step 1's answer was written into the page again
    await act(async () => { button("Back")!.click(); });
    expect(el.querySelector<HTMLInputElement>("#wf-jmeno")?.value).toBe("Jana");
  });

  it("restores the step when the same tab loads the page again (refreshKey)", async () => {
    const { store } = memoryStore();
    const host = new FakeHost();
    await show({ host, initialTab: "wayfill", guideStore: store, refreshKey: 0 });
    await act(async () => { button("Skip")!.click(); });
    await settle();
    await show({ host, initialTab: "wayfill", guideStore: store, refreshKey: 1 });
    expect(q("wf-step")?.textContent).toContain("Step 2 of 2");
  });

  it("carries an answer over to the next page's field with the same label, and says so", async () => {
    const { m, store } = memoryStore();
    m.set("labels:https://office.example", { stepIndex: 0, answers: { "město": "Brno" } });
    const host = new LiveHost();
    host.form = { ...FORM, fingerprint: "page2", fields: [{ fieldId: "city2", kind: "text", label: "Město:*", required: true }] };
    await show({ host, initialTab: "wayfill", guideStore: store });
    expect(el.querySelector<HTMLInputElement>("#wf-city2")?.value).toBe("Brno");
    expect(q("carried-over")?.textContent).toContain("Carried over from the previous page");
    expect(q("wf-step")?.textContent).toContain("Step 1 of 1"); // the person still presses Next
    await type("city2", "Praha");
    expect(q("carried-over")).toBeNull();
  });

  it("Forget my answers clears what this device kept for the form and the site", async () => {
    const { m, store } = memoryStore();
    await show({ host: new FakeHost(), initialTab: "wayfill", guideStore: store });
    await type("jmeno", "Jana");
    await act(async () => { button("Next")!.click(); });
    await settle();
    expect(m.get("labels:https://office.example")?.answers).toEqual({ "jméno": "Jana" });
    await act(async () => { button("Forget my answers")!.click(); });
    await settle();
    expect(store.clear).toHaveBeenCalledWith("fp");
    expect(store.clear).toHaveBeenCalledWith("labels:https://office.example");
    expect(m.has("labels:https://office.example")).toBe(false);
    expect(m.get("fp")?.answers).toEqual({});
    expect(q("wf-kept")?.textContent).toContain("were forgotten");
  });
});

describe("the Agent view when the helper needs the person's OK", () => {
  it("offers Connect your helper program, which asks the shell to connect", async () => {
    const port = { onMessage: () => () => undefined, post: vi.fn(), disconnect: vi.fn() };
    const connect = vi.fn();
    await show({ host: new FakeHost(), handrail: port, onConnectHelper: connect });
    await key(document.body, "4");
    expect(q("handrail-connect")).not.toBeNull();
    await act(async () => { button("Connect your helper program")!.click(); });
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe("the narrow form", () => {
  it("the strip of views changes the view in one click and marks the current one", async () => {
    await mount(new FakeHost());
    const strip = q("view-strip")!;
    const item = (name: string) => [...strip.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name)!;
    expect(item("Read").getAttribute("aria-current")).toBe("page");
    await act(async () => { item("Fill a form").click(); });
    await settle();
    expect(selected()).toBe("tab-wayfill");
    expect(item("Fill a form").getAttribute("aria-current")).toBe("page");
    expect(item("Read").getAttribute("aria-current")).toBeNull();
    expect(el.querySelector(".ws-sec-views")).not.toBeNull(); // the sidebar's views, hidden by CSS in the narrow form
  });

  it("a view change and a step change start at the top, so the header is never scrolled away", async () => {
    await mount(new FakeHost());
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.spyOn(window, "scrollY", "get").mockReturnValue(600);
    await key(document.body, "2");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    scrollTo.mockClear();
    await act(async () => { button("Skip")!.click(); });
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });
});
