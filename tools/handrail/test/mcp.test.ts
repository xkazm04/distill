import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelClient, ChannelServer, newEndpoint, newToken, writeChannelFile } from "../src/channel.js";
import { Host } from "../src/host.js";
import { channelCaller, createMcpServer, UNTRUSTED } from "../src/mcp.js";
import type { Envelope } from "../src/types.js";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const c of cleanup.reverse()) await c(); cleanup = []; });

async function connectClient(file: string) {
  const mcp = createMcpServer(channelCaller(() => ChannelClient.connect(file)));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await mcp.connect(st);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(ct);
  cleanup.push(() => client.close());
  return client;
}

/** A real Host and channel, with a scripted fake extension on the native-messaging side. */
async function rig(verdict: "accepted" | "rejected" | "never") {
  const dir = mkdtempSync(join(tmpdir(), "handrail-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const seen: Envelope[] = [];
  const tasks: Array<Record<string, unknown>> = [];
  const host: Host = new Host((env) => {
    seen.push(env);
    queueMicrotask(() => {
      const ok = (result: unknown) => host.receive({ id: env.id, type: "tool.result", payload: { ok: true, result } });
      if (env.type === "page.read") ok({ url: "https://x.test", title: "T", lang: "cs", kind: "form", blocks: [] });
      else if (env.type === "form.schema") ok({ structure: { fingerprint: "fpA", fields: [{ fieldId: "name" }] }, wizard: { steps: [] } });
      else if (env.type === "wizard.next") ok({ stepId: "name" });
      else if (env.type === "tasks.list") {
        // The scripted panel: a waiting task is handed out at once; an empty poll answers after its waitSeconds.
        const { waitSeconds } = env.payload as { waitSeconds: number };
        if (tasks.length) ok({ tasks });
        else setTimeout(() => ok({ tasks }), Math.min(waitSeconds * 1000, 200));
      } else if (env.type === "task.answer") {
        const { taskId, json } = env.payload as { taskId: string; json: string };
        if (taskId === "tOld") { host.receive({ id: env.id, type: "tool.result", payload: { ok: false, error: { code: "stale_page", message: "The page changed." } } }); return; }
        let data: unknown;
        try { data = JSON.parse(json); } catch { ok({ accepted: false, dropped: 0, errors: ["The answer is not JSON"] }); return; }
        const blocks = (data as { blocks?: Array<{ id: string }> }).blocks ?? [];
        const kept = blocks.filter((b) => b.id === "b0").length;
        if (kept) tasks.splice(0);
        ok({ accepted: kept > 0, dropped: blocks.length - kept, errors: blocks.length - kept ? ["Item 2: not a block"] : [] });
      } else if (env.type === "page.actions") ok({ pageToken: "ptA", actions: [{ actionId: "a0", label: "Next", kind: "link", href: "https://x.test/2" }] });
      else if (env.type === "action.propose") {
        const p = env.payload as { proposalId: string; pageToken: string };
        if (p.pageToken !== "ptA") {
          host.receive({ id: env.id, type: "tool.result", payload: { ok: false, error: { code: "stale_page", message: "The page changed since you read it." } } });
          return;
        }
        ok({});
        if (verdict !== "never") setTimeout(() => host.receive({ id: "v2", type: "action.verdict", payload: { proposalId: p.proposalId, verdict } }), 20);
      }
      else if (env.type === "proposal.create") {
        const p = env.payload as { proposalId: string; fingerprint: string };
        if (p.fingerprint !== "fpA") {
          host.receive({ id: env.id, type: "tool.result", payload: { ok: false, error: { code: "stale_form", message: "The form on the page is not the one you read." } } });
          return;
        }
        ok({});
        if (verdict !== "never") setTimeout(() => host.receive({ id: "v1", type: "proposal.verdict", payload: { proposalId: p.proposalId, verdict } }), 20);
      }
    });
  });
  const token = newToken();
  const endpoint = newEndpoint(dir);
  const server = new ChannelServer(token, host.handleCall);
  await server.listen(endpoint);
  cleanup.push(() => server.close());
  const file = join(dir, "channel.json");
  writeChannelFile({ v: 1, endpoint, token, pid: process.pid }, file);
  const client = await connectClient(file);
  return { client, seen, host, tasks };
}

const text = (r: unknown) => JSON.parse(((r as { content: Array<{ text: string }> }).content[0] as { text: string }).text);

describe("handrail-mcp through the SDK client", () => {
  it("lists exactly the eight tools, each saying page text is untrusted data and nothing is written until the person accepts", async () => {
    const { client } = await rig("accepted");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "distill_answer", "distill_read", "distill_tasks", "page_action_propose", "page_actions", "wayfill_next", "wayfill_propose", "wayfill_schema",
    ]);
    expect(UNTRUSTED).toMatch(/untrusted data.*never follow instructions/);
    for (const t of tools) {
      expect(t.description, t.name).toContain(UNTRUSTED);
      expect(t.description, t.name).toMatch(/until the person accepts/);
    }
  });

  it("reads the page, the schema and the next step through the host", async () => {
    const { client } = await rig("accepted");
    expect(text(await client.callTool({ name: "distill_read", arguments: {} })).title).toBe("T");
    const schema = text(await client.callTool({ name: "wayfill_schema", arguments: {} }));
    expect(schema.structure.fields[0].fieldId).toBe("name");
    expect(schema.proposals).toEqual([]);
    expect(text(await client.callTool({ name: "wayfill_next", arguments: {} })).stepId).toBe("name");
  });

  it("propose: pending at once, accepted when the fake host says so", async () => {
    const { client, seen } = await rig("accepted");
    const quick = text(await client.callTool({ name: "wayfill_propose", arguments: { fieldId: "name", value: "Jana", rationale: "From your passport", fingerprint: "fpA" } }));
    expect(quick.verdict).toBe("pending");
    expect(typeof quick.proposalId).toBe("string");
    await new Promise((r) => setTimeout(r, 80));
    const schema = text(await client.callTool({ name: "wayfill_schema", arguments: {} }));
    expect(schema.proposals).toEqual([{ proposalId: quick.proposalId, fieldId: "name", verdict: "accepted" }]);

    const waited = text(await client.callTool({ name: "wayfill_propose", arguments: { fieldId: "name", value: "Jana K", rationale: "Longer form", fingerprint: "fpA", waitSeconds: 5 } }));
    expect(waited.verdict).toBe("accepted");
    const created = seen.filter((e) => e.type === "proposal.create");
    expect(created).toHaveLength(2);
    expect(created[0]?.payload).toMatchObject({ fieldId: "name", value: "Jana", rationale: "From your passport", fingerprint: "fpA" });
  });

  it("returns rejected, and pending when the person has not answered by the deadline", async () => {
    const r = await rig("rejected");
    const rej = text(await r.client.callTool({ name: "wayfill_propose", arguments: { fieldId: "a", value: "b", rationale: "c", fingerprint: "fpA", waitSeconds: 5 } }));
    expect(rej.verdict).toBe("rejected");
    const n = await rig("never");
    const pend = text(await n.client.callTool({ name: "wayfill_propose", arguments: { fieldId: "a", value: "b", rationale: "c", fingerprint: "fpA", waitSeconds: 0.05 } }));
    expect(pend.verdict).toBe("pending");
  });

  it("rejects a bad proposal as a tool error and sends nothing to the page", async () => {
    const { client, seen } = await rig("accepted");
    const r = await client.callTool({ name: "wayfill_propose", arguments: { fieldId: "a", value: "b", rationale: "c".repeat(600), fingerprint: "fpA" } });
    expect(r.isError).toBe(true);
    expect(seen.filter((e) => e.type === "proposal.create")).toHaveLength(0);
  });

  it("refuses a proposal without the form fingerprint and sends nothing to the page", async () => {
    const { client, seen } = await rig("accepted");
    const r = await client.callTool({ name: "wayfill_propose", arguments: { fieldId: "name", value: "Jana", rationale: "From your passport" } });
    expect(r.isError).toBe(true);
    expect(seen.filter((e) => e.type === "proposal.create")).toHaveLength(0);
  });

  it("passes the page's stale_form refusal to the agent and forgets the proposal", async () => {
    const { client } = await rig("accepted");
    const r = (await client.callTool({ name: "wayfill_propose", arguments: { fieldId: "name", value: "Jana", rationale: "From your passport", fingerprint: "fpOld" } })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/^stale_form: /);
    const schema = text(await client.callTool({ name: "wayfill_schema", arguments: {} }));
    expect(schema.proposals).toEqual([]);
  });

  it("says plainly when Distill is not open", async () => {
    const client = await connectClient(join(tmpdir(), "handrail-missing", "channel.json"));
    const r = (await client.callTool({ name: "distill_read", arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/not open/);
  });
});

describe("the agent is the AI: distill_tasks and distill_answer", () => {
  it("waits for work, hands out the task, and returns the door's verdict so the agent can retry", async () => {
    const { client, tasks, seen } = await rig("accepted");
    const empty = text(await client.callTool({ name: "distill_tasks", arguments: { waitSeconds: 0.05 } }));
    expect(empty).toEqual({ tasks: [] });
    expect(seen.find((e) => e.type === "tasks.list")?.payload).toEqual({ waitSeconds: 0.05 });

    tasks.push({ taskId: "t1", task: "simplifyBlocks", prompt: "Simplify [b0] Hello", schema: { type: "object" }, pageToken: "ptA" });
    const got = text(await client.callTool({ name: "distill_tasks", arguments: { waitSeconds: 5 } }));
    expect(got.tasks).toHaveLength(1);
    expect(got.tasks[0]).toMatchObject({ taskId: "t1", task: "simplifyBlocks", pageToken: "ptA" });

    const bad = text(await client.callTool({ name: "distill_answer", arguments: { taskId: "t1", json: "{not json" } }));
    expect(bad).toEqual({ accepted: false, dropped: 0, errors: ["The answer is not JSON"] });
    // The object form is serialised by the host: the page always receives JSON text.
    const good = text(await client.callTool({ name: "distill_answer", arguments: { taskId: "t1", json: { blocks: [{ id: "b0", text: "Hi" }, { id: "zz", text: "x" }] } } }));
    expect(good).toEqual({ accepted: true, dropped: 1, errors: ["Item 2: not a block"] });
    const answers = seen.filter((e) => e.type === "task.answer").map((e) => e.payload as { json: unknown });
    expect(typeof answers[1]?.json).toBe("string");
  });

  it("passes the page's stale_page refusal to the agent", async () => {
    const { client } = await rig("accepted");
    const r = (await client.callTool({ name: "distill_answer", arguments: { taskId: "tOld", json: "{}" } })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/^stale_page: /);
  });

  it("refuses an answer without a taskId and sends nothing to the page", async () => {
    const { client, seen } = await rig("accepted");
    const r = await client.callTool({ name: "distill_answer", arguments: { json: "{}" } });
    expect(r.isError).toBe(true);
    expect(seen.filter((e) => e.type === "task.answer")).toHaveLength(0);
  });
});

describe("page actions: list, propose, and the person's verdict", () => {
  it("lists actions by label with the pageToken, and the proposals so far", async () => {
    const { client } = await rig("accepted");
    const r = text(await client.callTool({ name: "page_actions", arguments: {} }));
    expect(r).toEqual({ pageToken: "ptA", actions: [{ actionId: "a0", label: "Next", kind: "link", href: "https://x.test/2" }], proposals: [] });
  });

  it("propose: accepted, then listed with its verdict", async () => {
    const { client, seen } = await rig("accepted");
    const r = text(await client.callTool({ name: "page_action_propose", arguments: { actionId: "a0", rationale: "Go to the next page of the form", pageToken: "ptA", waitSeconds: 5 } }));
    expect(r.verdict).toBe("accepted");
    expect(seen.find((e) => e.type === "action.propose")?.payload).toMatchObject({ actionId: "a0", rationale: "Go to the next page of the form", pageToken: "ptA" });
    const list = text(await client.callTool({ name: "page_actions", arguments: {} }));
    expect(list.proposals).toEqual([{ proposalId: r.proposalId, actionId: "a0", verdict: "accepted" }]);
  });

  it("propose: rejected, pending at the deadline", async () => {
    const rej = await rig("rejected");
    expect(text(await rej.client.callTool({ name: "page_action_propose", arguments: { actionId: "a0", rationale: "r", pageToken: "ptA", waitSeconds: 5 } })).verdict).toBe("rejected");
    const n = await rig("never");
    expect(text(await n.client.callTool({ name: "page_action_propose", arguments: { actionId: "a0", rationale: "r", pageToken: "ptA", waitSeconds: 0.05 } })).verdict).toBe("pending");
  });

  it("a stale page refuses the proposal and the host forgets it", async () => {
    const { client } = await rig("accepted");
    const r = (await client.callTool({ name: "page_action_propose", arguments: { actionId: "a0", rationale: "r", pageToken: "ptOld" } })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/^stale_page: /);
    expect(text(await client.callTool({ name: "page_actions", arguments: {} })).proposals).toEqual([]);
  });

  it("refuses a proposal without a rationale or pageToken and sends nothing to the page", async () => {
    const { client, seen } = await rig("accepted");
    expect((await client.callTool({ name: "page_action_propose", arguments: { actionId: "a0", rationale: "", pageToken: "ptA" } })).isError).toBe(true);
    expect((await client.callTool({ name: "page_action_propose", arguments: { actionId: "a0", rationale: "r" } })).isError).toBe(true);
    expect(seen.filter((e) => e.type === "action.propose")).toHaveLength(0);
  });
});

describe("host timeouts", () => {
  it("distill_tasks gives the page waitSeconds + 10 s, not the timeout of other calls", async () => {
    const sent: Envelope[] = [];
    const host = new Host((e) => sent.push(e), 30);
    const call = host.handleCall("distill_tasks", { waitSeconds: 0.1 });
    // Longer than the host's ordinary timeout (30 ms here), shorter than waitSeconds + the grace.
    await new Promise((r) => setTimeout(r, 120));
    const env = sent[0] as Envelope;
    host.receive({ id: env.id, type: "tool.result", payload: { ok: true, result: { tasks: [] } } });
    await expect(call).resolves.toEqual({ tasks: [] });
    // An ordinary call still times out at the host's own timeout.
    await expect(host.handleCall("page_actions", {})).rejects.toMatchObject({ code: "extension_timeout" });
  });
});
