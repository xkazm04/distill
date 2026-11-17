import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelClient, ChannelServer, newEndpoint, newToken, writeChannelFile } from "../src/channel.js";
import { Host } from "../src/host.js";
import { channelCaller, createMcpServer } from "../src/mcp.js";
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
  const host: Host = new Host((env) => {
    seen.push(env);
    queueMicrotask(() => {
      const ok = (result: unknown) => host.receive({ id: env.id, type: "tool.result", payload: { ok: true, result } });
      if (env.type === "page.read") ok({ url: "https://x.test", title: "T", lang: "cs", kind: "form", blocks: [] });
      else if (env.type === "form.schema") ok({ structure: { fields: [{ fieldId: "name" }] }, wizard: { steps: [] } });
      else if (env.type === "wizard.next") ok({ stepId: "name" });
      else if (env.type === "proposal.create") {
        ok({});
        const p = env.payload as { proposalId: string };
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
  return { client, seen, host };
}

const text = (r: unknown) => JSON.parse(((r as { content: Array<{ text: string }> }).content[0] as { text: string }).text);

describe("handrail-mcp through the SDK client", () => {
  it("lists exactly the four tools, each saying nothing is written until the person accepts", async () => {
    const { client } = await rig("accepted");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["distill_read", "wayfill_next", "wayfill_propose", "wayfill_schema"]);
    for (const t of tools) expect(t.description).toMatch(/until the person accepts/);
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
    const quick = text(await client.callTool({ name: "wayfill_propose", arguments: { fieldId: "name", value: "Jana", rationale: "From your passport" } }));
    expect(quick.verdict).toBe("pending");
    expect(typeof quick.proposalId).toBe("string");
    await new Promise((r) => setTimeout(r, 80));
    const schema = text(await client.callTool({ name: "wayfill_schema", arguments: {} }));
    expect(schema.proposals).toEqual([{ proposalId: quick.proposalId, fieldId: "name", verdict: "accepted" }]);

    const waited = text(await client.callTool({ name: "wayfill_propose", arguments: { fieldId: "name", value: "Jana K", rationale: "Longer form", waitSeconds: 5 } }));
    expect(waited.verdict).toBe("accepted");
    const created = seen.filter((e) => e.type === "proposal.create");
    expect(created).toHaveLength(2);
    expect(created[0]?.payload).toMatchObject({ fieldId: "name", value: "Jana", rationale: "From your passport" });
  });

  it("returns rejected, and pending when the person has not answered by the deadline", async () => {
    const r = await rig("rejected");
    const rej = text(await r.client.callTool({ name: "wayfill_propose", arguments: { fieldId: "a", value: "b", rationale: "c", waitSeconds: 5 } }));
    expect(rej.verdict).toBe("rejected");
    const n = await rig("never");
    const pend = text(await n.client.callTool({ name: "wayfill_propose", arguments: { fieldId: "a", value: "b", rationale: "c", waitSeconds: 0.05 } }));
    expect(pend.verdict).toBe("pending");
  });

  it("rejects a bad proposal as a tool error and sends nothing to the page", async () => {
    const { client, seen } = await rig("accepted");
    const r = await client.callTool({ name: "wayfill_propose", arguments: { fieldId: "a", value: "b", rationale: "c".repeat(600) } });
    expect(r.isError).toBe(true);
    expect(seen.filter((e) => e.type === "proposal.create")).toHaveLength(0);
  });

  it("says plainly when Distill is not open", async () => {
    const client = await connectClient(join(tmpdir(), "handrail-missing", "channel.json"));
    const r = (await client.callTool({ name: "distill_read", arguments: {} })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/not open/);
  });
});
