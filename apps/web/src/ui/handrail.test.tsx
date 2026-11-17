import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FormStructure, FormValues, PageModel } from "@distill/engine";
import type { HandrailPort, HostToPanel, PanelToHost, ProposalCreate } from "./handrailTypes";
import type { PageHost } from "./host";
import { STALE_FOR_PERSON } from "./HandrailPanel";
import { Workspace, type Tab } from "./Workspace";

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

const PAGE: PageModel = { url: "https://office.example/form", title: "Form", lang: "cs", kind: "form", blocks: [{ id: "b0", kind: "paragraph", text: "Hello" }], formCount: 1 };
const form = (fingerprint: string): FormStructure => ({
  fingerprint, url: PAGE.url, lang: "cs", title: "Form",
  fields: [
    { fieldId: "name", kind: "text", label: "Jméno", required: true },
    { fieldId: "email", kind: "email", label: "E-mail", required: false },
  ],
});

/** A page whose form can change under the panel (same host object, new fingerprint). */
class FakeHost implements PageHost {
  structure = form("fpA");
  writes: FormValues[] = [];
  label() { return "Fake page"; }
  async getPage() { return PAGE; }
  async getForm() { return this.structure; }
  async readValues() { return {}; }
  async writeValues(_s: FormStructure, v: FormValues) { this.writes.push(v); return { written: Object.keys(v), failed: [] }; }
  async highlight() { /* nothing to outline */ }
  async showOriginal() { /* the original is elsewhere */ }
}

class FakePort implements HandrailPort {
  subs = new Set<(e: HostToPanel) => void>();
  posts: PanelToHost[] = [];
  onMessage(cb: (e: HostToPanel) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  post(e: PanelToHost) { this.posts.push(e); }
  disconnect() { this.subs.clear(); }
  emit(e: HostToPanel) { this.subs.forEach((cb) => cb(e)); }
  answer(id: string) { return this.posts.find((p) => p.type === "tool.result" && p.id === id)?.payload; }
}

const proposal = (over: Partial<ProposalCreate> = {}): ProposalCreate => ({
  proposalId: "p1", fieldId: "name", value: "Jana", rationale: "From your passport", fingerprint: "fpA", ...over,
});

let root: Root | null = null;
let el: HTMLElement;
afterEach(() => { act(() => root?.unmount()); root = null; el?.remove(); });

async function settle(until: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!until()) {
    if (Date.now() > end) throw new Error("timed out waiting for the panel");
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

async function mount(initialTab: Tab) {
  const host = new FakeHost();
  const port = new FakePort();
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => { root?.render(<Workspace host={host} handrail={port} initialTab={initialTab} />); });
  await settle(() => !!el.querySelector(".ws-title .muted")); // the page has been read
  return { host, port };
}

const q = (id: string) => el.querySelector(`[data-testid="${id}"]`);
const tabButton = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.startsWith(label));
const click = async (b: Element | null | undefined) => { await act(async () => { (b as HTMLElement).click(); }); };

describe("Handrail answers whichever tab is open", () => {
  it("answers page.read and form.schema with the Read tab active", async () => {
    const { port } = await mount("focus");
    act(() => port.emit({ id: "r1", type: "page.read", payload: {} }));
    act(() => port.emit({ id: "r2", type: "form.schema", payload: {} }));
    await settle(() => !!port.answer("r1") && !!port.answer("r2"));
    expect(port.answer("r1")).toEqual({ ok: true, result: { ...PAGE, pageToken: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    const schema = port.answer("r2") as { ok: true; result: { structure: FormStructure; wizard: { fingerprint: string } } };
    expect(schema.ok).toBe(true);
    expect(schema.result.structure.fingerprint).toBe("fpA");
    expect(schema.result.wizard.fingerprint).toBe("fpA");
    expect(JSON.stringify(schema)).not.toContain("Jana");
  });

  it("shows a proposal that arrives while the form guide is open, with a badge on the Agent tab", async () => {
    const { port } = await mount("wayfill");
    act(() => port.emit({ id: "c1", type: "proposal.create", payload: proposal() }));
    await settle(() => !!port.answer("c1"));
    expect(port.answer("c1")).toEqual({ ok: true, result: {} });
    expect(q("agent-badge")?.textContent).toBe("1 waiting");
    expect(q("agent-waiting")?.textContent).toMatch(/suggested an answer/);
    expect(tabButton("Fill a form")?.getAttribute("aria-selected")).toBe("true");

    await click(tabButton("Agent"));
    expect(q("agent-badge")).toBeNull();
    expect(el.querySelectorAll('[data-testid="proposal"]')).toHaveLength(1);
    expect(q("proposal")?.textContent).toContain("Jméno");
  });

  it("moves the open guide from another tab once the person has opened Fill a form", async () => {
    const { port } = await mount("wayfill");
    await settle(() => !!el.querySelector(".wayfill"));
    await click(tabButton("Read"));
    expect((q("wayfill-pane") as HTMLElement).hidden).toBe(true);
    act(() => port.emit({ id: "n1", type: "wizard.next", payload: {} }));
    await settle(() => !!port.answer("n1"));
    expect(port.answer("n1")).toMatchObject({ ok: true, result: { stepId: "email", fieldIds: ["email"] } });
  });

  it("says the guide is not open when the person never opened Fill a form", async () => {
    const { port } = await mount("focus");
    act(() => port.emit({ id: "n1", type: "wizard.next", payload: {} }));
    await settle(() => !!port.answer("n1"));
    expect(port.answer("n1")).toMatchObject({ ok: false, error: { code: "extension_error" } });
  });
});

describe("a proposal is bound to the form the agent read", () => {
  it("refuses a proposal made for another form, and shows nothing", async () => {
    const { port } = await mount("handrail");
    act(() => port.emit({ id: "c1", type: "proposal.create", payload: proposal({ fingerprint: "fpOld" }) }));
    await settle(() => !!port.answer("c1"));
    expect(port.answer("c1")).toMatchObject({ ok: false, error: { code: "stale_form" } });
    expect(el.querySelectorAll('[data-testid="proposal"]')).toHaveLength(0);
  });

  it("refuses a proposal without a fingerprint", async () => {
    const { port } = await mount("handrail");
    const { fingerprint: _drop, ...bare } = proposal();
    act(() => port.emit({ id: "c1", type: "proposal.create", payload: bare as ProposalCreate }));
    await settle(() => !!port.answer("c1"));
    expect(port.answer("c1")).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });

  it("writes nothing when the page changed between the proposal and Accept", async () => {
    const { host, port } = await mount("handrail");
    act(() => port.emit({ id: "c1", type: "proposal.create", payload: proposal() }));
    await settle(() => !!q("proposal"));
    host.structure = form("fpB"); // the person moved to another form in the same tab
    const accept = [...el.querySelectorAll("button")].find((b) => b.textContent === "Accept");
    await click(accept);
    await settle(() => !!q("handrail-message"));
    expect(q("handrail-message")?.textContent).toBe(STALE_FOR_PERSON);
    expect(host.writes).toEqual([]);
    expect(port.posts.some((p) => p.type === "proposal.verdict")).toBe(false);
    expect(q("proposal-stale")).not.toBeNull();
  });

  it("writes the field and sends the verdict when the form is the one the agent read", async () => {
    const { host, port } = await mount("handrail");
    act(() => port.emit({ id: "c1", type: "proposal.create", payload: proposal() }));
    await settle(() => !!q("proposal"));
    await click([...el.querySelectorAll("button")].find((b) => b.textContent === "Accept"));
    await settle(() => port.posts.some((p) => p.type === "proposal.verdict"));
    expect(host.writes).toEqual([{ name: "Jana" }]);
    expect(port.posts.find((p) => p.type === "proposal.verdict")?.payload).toEqual({ proposalId: "p1", verdict: "accepted" });
  });
});
