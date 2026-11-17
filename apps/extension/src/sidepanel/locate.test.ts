// The extension host end to end inside the panel: the shared Workspace over a real TabHost, with chrome.tabs mocked.
// Pointing at a block in Read, every step of Fill a form and a New layout source link each send distill:locate to the
// tab, because the tab is always beside the panel.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormStructure, PageModel } from "@distill/engine";
import type { ContentRequest } from "../messages";

// Hermetic: no Firebase config whatever .env the checkout has; the AI answers from here.
vi.mock("@distill/web/firebase", async (orig) => ({ ...(await orig<typeof import("@distill/web/firebase")>()), isFirebaseConfigured: () => false }));
const runMock = vi.hoisted(() => vi.fn());
vi.mock("@distill/web/ai", async (orig) => ({ ...(await orig<typeof import("@distill/web/ai")>()), run: runMock }));

const { Workspace } = await import("@distill/web/ui");
const { TabHost } = await import("./host");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE: PageModel = {
  url: "https://office.example/visit", title: "Visit", lang: "cs", kind: "form", formCount: 1,
  blocks: [{ id: "b0", kind: "heading", level: 2, text: "Hours" }, { id: "b1", kind: "paragraph", text: "Open on Monday." }],
};
const FORM: FormStructure = {
  fingerprint: "fp", url: PAGE.url, lang: "cs", title: "Žádost",
  fields: [{ fieldId: "jmeno", kind: "text", label: "Jméno", required: false }, { fieldId: "mesto", kind: "text", label: "Město", required: false }],
};
const ok = <T,>(data: T) => ({ data, source: "on_device", ms: 1, reason: "Ran on this device." });

const sent: ContentRequest[] = [];
const sendMessage = vi.fn(async (_tabId: number, req: ContentRequest) => {
  sent.push(req);
  const data: Record<string, unknown> = {
    "distill:getPage": PAGE, "distill:getForm": FORM, "distill:readValues": {}, "distill:ping": { ready: true },
  };
  return { ok: true, data: data[req.type] ?? { ok: true } };
});

let root: Root;
let el: HTMLElement;
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  (globalThis as { chrome?: unknown }).chrome = { tabs: { sendMessage }, scripting: { executeScript: vi.fn() } };
  runMock.mockReset().mockImplementation(async (task: string) => {
    if (task === "simplifyBlocks") return ok({ blocks: [] });
    if (task === "buildWizard") return ok({ steps: FORM.fields.map((f) => ({ stepId: f.fieldId, fieldIds: [f.fieldId], question: `What is ${f.label}?`, explanation: "Plain words." })) });
    if (task === "recast") return ok({ version: 1, nodes: [{ kind: "summary", title: "In short", text: "Open Monday.", sourceBlockIds: ["b1"] }] });
    throw new Error(task);
  });
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => root.unmount()); el.remove(); });

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const locates = () => sent.filter((r): r is Extract<ContentRequest, { type: "distill:locate" }> => r.type === "distill:locate");
async function mount(initialTab: "focus" | "wayfill" | "recast") {
  await act(async () => root.render(createElement(Workspace, { host: new TabHost(3, () => "Visit"), initialTab })));
  await settle();
}

describe("locate in the extension host", () => {
  it("has no Original control: the tab is the original", async () => {
    await mount("focus");
    expect(el.querySelector('[data-testid="original-control"]')).toBeNull();
  });

  it("Read: pointing at a block sends distill:locate for it, in the panel's focus colour", async () => {
    await mount("focus");
    await act(async () => { el.querySelector('[data-block="b1"]')!.dispatchEvent(new Event("pointerover", { bubbles: true })); });
    await settle();
    const last = locates().at(-1)!;
    expect(last.target).toEqual({ blockId: "b1" });
    expect(last.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("Fill a form: each step sends distill:locate for its fields", async () => {
    await mount("wayfill");
    expect(locates().at(-1)?.target).toEqual({ fieldIds: ["jmeno"] });
    const skip = [...el.querySelectorAll("button")].find((b) => b.textContent === "Skip")!;
    await act(async () => { skip.click(); });
    await settle();
    expect(locates().at(-1)?.target).toEqual({ fieldIds: ["mesto"] });
  });

  it("New layout: a source link sends distill:locate for its block", async () => {
    await mount("recast");
    expect(runMock).toHaveBeenCalledWith("recast", expect.anything(), expect.anything(), expect.anything()); // the mocks hold
    await act(async () => { el.querySelector<HTMLButtonElement>(".src")!.click(); });
    await settle();
    expect(locates().at(-1)?.target).toEqual({ blockId: "b1" });
  });
});
