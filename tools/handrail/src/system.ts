// The real machine behind SetupEnv: the file system, HKCU through reg.exe, and the agent CLIs.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import type { Fs, Registry, Run, RunResult } from "./agent-setup.js";

export const realFs: Fs = {
  exists: (p) => existsSync(p),
  read: (p) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } },
  write: (p, text, executable) => {
    writeFileSync(p, text);
    if (executable && process.platform !== "win32") chmodSync(p, 0o755);
  },
  remove: (p) => rmSync(p, { force: true }),
  mkdirp: (p) => { mkdirSync(p, { recursive: true }); },
  removeDirIfEmpty: (p) => { try { if (readdirSync(p).length === 0) rmdirSync(p); } catch { /* not there */ } },
};

function reg(args: string[]): RunResult {
  return realRun("reg", args);
}

/** Reads the default value from `reg query <key> /ve` output. */
export function parseRegQuery(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const m = /\sREG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line);
    if (m?.[1] !== undefined) return m[1].trim();
  }
  return undefined;
}

export const realRegistry: Registry = {
  get(key) {
    const r = reg(["query", key, "/ve"]);
    return r.status === 0 ? parseRegQuery(r.stdout) : undefined;
  },
  set(key, value) {
    const r = reg(["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"]);
    if (r.status !== 0) throw new Error(`Could not write ${key}: ${r.stderr.trim() || r.stdout.trim()}`);
  },
  remove(key) {
    reg(["delete", key, "/f"]);
  },
};

function spawn(command: string, args: string[], verbatim = false): RunResult & { code?: string } {
  const r = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 120_000, windowsVerbatimArguments: verbatim });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? String(r.error) : ""), code };
}

/** Runs a program without a shell. On Windows a CLI installed through npm is a .cmd file, which needs cmd.exe. */
export const realRun: Run = (command, args) => {
  const r = spawn(command, args);
  if (r.code !== "ENOENT") return r;
  if (process.platform === "win32") {
    const line = [`${command}.cmd`, ...args].map((a) => `"${a}"`).join(" ");
    const c = spawn("cmd.exe", ["/d", "/s", "/c", `"${line}"`], true);
    if (c.code === undefined && !/is not recognized/i.test(c.stderr)) return c;
  }
  return { status: 127, stdout: "", stderr: `${command} not found`, notFound: true };
};

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}
