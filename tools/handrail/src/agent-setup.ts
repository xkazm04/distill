// One-command agent setup: `npm run agent:setup`, `agent:doctor`, `agent:remove` (see README.md).
// Everything that touches the machine comes in through SetupEnv, so the tests run it against an in-memory machine.
import path from "node:path";
import type { ExtensionIdFromKey } from "./extension-id.js";
import {
  HOST_NAME, browserProfileDir, buildManifest, composeExtensionIds, hostLocations, idsFromOrigins, manifestText,
  parseWrapper, wrapperPath, wrapperText, type HostLocation,
} from "./install.js";

export const SERVER_NAME = "handrail";
export const SETUP = "npm run agent:setup";

export interface Fs {
  exists(p: string): boolean;
  read(p: string): string | undefined;
  write(p: string, text: string, executable?: boolean): void;
  remove(p: string): void;
  mkdirp(p: string): void;
  removeDirIfEmpty(p: string): void;
}

/** HKCU keys; get/set work on the key's default value. */
export interface Registry {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface RunResult { status: number; stdout: string; stderr: string; notFound?: boolean }
export type Run = (command: string, args: string[]) => RunResult;

export interface SetupEnv {
  platform: NodeJS.Platform;
  home: string;
  /** Handrail's own folder: %LOCALAPPDATA%\Distill\handrail on Windows. */
  dataDir: string;
  /** channel.json, written by the host while the Distill panel is open. */
  channelFile: string;
  repoRoot: string;
  handrailDir: string;
  nodePath: string;
  fs: Fs;
  registry: Registry;
  run: Run;
  idFromKey: ExtensionIdFromKey;
  pidAlive(pid: number): boolean;
}

export type Status = "done" | "unchanged" | "ok" | "missing" | "failed" | "skipped" | "info";
export interface Line { status: Status; what: string; detail?: string; fix?: string }

function p(env: SetupEnv) {
  return env.platform === "win32" ? path.win32 : path.posix;
}

export function setupPaths(env: SetupEnv) {
  const j = p(env).join;
  return {
    hostJs: j(env.handrailDir, "dist", "bin", "handrail-host.js"),
    mcpJs: j(env.handrailDir, "dist", "bin", "handrail-mcp.js"),
    wrapper: wrapperPath(env.platform, env.dataDir),
    extensionManifest: j(env.repoRoot, "apps", "extension", "public", "manifest.json"),
  };
}

/** The id the extension gets from its manifest `key`, when the manifest has one. */
export function keyExtensionId(env: SetupEnv): { id?: string; problem?: string } {
  const text = env.fs.read(setupPaths(env).extensionManifest);
  if (text === undefined) return { problem: "the extension's manifest.json was not found" };
  try {
    const key = (JSON.parse(text) as { key?: unknown }).key;
    if (typeof key !== "string" || key.trim() === "") return {};
    return { id: env.idFromKey(key) };
  } catch (e) {
    return { problem: `the extension's manifest key could not be read (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** Manifest locations to write: every browser on Windows; elsewhere Chrome, plus each other browser that is installed. */
export function activeLocations(env: SetupEnv): HostLocation[] {
  return hostLocations(env.platform, env.home, env.dataDir).filter((l) => {
    if (env.platform === "win32" || l.browser.always) return true;
    const dir = browserProfileDir(l.browser, env.platform, env.home);
    return dir !== undefined && env.fs.exists(dir);
  });
}

function uniqueManifestPaths(locations: HostLocation[]): string[] {
  return [...new Set(locations.map((l) => l.manifestPath))];
}

function readJson(env: SetupEnv, file: string): Record<string, unknown> | undefined {
  const text = env.fs.read(file);
  if (text === undefined) return undefined;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  } catch { return undefined; }
}

/** Ids allowed by manifests from an earlier setup, so a re-run never drops an id the person gave before. */
export function previousExtensionIds(env: SetupEnv): string[] {
  const out: string[] = [];
  for (const file of uniqueManifestPaths(hostLocations(env.platform, env.home, env.dataDir))) {
    for (const id of idsFromOrigins(readJson(env, file)?.["allowed_origins"])) if (!out.includes(id)) out.push(id);
  }
  return out;
}

function ensureFile(env: SetupEnv, file: string, text: string, executable = false): "done" | "unchanged" {
  if (env.fs.read(file) === text) return "unchanged";
  env.fs.mkdirp(p(env).dirname(file));
  env.fs.write(file, text, executable);
  return "done";
}

// ---- MCP registrations -------------------------------------------------------------------------------------------

export interface ClaudeEntry { scope: "user" | "local" | "project" | "unknown"; command: string; args: string; connected: boolean }

/** Reads `claude mcp get <name>` output. */
export function parseClaudeGet(stdout: string): ClaudeEntry | undefined {
  const field = (name: string) => new RegExp(`^\\s*${name}:[ \\t]*(.*)$`, "m").exec(stdout)?.[1]?.trim();
  const command = field("Command");
  if (command === undefined) return undefined;
  const scopeText = (field("Scope") ?? "").toLowerCase();
  const scope = scopeText.startsWith("user") ? "user" : scopeText.startsWith("local") ? "local" : scopeText.startsWith("project") ? "project" : "unknown";
  return { scope, command, args: field("Args") ?? "", connected: /connected/i.test(field("Status") ?? "") && !/fail/i.test(field("Status") ?? "") };
}

function samePath(env: SetupEnv, a: string, b: string): boolean {
  return env.platform === "win32" ? path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase() : a === b;
}

function claudeEntryPointsHere(env: SetupEnv, e: ClaudeEntry): boolean {
  return samePath(env, e.args, setupPaths(env).mcpJs) && (e.command === "node" || env.fs.exists(e.command));
}

type Lookup<T> = { installed: false } | { installed: true; entry?: T };

function claudeGet(env: SetupEnv): Lookup<ClaudeEntry> {
  const r = env.run("claude", ["mcp", "get", SERVER_NAME]);
  if (r.notFound) return { installed: false };
  return { installed: true, entry: r.status === 0 ? parseClaudeGet(r.stdout) : undefined };
}

const CLAUDE = "Claude Code";
const CLAUDE_MISSING: Line = { status: "skipped", what: CLAUDE, detail: "not installed (no claude command)" };

export function registerClaude(env: SetupEnv): Line {
  const { mcpJs } = setupPaths(env);
  let replaced = false;
  // A local-scope entry (the old README's `claude mcp add handrail ...`) would hide the user-scope one, so it goes too.
  for (let i = 0; i < 3; i++) {
    const g = claudeGet(env);
    if (!g.installed) return CLAUDE_MISSING;
    const e = g.entry;
    if (!e) break;
    if (e.scope === "user" && claudeEntryPointsHere(env, e)) {
      return { status: replaced ? "done" : "unchanged", what: CLAUDE, detail: "handrail is registered for all your projects" };
    }
    if (e.scope === "project") {
      return { status: "failed", what: CLAUDE, detail: "this project's .mcp.json has its own handrail entry; it was left alone", fix: "remove handrail from .mcp.json, then " + SETUP };
    }
    const scope = e.scope === "unknown" ? "user" : e.scope;
    env.run("claude", ["mcp", "remove", SERVER_NAME, "--scope", scope]);
    replaced = true;
  }
  const r = env.run("claude", ["mcp", "add", "--scope", "user", SERVER_NAME, "--", env.nodePath, mcpJs]);
  if (r.notFound) return CLAUDE_MISSING;
  if (r.status !== 0) return { status: "failed", what: CLAUDE, detail: firstLine(r.stderr || r.stdout), fix: `claude mcp add --scope user ${SERVER_NAME} -- "${env.nodePath}" "${mcpJs}"` };
  return { status: "done", what: CLAUDE, detail: "handrail is registered for all your projects" };
}

export interface AgyEntry { enabled: boolean; line: string }

/** Finds the handrail row in `agy mcp list` (columns NAME TYPE STATUS COMMAND/URL). */
export function parseAgyList(stdout: string): AgyEntry | undefined {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith(`${SERVER_NAME} `) || l.startsWith(`${SERVER_NAME}\t`));
  if (!line) return undefined;
  return { enabled: /\benabled\b/.test(line) && !/\bdisabled\b/.test(line), line };
}

function agyGet(env: SetupEnv): Lookup<AgyEntry> {
  const r = env.run("agy", ["mcp", "list"]);
  if (r.notFound) return { installed: false };
  return { installed: true, entry: r.status === 0 ? parseAgyList(r.stdout) : undefined };
}

function agyEntryPointsHere(env: SetupEnv, e: AgyEntry): boolean {
  const { mcpJs } = setupPaths(env);
  return env.platform === "win32" ? e.line.toLowerCase().includes(mcpJs.toLowerCase()) : e.line.includes(mcpJs);
}

const AGY = "agy (Antigravity CLI)";
const AGY_MISSING: Line = { status: "skipped", what: AGY, detail: "not installed (no agy command)" };

export function registerAgy(env: SetupEnv): Line {
  const before = agyGet(env);
  if (!before.installed) return AGY_MISSING;
  const ok: Line = { status: "done", what: AGY, detail: "handrail is registered" };
  if (before.entry && before.entry.enabled && agyEntryPointsHere(env, before.entry)) return { ...ok, status: "unchanged" };
  if (!before.entry || !agyEntryPointsHere(env, before.entry)) {
    // `agy mcp add` adds or updates; flags would go before the name, and there are none.
    const r = env.run("agy", ["mcp", "add", SERVER_NAME, env.nodePath, setupPaths(env).mcpJs]);
    if (r.status !== 0) return { status: "failed", what: AGY, detail: firstLine(r.stderr || r.stdout), fix: `agy mcp add ${SERVER_NAME} "${env.nodePath}" "${setupPaths(env).mcpJs}"` };
  }
  const after = agyGet(env);
  if (after.installed && after.entry && !after.entry.enabled) env.run("agy", ["mcp", "enable", SERVER_NAME]);
  return ok;
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "no message";
}

// ---- setup ---------------------------------------------------------------------------------------------------------

export interface SetupOptions { extensionIds: string[] }

/** `setup --extension-id <id> ...`; DISTILL_EXTENSION_ID may hold ids too (comma or space separated). */
export function parseSetupArgs(argv: string[], envId = process.env["DISTILL_EXTENSION_ID"]): { command: string; extensionIds: string[] } {
  const [command = "setup", ...rest] = argv;
  const extensionIds = envId ? envId.split(/[\s,]+/).filter(Boolean) : [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? "";
    if (a === "--extension-id") extensionIds.push(rest[++i] ?? "");
    else if (a.startsWith("--extension-id=")) extensionIds.push(a.slice("--extension-id=".length));
    else throw new Error(`Unknown option "${a}". Use --extension-id <id>.`);
  }
  return { command, extensionIds };
}


export function setup(env: SetupEnv, opts: SetupOptions): Line[] {
  const lines: Line[] = [];
  const { hostJs, mcpJs, wrapper } = setupPaths(env);
  const built = env.fs.exists(hostJs) && env.fs.exists(mcpJs);
  if (!built) lines.push({ status: "failed", what: "Handrail program", detail: "not built", fix: "npm run build -w @distill/handrail" });

  // Extension ids: from the manifest key, then the ones given now, then the ones an earlier setup allowed.
  const key = keyExtensionId(env);
  let given: string[] = [];
  let idsOk = true;
  try { given = composeExtensionIds(opts.extensionIds); } catch (e) {
    idsOk = false;
    lines.push({ status: "failed", what: "Extension id", detail: e instanceof Error ? e.message : String(e), fix: `${SETUP} -- --extension-id <id from chrome://extensions>` });
  }
  const previous = previousExtensionIds(env);
  const ids = idsOk ? composeExtensionIds(key.id ? [key.id] : [], given, previous) : [];
  for (const id of ids) {
    const from = id === key.id ? "from the extension's key" : given.includes(id) ? "you gave it" : "kept from an earlier setup";
    lines.push({ status: "info", what: "Extension id", detail: `${id} (${from})` });
  }
  if (key.problem) lines.push({ status: "info", what: "Extension key", detail: key.problem });

  if (idsOk && ids.length === 0) {
    lines.push({ status: "failed", what: "Extension id", detail: "none yet, so no browser can start the host", fix: `${SETUP} -- --extension-id <id from chrome://extensions>` });
  } else if (idsOk && built) {
    env.fs.mkdirp(env.dataDir);
    lines.push({ status: ensureFile(env, wrapper, wrapperText(env.platform, env.nodePath, hostJs), true), what: "Host program", detail: wrapper });
    const text = manifestText(buildManifest(wrapper, ids));
    const locations = activeLocations(env);
    for (const file of uniqueManifestPaths(locations)) {
      lines.push({ status: ensureFile(env, file, text), what: "Host manifest", detail: `${file} (allows ${ids.length} extension${ids.length === 1 ? "" : "s"})` });
    }
    for (const l of locations) {
      if (!l.registryKey) continue;
      const same = env.registry.get(l.registryKey) === l.manifestPath;
      if (!same) env.registry.set(l.registryKey, l.manifestPath);
      lines.push({ status: same ? "unchanged" : "done", what: `${l.browser.label} finds the host`, detail: l.registryKey });
    }
  }

  lines.push(built ? registerClaude(env) : { status: "skipped", what: CLAUDE, detail: "waits for the build" });
  lines.push(built ? registerAgy(env) : { status: "skipped", what: AGY, detail: "waits for the build" });
  return lines;
}

// ---- doctor --------------------------------------------------------------------------------------------------------

export function doctor(env: SetupEnv): Line[] {
  const lines: Line[] = [];
  const fix = SETUP;
  const { hostJs, mcpJs, wrapper } = setupPaths(env);

  const built = env.fs.exists(hostJs) && env.fs.exists(mcpJs);
  lines.push(built ? { status: "ok", what: "Handrail program is built" } : { status: "missing", what: "Handrail program", detail: "not built", fix });

  const wText = env.fs.read(wrapper);
  const w = wText === undefined ? undefined : parseWrapper(wText);
  if (wText === undefined) lines.push({ status: "missing", what: "Host program", detail: `${wrapper} is not there`, fix });
  else if (!w) lines.push({ status: "missing", what: "Host program", detail: `${wrapper} is not one this setup wrote`, fix });
  else if (!env.fs.exists(w.nodePath)) lines.push({ status: "missing", what: "Host program", detail: `it runs Node from ${w.nodePath}, which is gone`, fix });
  else if (!env.fs.exists(w.hostJs)) lines.push({ status: "missing", what: "Host program", detail: `it runs ${w.hostJs}, which is gone`, fix });
  else lines.push({ status: "ok", what: "Host program", detail: wrapper });

  const key = keyExtensionId(env);
  const locations = activeLocations(env);
  for (const file of uniqueManifestPaths(locations)) {
    const m = readJson(env, file);
    const ids = idsFromOrigins(m?.["allowed_origins"]);
    const what = "Host manifest";
    if (!m) lines.push({ status: "missing", what, detail: `${file} is not there`, fix });
    else if (m["name"] !== HOST_NAME || m["type"] !== "stdio") lines.push({ status: "missing", what, detail: `${file} is not a Handrail manifest`, fix });
    else if (typeof m["path"] !== "string" || !samePath(env, m["path"], wrapper)) lines.push({ status: "missing", what, detail: `${file} points at another program`, fix });
    else if (ids.length === 0) lines.push({ status: "missing", what, detail: `${file} allows no extension`, fix: `${SETUP} -- --extension-id <id from chrome://extensions>` });
    else if (key.id && !ids.includes(key.id)) lines.push({ status: "missing", what, detail: `${file} does not allow the extension's id ${key.id}`, fix });
    else lines.push({ status: "ok", what, detail: `allows ${ids.join(", ")}` });
  }
  for (const l of locations) {
    if (!l.registryKey) continue;
    const v = env.registry.get(l.registryKey);
    const what = `${l.browser.label} finds the host`;
    if (v !== undefined && samePath(env, v, l.manifestPath)) lines.push({ status: "ok", what });
    else lines.push({ status: "missing", what, detail: v === undefined ? `no key ${l.registryKey}` : `the key points at ${v}`, fix });
  }

  const c = claudeGet(env);
  if (!c.installed) lines.push(CLAUDE_MISSING);
  else if (!c.entry) lines.push({ status: "missing", what: CLAUDE, detail: "handrail is not registered", fix });
  else if (!claudeEntryPointsHere(env, c.entry)) lines.push({ status: "missing", what: CLAUDE, detail: `handrail runs ${c.entry.command} ${c.entry.args}`, fix });
  else if (!c.entry.connected) lines.push({ status: "missing", what: CLAUDE, detail: "handrail is registered but did not start", fix: "claude mcp get handrail" });
  else lines.push({ status: "ok", what: CLAUDE, detail: `handrail is registered (${c.entry.scope} scope) and starts` });

  const a = agyGet(env);
  if (!a.installed) lines.push(AGY_MISSING);
  else if (!a.entry || !agyEntryPointsHere(env, a.entry)) lines.push({ status: "missing", what: AGY, detail: a.entry ? "handrail runs another program" : "handrail is not registered", fix });
  else if (!a.entry.enabled) lines.push({ status: "missing", what: AGY, detail: "handrail is turned off", fix: `agy mcp enable ${SERVER_NAME}` });
  else lines.push({ status: "ok", what: AGY, detail: "handrail is registered" });

  if (!c.installed && !a.installed) lines.push({ status: "missing", what: "Agent", detail: "neither Claude Code nor agy is installed", fix: `install one of them, then ${SETUP}` });

  const ch = readJson(env, env.channelFile);
  const pid = typeof ch?.["pid"] === "number" ? ch["pid"] : undefined;
  if (!ch) lines.push({ status: "info", what: "Distill panel", detail: "not open (that is fine; open it on a page when you want your agent to help)" });
  else if (pid !== undefined && env.pidAlive(pid)) lines.push({ status: "ok", what: "Distill panel", detail: `open, and the host is running (process ${pid})` });
  else lines.push({ status: "info", what: "Distill panel", detail: "closed; an old channel file is left, and the next start replaces it" });
  return lines;
}

// ---- remove --------------------------------------------------------------------------------------------------------

export function remove(env: SetupEnv): Line[] {
  const lines: Line[] = [];

  let claude: Line = { status: "unchanged", what: CLAUDE, detail: "nothing to remove" };
  for (let i = 0; i < 3; i++) {
    const g = claudeGet(env);
    if (!g.installed) { claude = CLAUDE_MISSING; break; }
    if (!g.entry) break;
    if (g.entry.scope === "project") { claude = { status: "info", what: CLAUDE, detail: "this project's .mcp.json has a handrail entry; it was left alone" }; break; }
    env.run("claude", ["mcp", "remove", SERVER_NAME, "--scope", g.entry.scope === "unknown" ? "user" : g.entry.scope]);
    claude = { status: "done", what: CLAUDE, detail: "handrail removed" };
  }
  lines.push(claude);

  const a = agyGet(env);
  if (!a.installed) lines.push(AGY_MISSING);
  else if (!a.entry) lines.push({ status: "unchanged", what: AGY, detail: "nothing to remove" });
  else {
    env.run("agy", ["mcp", "remove", SERVER_NAME]);
    lines.push({ status: "done", what: AGY, detail: "handrail removed" });
  }

  const all = hostLocations(env.platform, env.home, env.dataDir);
  for (const l of all) {
    if (!l.registryKey) continue;
    const there = env.registry.get(l.registryKey) !== undefined;
    if (there) env.registry.remove(l.registryKey);
    lines.push({ status: there ? "done" : "unchanged", what: `${l.browser.label} host key`, detail: there ? "removed" : "nothing to remove" });
  }
  for (const file of [...uniqueManifestPaths(all), setupPaths(env).wrapper]) {
    if (!env.fs.exists(file)) continue;
    env.fs.remove(file);
    lines.push({ status: "done", what: "Removed", detail: file });
  }
  env.fs.removeDirIfEmpty(env.dataDir);
  return lines;
}

// ---- output --------------------------------------------------------------------------------------------------------

const LABEL: Record<Status, string> = {
  done: "done", unchanged: "already", ok: "ok", missing: "MISSING", failed: "FAILED", skipped: "skipped", info: "note",
};

export function render(title: string, lines: Line[]): string {
  const out = [title, ""];
  for (const l of lines) {
    out.push(`  ${LABEL[l.status].padEnd(8)} ${l.what}${l.detail ? `: ${l.detail}` : ""}`);
    if (l.fix) out.push(`  ${"".padEnd(8)}   fix: ${l.fix}`);
  }
  return out.join("\n");
}

export function hasProblem(lines: Line[]): boolean {
  return lines.some((l) => l.status === "missing" || l.status === "failed");
}
