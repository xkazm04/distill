import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ChannelMessage, ChannelReply, HandrailTool } from "./types.js";
import { HandrailError } from "./types.js";

/**
 * The local channel between handrail-mcp (a client, started by the agent) and handrail-host (the server, started by
 * Chrome). It is a Windows named pipe or a unix domain socket, never a TCP port: a web page can only open http(s) and
 * ws(s) connections to TCP ports, so it has no way to name a pipe or a socket file. On top of that the server demands a
 * random token, held in a file only this user can read, as the first message. See PROTOCOL.md.
 */

export const MAX_LINE = 1024 * 1024;
const AUTH_TIMEOUT_MS = 3000;

export interface ChannelFile {
  v: 1;
  endpoint: string;
  token: string;
  pid: number;
}

export function channelDir(): string {
  if (process.platform === "win32") return join(process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "Distill", "handrail");
  return process.env["XDG_RUNTIME_DIR"] ? join(process.env["XDG_RUNTIME_DIR"], "distill-handrail") : join(homedir(), ".distill", "handrail");
}

/** HANDRAIL_CHANNEL_FILE overrides the path; it exists for tests and for people with an unusual profile. */
export function channelFilePath(): string {
  return process.env["HANDRAIL_CHANNEL_FILE"] ?? join(channelDir(), "channel.json");
}

export function newEndpoint(dir = channelDir()): string {
  const id = randomBytes(12).toString("hex");
  return process.platform === "win32" ? `\\\\.\\pipe\\distill-handrail-${id}` : join(dir, `h-${id}.sock`);
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function ensureUserOnlyDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dir, 0o700);
}

export function writeChannelFile(file: ChannelFile, path = channelFilePath()): void {
  ensureUserOnlyDir(dirname(path));
  writeFileSync(path, JSON.stringify(file), { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
}

export function readChannelFile(path = channelFilePath()): ChannelFile | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const f = JSON.parse(readFileSync(path, "utf8")) as Partial<ChannelFile>;
    if (f.v === 1 && typeof f.endpoint === "string" && typeof f.token === "string") return f as ChannelFile;
  } catch { /* fall through */ }
  return undefined;
}

export function removeChannelFile(path = channelFilePath()): void {
  try { rmSync(path, { force: true }); } catch { /* best effort */ }
}

export function tokensEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Splits a byte stream into newline-terminated JSON values; throws past MAX_LINE. */
export class LineDecoder {
  private buf = "";
  push(chunk: string): unknown[] {
    this.buf += chunk;
    const out: unknown[] = [];
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line.trim() !== "") out.push(JSON.parse(line));
    }
    if (this.buf.length > MAX_LINE) throw new Error("channel line too long");
    return out;
  }
}

export type CallHandler = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export class ChannelServer {
  private server?: net.Server;
  private readonly sockets = new Set<net.Socket>();
  constructor(private readonly token: string, private readonly handler: CallHandler) {}

  listen(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((s) => this.accept(s));
      this.server = server;
      server.once("error", reject);
      server.listen(endpoint, () => {
        server.off("error", reject);
        if (process.platform !== "win32") { try { chmodSync(endpoint, 0o600); } catch { /* ignore */ } }
        resolve();
      });
    });
  }

  private accept(socket: net.Socket): void {
    socket.setEncoding("utf8");
    this.sockets.add(socket);
    let authed = false;
    const decoder = new LineDecoder();
    const timer = setTimeout(() => { if (!authed) socket.destroy(); }, AUTH_TIMEOUT_MS);
    const send = (m: ChannelReply) => { if (!socket.destroyed) socket.write(JSON.stringify(m) + "\n"); };
    socket.on("close", () => { clearTimeout(timer); this.sockets.delete(socket); });
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: string) => {
      let msgs: unknown[];
      try { msgs = decoder.push(chunk); } catch { socket.destroy(); return; }
      for (const raw of msgs) {
        const m = raw as ChannelMessage;
        if (!authed) {
          // The first message must be a hello with the right token; anything else ends the connection unanswered.
          if (m && m.type === "hello" && typeof m.token === "string" && tokensEqual(m.token, this.token)) {
            authed = true;
            clearTimeout(timer);
            send({ type: "hello.ok", v: 1 });
          } else {
            socket.destroy();
            return;
          }
          continue;
        }
        if (m.type !== "call" || typeof m.id !== "string") continue;
        const id = m.id;
        this.handler(m.tool, (m.args ?? {}) as Record<string, unknown>).then(
          (result) => send({ id, type: "result", ok: true, result }),
          (e: unknown) => {
            const code = e instanceof HandrailError ? e.code : "internal";
            send({ id, type: "result", ok: false, error: { code, message: e instanceof Error ? e.message : String(e) } });
          },
        );
      }
    });
  }

  close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

export class ChannelClient {
  private socket?: net.Socket;
  private nextId = 1;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  /** Reads the channel file, connects and authenticates. Throws HandrailError("not_running") when Distill is not up. */
  static async connect(path = channelFilePath()): Promise<ChannelClient> {
    const file = readChannelFile(path);
    const notRunning = () => new HandrailError("not_running", "Distill is not open. Open Chrome with the Distill extension on a page, then try again.");
    if (!file) throw notRunning();
    const client = new ChannelClient();
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(file.endpoint);
      client.socket = socket;
      socket.setEncoding("utf8");
      const decoder = new LineDecoder();
      let ready = false;
      const fail = (e: Error) => { if (!ready) reject(notRunning()); client.failAll(e); };
      socket.once("error", fail);
      socket.on("close", () => fail(new HandrailError("closed", "The connection to Distill closed.")));
      socket.on("connect", () => socket.write(JSON.stringify({ type: "hello", token: file.token, v: 1 } satisfies ChannelMessage) + "\n"));
      socket.on("data", (chunk: string) => {
        let msgs: unknown[];
        try { msgs = decoder.push(chunk); } catch { socket.destroy(); return; }
        for (const raw of msgs) {
          const m = raw as ChannelReply;
          if (m.type === "hello.ok") { ready = true; resolve(); continue; }
          if (m.type !== "result") continue;
          const p = client.pending.get(m.id);
          if (!p) continue;
          client.pending.delete(m.id);
          if (m.ok) p.resolve(m.result);
          else p.reject(new HandrailError(m.error.code, m.error.message));
        }
      });
    });
    return client;
  }

  call(tool: HandrailTool, args: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new HandrailError("closed", "The connection to Distill closed."));
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.write(JSON.stringify({ id, type: "call", tool, args } satisfies ChannelMessage) + "\n");
    });
  }

  get connected(): boolean {
    return !!this.socket && !this.socket.destroyed;
  }

  close(): void {
    this.socket?.destroy();
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }
}
