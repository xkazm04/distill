import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelClient, ChannelServer, newEndpoint, newToken, readChannelFile, tokensEqual, writeChannelFile } from "../src/channel.js";
import { HandrailError } from "../src/types.js";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const c of cleanup.reverse()) await c(); cleanup = []; });

async function setup(handler: (tool: string) => Promise<unknown> = async (tool) => ({ tool })) {
  const dir = mkdtempSync(join(tmpdir(), "handrail-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const token = newToken();
  const endpoint = newEndpoint(dir);
  const server = new ChannelServer(token, handler);
  await server.listen(endpoint);
  cleanup.push(() => server.close());
  const file = join(dir, "channel.json");
  writeChannelFile({ v: 1, endpoint, token, pid: process.pid }, file);
  return { token, endpoint, file };
}

describe("channel auth", () => {
  it("lets a client with the token call", async () => {
    const { file } = await setup();
    const c = await ChannelClient.connect(file);
    cleanup.push(() => c.close());
    expect(await c.call("distill_read", {})).toEqual({ tool: "distill_read" });
  });
  it("carries handler errors with their code", async () => {
    const { file } = await setup(async () => { throw new HandrailError("bad_request", "nope"); });
    const c = await ChannelClient.connect(file);
    cleanup.push(() => c.close());
    await expect(c.call("wayfill_propose", {})).rejects.toMatchObject({ code: "bad_request" });
  });
  it("drops a connection with the wrong token, without answering", async () => {
    const { endpoint } = await setup();
    const got = await new Promise<string>((resolve) => {
      const s = net.connect(endpoint);
      let data = "";
      s.on("connect", () => s.write(JSON.stringify({ type: "hello", token: "wrong", v: 1 }) + "\n"));
      s.on("data", (d) => (data += d));
      s.on("close", () => resolve(data));
      s.on("error", () => resolve(data));
    });
    expect(got).toBe("");
  });
  it("never runs a call that skips the hello", async () => {
    let ran = false;
    const { endpoint } = await setup(async () => { ran = true; return {}; });
    await new Promise<void>((resolve) => {
      const s = net.connect(endpoint);
      s.on("connect", () => s.write(JSON.stringify({ id: "1", type: "call", tool: "distill_read", args: {} }) + "\n"));
      s.on("close", () => resolve());
      s.on("error", () => resolve());
    });
    expect(ran).toBe(false);
  });
  it("reports not_running when there is no channel file or nobody listens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "handrail-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    await expect(ChannelClient.connect(join(dir, "none.json"))).rejects.toMatchObject({ code: "not_running" });
    const file = join(dir, "stale.json");
    writeChannelFile({ v: 1, endpoint: newEndpoint(dir), token: "t", pid: 1 }, file);
    expect(readChannelFile(file)?.token).toBe("t");
    await expect(ChannelClient.connect(file)).rejects.toMatchObject({ code: "not_running" });
  });
  it("compares tokens without length leaks and generates distinct ones", () => {
    expect(tokensEqual("a", "a")).toBe(true);
    expect(tokensEqual("a", "ab")).toBe(false);
    expect(newToken()).not.toBe(newToken());
  });
});
