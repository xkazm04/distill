// The panel's side of "Your agent is the AI": the work queue over Handrail, page actions the person confirms, the
// activity trail, the connection from the port, and the privacy law (no envelope ever carries a typed value).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FormStructure, FormValues, PageAction, PageModel } from "@distill/engine";
import type { HandrailPort, HostToPanel, PanelToHost } from "./handrailTypes";
import type { PageHost } from "./host";
import { agentQueue } from "./agentQueue";
import { engine } from "./engine";
import { STALE_CLICK_FOR_PERSON } from "./HandrailPanel";
import { Workspace, type Tab } from "./Workspace";

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

const SENTINEL = "SENTINEL-VALUE-4711";
const PAGE: PageModel = {
  url: "https://office.example/form", title: "Form", lang: "cs", kind: "form",
  blocks: [{ id: "b0", kind: "paragraph", text: "Žádost se podává do 30 dnů." }, { id: "b1", kind: "list", text: "Jméno\nPříjmení" }],
  formCount: 1,
};
const FORM: FormStructure = {
  fingerprint: "fpA", url: PAGE.url, lang: "cs", title: "Form",
  fields: [
    { fieldId: "name", kind: "text", label: "Jméno", required: true },
    { fieldId: "email", kind: "email", label: "E-mail", required: false },
  ],
};
const ACTIONS: PageAction[] = [
  { actionId: "a0", label: "Next", kind: "link", href: "https://office.example/form/2" },
  { actionId: "a1", label: "Send", kind: "submit" },
];

/** The person has typed SENTINEL into the form: readValues returns it, as the real page would. */
class FakeHost implements PageHost {
  page: PageModel = PAGE;
  actions: PageAction[] = ACTIONS;
  clicks: string[] = [];
  writes: FormValues[] = [];
  label() { return "Fake page"; }
  async getPage() { return this.page; }
  async getForm() { return FORM; }
  async readValues(): Promise<FormValues> { return { name: SENTINEL, email: `${SENTINEL}@example.org` }; }
  async writeValues(_s: FormStructure, v: FormValues) { this.writes.push(v); return { written: Object.keys(v), failed: [] }; }
  async highlight() { /* nothing to outline */ }
  async showOriginal() { /* the original is elsewhere */ }
  async listActions() { return this.actions; }
  async doAction(id: string) { this.clicks.push(id); }
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

let root: Root | null = null;
let el: HTMLElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  el?.remove();
  agentQueue.failAll("cancelled");
  agentQueue.setProvider("distill");
});

async function settle(until: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!until()) {
    if (Date.now() > end) throw new Error("timed out waiting for the panel");
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

async function mount(initialTab: Tab, { agent = false, host = new FakeHost() } = {}) {
  const port = new FakePort();
  if (agent) agentQueue.setProvider("agent");
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => { root?.render(<Workspace host={host} handrail={port} initialTab={initialTab} />); });
  act(() => port.emit({ id: "s1", type: "status", payload: { connected: true } }));
  await settle(() => !!el.querySelector(".ws-title .muted"));
  return { host, port };
}

const q = (id: string) => el.querySelector(`[data-testid="${id}"]`);
const all = (id: string) => [...el.querySelectorAll(`[data-testid="${id}"]`)];
const button = (text: string, scope: ParentNode = el) => [...scope.querySelectorAll("button")].find((b) => b.textContent === text);
const click = async (b: Element | null | undefined) => { await act(async () => { (b as HTMLElement).click(); }); };
const trail = () => all("trail-line").map((l) => l.textContent?.replace(/^\S+\s/, "") ?? "");
const tabButton = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.startsWith(label));

describe("connected reflects the port", () => {
  it("follows the port's status, not the first request; the queue follows it too", async () => {
    const { port } = await mount("focus");
    expect(tabButton("Agent")?.textContent).toContain("Connected");
    expect(agentQueue.isConnected()).toBe(true);
    act(() => port.emit({ id: "s2", type: "status", payload: { connected: false, reason: "it stopped" } }));
    await settle(() => !!tabButton("Agent")?.textContent?.includes("Not connected"));
    expect(agentQueue.isConnected()).toBe(false);
  });

  it('offers "Who does the AI work" only while connected', async () => {
    const { port } = await mount("focus");
    expect(q("ai-provider")).not.toBeNull();
    expect(q("ai-provider")?.textContent).toContain("Who does the AI work");
    expect(q("ai-provider")?.textContent).toContain("My agent");
    await click(q("ai-provider-agent"));
    expect(agentQueue.getProvider()).toBe("agent");
    expect(localStorage.getItem("distill.aiProvider")).toBe("agent");
    act(() => port.emit({ id: "s2", type: "status", payload: { connected: false } }));
    await settle(() => !q("ai-provider"));
  });
});

describe("the agent is the AI, through the panel", () => {
  it("simplify: the task waits with Cancel and Use Distill's AI, the agent takes and answers it, the chip says Made by your agent", async () => {
    const { port } = await mount("focus", { agent: true });
    await settle(() => agentQueue.open().length === 1);
    expect(q("agent-task-waiting")?.textContent).toContain("Waiting for your agent...");
    expect(button("Cancel", q("agent-task-waiting") as ParentNode)).toBeTruthy();
    expect(button("Use Distill's AI instead", q("agent-task-waiting") as ParentNode)).toBeTruthy();

    act(() => port.emit({ id: "t1", type: "tasks.list", payload: { waitSeconds: 5 } }));
    await settle(() => !!port.answer("t1"));
    const listed = port.answer("t1") as { ok: true; result: { tasks: Array<{ taskId: string; task: string; prompt: string; pageToken: string }> } };
    expect(listed.result.tasks).toHaveLength(1);
    const task = listed.result.tasks[0]!;
    expect(task.task).toBe("simplifyBlocks");
    expect(task.prompt).toContain("[b0]");
    expect(task.pageToken).toBe(await engine.pageToken(PAGE));

    act(() => port.emit({ id: "a1", type: "task.answer", payload: { taskId: task.taskId, json: JSON.stringify({ blocks: [{ id: "b0", text: "Apply within 30 days." }, { id: "b9", text: "x" }] }) } }));
    await settle(() => !!port.answer("a1"));
    expect(port.answer("a1")).toEqual({ ok: true, result: { accepted: true, dropped: 1, errors: [expect.stringMatching(/b9/)] } });
    await settle(() => !!el.querySelector("article.reading")?.textContent?.includes("Apply within 30 days."));
    const chip = q("source-chip");
    expect(chip?.textContent).toContain("Made by your agent");
    expect(chip?.classList.contains("chip-agent")).toBe(true);
    expect(q("agent-task-waiting")).toBeNull();

    await click(tabButton("Agent"));
    expect(trail()).toEqual(expect.arrayContaining([
      "Your agent made this page easier to read - 1 block, 1 dropped",
      "Your agent took the task: make this page easier to read",
      "Your agent asked for work",
    ]));
  });

  it("refuses an answer for a page that changed (stale pageToken) and the view says so in plain words", async () => {
    const { port, host } = await mount("focus", { agent: true });
    await settle(() => agentQueue.open().length === 1);
    const [task] = agentQueue.open();
    host.page = { ...PAGE, blocks: [{ id: "b0", kind: "paragraph", text: "Something else now." }] };
    act(() => port.emit({ id: "a1", type: "task.answer", payload: { taskId: task!.taskId, json: JSON.stringify({ blocks: [{ id: "b0", text: "x" }] }) } }));
    await settle(() => !!port.answer("a1"));
    expect(port.answer("a1")).toMatchObject({ ok: false, error: { code: "stale_page" } });
    await settle(() => !!q("ai-problem"));
    expect(q("ai-problem")?.textContent).toContain("The page changed while your agent was working on it.");
  });

  it("buildWizard: the form guide built by the agent shows its chip", async () => {
    // The person opens Fill a form once the helper program is connected (the panel shows Read first).
    const { port } = await mount("focus", { agent: true });
    await click(tabButton("Fill a form"));
    await settle(() => agentQueue.open().some((t) => t.task === "buildWizard"));
    const task = agentQueue.open().find((t) => t.task === "buildWizard")!;
    expect(task.prompt).not.toContain(SENTINEL);
    const steps = [{ stepId: "s1", fieldIds: ["name"], question: "What is your first name?", explanation: "As in your passport." }, { stepId: "s2", fieldIds: ["email"], question: "Your email?", explanation: "" }];
    act(() => port.emit({ id: "a1", type: "task.answer", payload: { taskId: task.taskId, json: JSON.stringify({ steps }) } }));
    await settle(() => !!port.answer("a1"));
    expect(port.answer("a1")).toEqual({ ok: true, result: { accepted: true, dropped: 0, errors: [] } });
    await settle(() => !!el.querySelector(".wayfill")?.textContent?.includes("What is your first name?"));
    expect(q("source-chip")?.textContent).toContain("Made by your agent");
    await click(tabButton("Agent"));
    expect(trail()).toContain("Your agent built the form guide - 2 steps, 0 dropped");
  });

  it('"Use Distill\'s AI instead" ends the wait and runs the task the usual way', async () => {
    await mount("focus", { agent: true });
    await settle(() => agentQueue.open().length === 1);
    await click(q("agent-use-distill"));
    await settle(() => agentQueue.open().length === 0 && !!q("source-chip"));
    expect(q("source-chip")?.textContent).not.toContain("Made by your agent"); // the dev fake AI here
  });
});

describe("the panel's door for proposals", () => {
  it("refuses a field proposal for a field the form does not have", async () => {
    const { port } = await mount("handrail");
    act(() => port.emit({ id: "c1", type: "proposal.create", payload: { proposalId: "p1", fieldId: "nope", value: "x", rationale: "r", fingerprint: "fpA" } }));
    await settle(() => !!port.answer("c1"));
    expect(port.answer("c1")).toMatchObject({ ok: false, error: { code: "bad_request" } });
    expect(all("proposal")).toHaveLength(0);
  });

  it("page.read carries the pageToken", async () => {
    const { port } = await mount("focus");
    act(() => port.emit({ id: "r1", type: "page.read", payload: {} }));
    await settle(() => !!port.answer("r1"));
    expect(port.answer("r1")).toEqual({ ok: true, result: { ...PAGE, pageToken: await engine.pageToken(PAGE) } });
  });
});

describe("page actions: list, propose, accept, reject", () => {
  const propose = async (port: FakePort, over: Record<string, string> = {}, id = "p1") => {
    const token = await engine.pageToken(PAGE);
    act(() => port.emit({ id: `x-${id}`, type: "action.propose", payload: { proposalId: id, actionId: "a0", rationale: "Go to the next page of the form", pageToken: token, ...over } }));
    await settle(() => !!port.answer(`x-${id}`));
    return port.answer(`x-${id}`);
  };

  it("lists the actions with the pageToken", async () => {
    const { port } = await mount("focus");
    act(() => port.emit({ id: "l1", type: "page.actions", payload: {} }));
    await settle(() => !!port.answer("l1"));
    expect(port.answer("l1")).toEqual({ ok: true, result: { pageToken: await engine.pageToken(PAGE), actions: ACTIONS } });
  });

  it("shows the card; Accept clicks it, sends the verdict and reads the page again", async () => {
    const { port, host } = await mount("handrail");
    expect(await propose(port)).toEqual({ ok: true, result: {} });
    await settle(() => all("action-proposal").length === 1);
    expect(q("action-proposal")?.textContent).toContain('Your agent wants to click "Next"');
    expect(q("action-proposal")?.textContent).toContain("Why: Go to the next page of the form");
    expect(q("action-submit")).toBeNull();
    const reads = { n: 0 };
    const getPage = host.getPage.bind(host);
    host.getPage = async () => { reads.n++; return getPage(); };
    await click(button("Accept", q("action-proposal") as ParentNode));
    await settle(() => port.posts.some((p) => p.type === "action.verdict"));
    expect(host.clicks).toEqual(["a0"]);
    expect(port.posts.find((p) => p.type === "action.verdict")?.payload).toEqual({ proposalId: "p1", verdict: "accepted" });
    await settle(() => reads.n >= 2); // the check before the click, then the panel reads the page again
    expect(all("action-proposal")).toHaveLength(0);
    expect(trail()).toContain('Your agent wants to click "Next"');
  });

  it('a submit says "This sends the form."; Reject clicks nothing', async () => {
    const { port, host } = await mount("handrail");
    await propose(port, { actionId: "a1" });
    await settle(() => !!q("action-submit"));
    expect(q("action-submit")?.textContent).toBe("This sends the form.");
    await click(button("Reject", q("action-proposal") as ParentNode));
    await settle(() => port.posts.some((p) => p.type === "action.verdict"));
    expect(port.posts.find((p) => p.type === "action.verdict")?.payload).toEqual({ proposalId: "p1", verdict: "rejected" });
    expect(host.clicks).toEqual([]);
  });

  it("refuses a proposal for a changed page or an unknown action, and clicks nothing when the page changed before Accept", async () => {
    const { port, host } = await mount("handrail");
    expect(await propose(port, { pageToken: "old" }, "p0")).toMatchObject({ ok: false, error: { code: "stale_page" } });
    expect(await propose(port, { actionId: "a9" }, "p9")).toMatchObject({ ok: false, error: { code: "bad_request" } });
    await propose(port);
    await settle(() => all("action-proposal").length === 1);
    host.page = { ...PAGE, blocks: [{ id: "b0", kind: "paragraph", text: "Page two." }] };
    await click(button("Accept", q("action-proposal") as ParentNode));
    await settle(() => !!q("handrail-message"));
    expect(q("handrail-message")?.textContent).toBe(STALE_CLICK_FOR_PERSON);
    expect(host.clicks).toEqual([]);
    expect(port.posts.some((p) => p.type === "action.verdict")).toBe(false);
  });
});

describe("the activity trail", () => {
  it("logs every agent request as one plain line with its time, and counts repeats", async () => {
    const { port } = await mount("handrail");
    act(() => port.emit({ id: "r1", type: "page.read", payload: {} }));
    act(() => port.emit({ id: "r2", type: "form.schema", payload: {} }));
    act(() => port.emit({ id: "r3", type: "page.actions", payload: {} }));
    await settle(() => !!port.answer("r1") && !!port.answer("r2") && !!port.answer("r3"));
    act(() => port.emit({ id: "t1", type: "tasks.list", payload: { waitSeconds: 0 } }));
    act(() => port.emit({ id: "t2", type: "tasks.list", payload: { waitSeconds: 0 } }));
    await settle(() => !!port.answer("t2"));
    act(() => port.emit({ id: "c1", type: "proposal.create", payload: { proposalId: "p1", fieldId: "name", value: "Jana", rationale: "r", fingerprint: "fpA" } }));
    await settle(() => !!port.answer("c1"));
    const lines = trail();
    expect(lines).toEqual(expect.arrayContaining([
      "Your agent read this page",
      "Your agent read the form - 2 fields",
      "Your agent looked at what can be clicked - 2 buttons and links",
      "Your agent asked for work (2 times)",
      'Your agent suggested an answer for "Jméno"',
    ]));
    for (const l of all("trail-line")) expect(l.querySelector("time")?.getAttribute("datetime")).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});

describe("privacy: no Handrail envelope ever contains a typed value", () => {
  it("drives every request with the guide open and values in the page; the sentinel never leaves", async () => {
    // The person opens Fill a form once the helper program is connected (the panel shows Read first).
    const { port } = await mount("focus", { agent: true });
    await click(tabButton("Fill a form"));
    await settle(() => agentQueue.open().some((t) => t.task === "buildWizard"));
    // The guide is open with the person's (sentinel) values read from the page.
    act(() => port.emit({ id: "r1", type: "page.read", payload: {} }));
    act(() => port.emit({ id: "r2", type: "form.schema", payload: {} }));
    act(() => port.emit({ id: "r3", type: "page.actions", payload: {} }));
    act(() => port.emit({ id: "r4", type: "tasks.list", payload: { waitSeconds: 0 } }));
    await settle(() => ["r1", "r2", "r3", "r4"].every((id) => !!port.answer(id)));
    const task = agentQueue.open().find((t) => t.task === "buildWizard")!;
    act(() => port.emit({ id: "r5", type: "task.answer", payload: { taskId: task.taskId, json: JSON.stringify({ steps: [{ stepId: "s1", fieldIds: ["name"], question: "Name?", explanation: "" }] }) } }));
    await settle(() => !!port.answer("r5"));
    await settle(() => !!el.querySelector(".wayfill")?.textContent?.includes("Name?"));
    act(() => port.emit({ id: "r6", type: "wizard.next", payload: {} }));
    act(() => port.emit({ id: "r7", type: "proposal.create", payload: { proposalId: "p1", fieldId: "name", value: "Jana", rationale: "r", fingerprint: "fpA" } }));
    const token = await engine.pageToken(PAGE);
    act(() => port.emit({ id: "r8", type: "action.propose", payload: { proposalId: "p2", actionId: "a0", rationale: "next", pageToken: token } }));
    await settle(() => ["r6", "r7", "r8"].every((id) => !!port.answer(id)));
    await click(tabButton("Agent"));
    await click(button("Reject", q("proposal") as ParentNode));
    await click(button("Accept", q("action-proposal") as ParentNode));
    await settle(() => port.posts.filter((p) => p.type.endsWith(".verdict")).length === 2);

    expect(port.posts.length).toBeGreaterThan(9);
    const wire = JSON.stringify(port.posts);
    expect(wire).not.toContain(SENTINEL);
    // The values were really there, in the guide.
    expect([...el.querySelectorAll<HTMLInputElement>(".wayfill input")].some((i) => i.value.includes(SENTINEL))).toBe(true);
  });
});
