#!/usr/bin/env node
// Chrome native messaging host. stdout carries ONLY framed messages; every log line goes to stderr.
import { ChannelServer, channelDir, channelFilePath, ensureUserOnlyDir, newEndpoint, newToken, removeChannelFile, writeChannelFile } from "../channel.js";
import { FrameDecoder, encodeMessage } from "../framing.js";
import { Host } from "../host.js";
import type { Envelope } from "../types.js";

const host = new Host((env) => process.stdout.write(encodeMessage(env)));
const token = newToken();
const server = new ChannelServer(token, host.handleCall);
ensureUserOnlyDir(channelDir());
const endpoint = newEndpoint();
await server.listen(endpoint);
writeChannelFile({ v: 1, endpoint, token, pid: process.pid });

let closing = false;
async function stop(code: number): Promise<never> {
  if (!closing) {
    closing = true;
    host.shutdown();
    removeChannelFile(channelFilePath());
    await server.close();
  }
  process.exit(code);
}

const decoder = new FrameDecoder();
process.stdin.on("data", (chunk: Buffer) => {
  try {
    for (const m of decoder.push(chunk)) host.receive(m as Envelope);
  } catch (e) {
    console.error("handrail-host: bad frame", e);
    void stop(1);
  }
});
process.stdin.on("end", () => void stop(0));
process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
