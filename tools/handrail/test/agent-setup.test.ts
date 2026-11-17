import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeLocations, doctor, hasProblem, parseAgyList, parseClaudeGet, parseSetupArgs, remove, render, setup,
  type Line, type RunResult, type SetupEnv,
} from "../src/agent-setup.js";
import { extensionIdFromKey } from "../../../scripts/extension-id.mjs";
import { HOST_NAME } from "../src/install.js";
import { parseRegQuery } from "../src/system.js";

const KEY_ID = extensionIdFromKey("AAAA");
const OTHER_ID = "b".repeat(32);

type Scope = "user" | "local" | "project";
interface Server { command: string; args: string }

/** An in-memory Windows (or other) machine: files, HKCU, and fake claude / agy CLIs that keep their own server lists. */
function machine(o: { platform?: NodeJS.Platform; key?: string | null; claude?: boolean; agy?: boolean } = {}) {
  const platform = o.platform ?? "win32";
  const pj = platform === "win32" ? path.win32.join : path.posix.join;
  const home = platform === "win32" ? "C:\\Users\\p" : "/home/p";
  const repoRoot = platform === "win32" ? "C:\\repo" : "/repo";
  const nodePath = platform === "win32" ? "C:\\node\\node.exe" : "/usr/bin/node";
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const reg = new Map<string, string>();
  const claude = new Map<string, Map<Scope, Server>>([["other", new Map([["user", { command: "npx", args: "other-server" }]])]]);
  const agy = new Map<string, Server & { enabled: boolean }>([["other", { command: "npx", args: "other-server", enabled: true }]]);
  const calls: string[] = [];
  let writes = 0;
  let alive = new Set<number>();

  const handrailDir = pj(repoRoot, "tools", "handrail");
  for (const f of [pj(handrailDir, "dist", "bin", "handrail-host.js"), pj(handrailDir, "dist", "bin", "handrail-mcp.js"), nodePath]) files.set(f, "");
  const manifest: Record<string, unknown> = { manifest_version: 3, name: "Distill" };
  if (o.key !== null) manifest["key"] = o.key ?? "AAAA";
  files.set(pj(repoRoot, "apps", "extension", "public", "manifest.json"), JSON.stringify(manifest));

  const ok = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });
  const fail = (stderr: string): RunResult => ({ status: 1, stdout: "", stderr });

  function runClaude(args: string[]): RunResult {
    const [, sub, ...rest] = args;
    if (sub === "get") {
      const s = claude.get(rest[0] ?? "");
      const scope = (["local", "project", "user"] as const).find((x) => s?.has(x));
      if (!s || !scope) return fail(`No MCP server named "${rest[0]}".`);
      const e = s.get(scope)!;
      const label = { user: "User config (available in all your projects)", local: "Local config (private to you in this project)", project: "Project config (shared via .mcp.json)" }[scope];
      return ok(`${rest[0]}:\n  Scope: ${label}\n  Status: ✔ Connected\n  Type: stdio\n  Command: ${e.command}\n  Args: ${e.args}\n  Environment:\n`);
    }
    if (sub === "add") {
      const dash = rest.indexOf("--");
      const name = rest[dash - 1]!;
      const scope = rest[rest.indexOf("--scope") + 1] as Scope;
      const s = claude.get(name) ?? new Map<Scope, Server>();
      if (s.has(scope)) return fail(`MCP server ${name} already exists in ${scope} config`);
      s.set(scope, { command: rest[dash + 1]!, args: rest.slice(dash + 2).join(" ") });
      claude.set(name, s);
      return ok();
    }
    if (sub === "remove") {
      const scope = rest[rest.indexOf("--scope") + 1] as Scope;
      return claude.get(rest[0]!)?.delete(scope) ? ok() : fail("not found");
    }
    return fail("unknown");
  }

  function runAgy(args: string[]): RunResult {
    const [, sub, name, ...rest] = args;
    if (sub === "list") {
      const rows = [...agy].map(([n, s]) => `${n.padEnd(9)} stdio  ${s.enabled ? "enabled " : "disabled"} ${s.command} ${s.args}`);
      return ok(["NAME      TYPE   STATUS   COMMAND/URL", ...rows].join("\n") + "\n");
    }
    if (sub === "add") { agy.set(name!, { command: rest[0]!, args: rest.slice(1).join(" "), enabled: agy.get(name!)?.enabled ?? true }); return ok(); }
    if (sub === "remove") return agy.delete(name!) ? ok() : fail("not found");
    if (sub === "enable") { const s = agy.get(name!); if (s) s.enabled = true; return ok(); }
    return fail("unknown");
  }

  const env: SetupEnv = {
    platform,
    home,
    dataDir: platform === "win32" ? pj(home, "AppData", "Local", "Distill", "handrail") : pj(home, ".distill", "handrail"),
    channelFile: platform === "win32" ? pj(home, "AppData", "Local", "Distill", "handrail", "channel.json") : pj(home, ".distill", "handrail", "channel.json"),
    repoRoot,
    handrailDir,
    nodePath,
    fs: {
      exists: (p) => files.has(p) || dirs.has(p),
      read: (p) => files.get(p),
      write: (p, text) => { writes++; files.set(p, text); },
      remove: (p) => { files.delete(p); },
      mkdirp: (p) => { dirs.add(p); },
      removeDirIfEmpty: (p) => { if (![...files.keys()].some((f) => f.startsWith(p))) dirs.delete(p); },
    },
    registry: {
      get: (k) => reg.get(k),
      set: (k, v) => { writes++; reg.set(k, v); },
      remove: (k) => { reg.delete(k); },
    },
    run: (command, args) => {
      calls.push([command, ...args].join(" "));
      if (command === "claude") return o.claude === false ? { status: 127, stdout: "", stderr: "", notFound: true } : runClaude(args);
      if (command === "agy") return o.agy === false ? { status: 127, stdout: "", stderr: "", notFound: true } : runAgy(args);
      return { status: 127, stdout: "", stderr: "", notFound: true };
    },
    idFromKey: extensionIdFromKey,
    pidAlive: (pid) => alive.has(pid),
  };
  const mcpJs = pj(handrailDir, "dist", "bin", "handrail-mcp.js");
  return { env, files, dirs, reg, claude, agy, calls, mcpJs, writes: () => writes, setAlive: (pids: number[]) => { alive = new Set(pids); } };
}

const problems = (lines: Line[]) => lines.filter((l) => l.status === "missing" || l.status === "failed");
const manifestPath = "C:\\Users\\p\\AppData\\Local\\Distill\\handrail\\" + HOST_NAME + ".json";

describe("agent:setup on Windows", () => {
  it("writes the host, the manifest, three browser keys and both MCP registrations", () => {
    const m = machine();
    const lines = setup(m.env, { extensionIds: [] });
    expect(problems(lines)).toEqual([]);
    const wrapper = "C:\\Users\\p\\AppData\\Local\\Distill\\handrail\\handrail-host.cmd";
    expect(m.files.get(wrapper)).toBe('@echo off\r\n"C:\\node\\node.exe" "C:\\repo\\tools\\handrail\\dist\\bin\\handrail-host.js" %*\r\n');
    const man = JSON.parse(m.files.get(manifestPath)!) as { path: string; allowed_origins: string[] };
    expect(man.path).toBe(wrapper);
    expect(man.allowed_origins).toEqual([`chrome-extension://${KEY_ID}/`]);
    expect([...m.reg.keys()]).toEqual([
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
    ]);
    expect([...m.reg.values()].every((v) => v === manifestPath)).toBe(true);
    expect(m.claude.get("handrail")?.get("user")).toEqual({ command: "C:\\node\\node.exe", args: m.mcpJs });
    expect(m.agy.get("handrail")).toMatchObject({ command: "C:\\node\\node.exe", args: m.mcpJs, enabled: true });
  });

  it("is idempotent: a second run changes nothing and says so", () => {
    const m = machine();
    setup(m.env, { extensionIds: [] });
    const before = m.writes();
    const calls = m.calls.length;
    const again = setup(m.env, { extensionIds: [] });
    expect(m.writes()).toBe(before);
    expect(m.calls.slice(calls).filter((c) => / (add|remove|enable) /.test(c))).toEqual([]);
    expect(again.every((l) => l.status === "unchanged" || l.status === "info")).toBe(true);
  });

  it("adds --extension-id to allowed_origins and keeps it on a later run without it", () => {
    const m = machine();
    setup(m.env, { extensionIds: [OTHER_ID] });
    setup(m.env, { extensionIds: [] });
    const man = JSON.parse(m.files.get(manifestPath)!) as { allowed_origins: string[] };
    expect(man.allowed_origins).toEqual([`chrome-extension://${KEY_ID}/`, `chrome-extension://${OTHER_ID}/`]);
  });

  it("refuses a malformed id and writes no host", () => {
    const m = machine();
    const lines = setup(m.env, { extensionIds: ["chrome-extension://x"] });
    expect(hasProblem(lines)).toBe(true);
    expect(m.reg.size).toBe(0);
  });

  it("without a key or an id it still registers the agents and says what to do", () => {
    const m = machine({ key: null });
    const lines = setup(m.env, { extensionIds: [] });
    const failed = problems(lines);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.fix).toMatch(/--extension-id/);
    expect(m.files.has(manifestPath)).toBe(false);
    expect(m.claude.get("handrail")?.get("user")).toBeDefined();
  });

  it("replaces a stale handrail entry (the old README's local scope) and leaves other servers alone", () => {
    const m = machine();
    m.claude.set("handrail", new Map([["local", { command: "node", args: "D:\\old\\handrail-mcp.js" }], ["user", { command: "node", args: "D:\\old\\handrail-mcp.js" }]]));
    m.agy.set("handrail", { command: "node", args: "D:\\old\\handrail-mcp.js", enabled: false });
    const lines = setup(m.env, { extensionIds: [] });
    expect(problems(lines)).toEqual([]);
    expect([...m.claude.get("handrail")!.keys()]).toEqual(["user"]);
    expect(m.claude.get("handrail")!.get("user")!.args).toBe(m.mcpJs);
    expect(m.agy.get("handrail")).toMatchObject({ args: m.mcpJs, enabled: true });
    expect(m.claude.get("other")!.get("user")).toEqual({ command: "npx", args: "other-server" });
    expect(m.agy.get("other")).toEqual({ command: "npx", args: "other-server", enabled: true });
  });

  it("skips an agent CLI that is not installed", () => {
    const m = machine({ agy: false });
    const lines = setup(m.env, { extensionIds: [] });
    expect(problems(lines)).toEqual([]);
    expect(lines.find((l) => l.what.startsWith("agy"))?.status).toBe("skipped");
  });
});

describe("agent:doctor", () => {
  it("names each missing piece with a fix on a fresh machine", () => {
    const m = machine();
    const lines = doctor(m.env);
    expect(hasProblem(lines)).toBe(true);
    for (const l of problems(lines)) expect(l.fix).toBeTruthy();
    expect(problems(lines).map((l) => l.what)).toEqual([
      "Host program", "Host manifest", "Google Chrome finds the host", "Microsoft Edge finds the host",
      "Chromium and the test browser finds the host", "Claude Code", "agy (Antigravity CLI)",
    ]);
  });

  it("is all ok after setup; the panel is a note when closed and ok when the host runs", () => {
    const m = machine();
    setup(m.env, { extensionIds: [] });
    let lines = doctor(m.env);
    expect(problems(lines)).toEqual([]);
    expect(lines.at(-1)).toMatchObject({ status: "info", what: "Distill panel" });
    m.files.set(m.env.channelFile, JSON.stringify({ v: 1, endpoint: "\\\\.\\pipe\\x", token: "t", pid: 42 }));
    m.setAlive([42]);
    lines = doctor(m.env);
    expect(lines.at(-1)).toMatchObject({ status: "ok", what: "Distill panel" });
    expect(render("check", lines)).not.toContain("\"t\"");
  });

  it("catches a node that is gone (host and Claude Code), a manifest without the key's id, and a disabled agy entry", () => {
    const m = machine();
    setup(m.env, { extensionIds: [] });
    m.files.delete("C:\\node\\node.exe");
    m.files.set(manifestPath, JSON.stringify({ ...JSON.parse(m.files.get(manifestPath)!), allowed_origins: [`chrome-extension://${OTHER_ID}/`] }));
    m.agy.get("handrail")!.enabled = false;
    const bad = problems(doctor(m.env));
    expect(bad.map((l) => l.what)).toEqual(["Host program", "Host manifest", "Claude Code", "agy (Antigravity CLI)"]);
    expect(bad[3]!.fix).toBe("agy mcp enable handrail");
  });

  it("fails when no agent CLI exists at all", () => {
    const m = machine({ claude: false, agy: false });
    setup(m.env, { extensionIds: [] });
    expect(problems(doctor(m.env)).map((l) => l.what)).toEqual(["Agent"]);
  });
});

describe("agent:remove", () => {
  it("undoes everything setup did and nothing else; a second run has nothing to do", () => {
    const m = machine();
    setup(m.env, { extensionIds: [OTHER_ID] });
    remove(m.env);
    expect(m.reg.size).toBe(0);
    expect(m.files.has(manifestPath)).toBe(false);
    expect([...m.files.keys()].some((f) => f.includes("Distill"))).toBe(false);
    expect(m.dirs.has(m.env.dataDir)).toBe(false);
    expect(m.claude.get("handrail")?.size ?? 0).toBe(0);
    expect(m.agy.has("handrail")).toBe(false);
    expect(m.claude.get("other")!.size).toBe(1);
    expect(m.agy.has("other")).toBe(true);
    expect(remove(m.env).every((l) => l.status === "unchanged")).toBe(true);
  });
});

describe("macOS and Linux", () => {
  it("writes Chrome's manifest always and another browser's only when it is installed", () => {
    const m = machine({ platform: "linux" });
    expect(activeLocations(m.env).map((l) => l.browser.id)).toEqual(["chrome"]);
    m.dirs.add("/home/p/.config/microsoft-edge");
    expect(activeLocations(m.env).map((l) => l.browser.id)).toEqual(["chrome", "edge"]);
    expect(problems(setup(m.env, { extensionIds: [] }))).toEqual([]);
    expect(m.files.has(`/home/p/.config/microsoft-edge/NativeMessagingHosts/${HOST_NAME}.json`)).toBe(true);
    expect(m.files.get("/home/p/.distill/handrail/handrail-host.sh")).toContain('exec "/usr/bin/node"');
    expect(m.reg.size).toBe(0);
    expect(problems(doctor(m.env))).toEqual([]);
    remove(m.env);
    expect([...m.files.keys()].some((f) => f.includes(HOST_NAME))).toBe(false);
  });
});

describe("parsers for the real CLIs' output", () => {
  it("reads `claude mcp get`", () => {
    const out = "handrail:\n  Scope: User config (available in all your projects)\n  Status: ✔ Connected\n  Type: stdio\n  Command: C:\\Program Files\\nodejs\\node.exe\n  Args: C:\\r\\handrail-mcp.js\n  Environment:\n\nTo remove this server, run: claude mcp remove handrail -s user\n";
    expect(parseClaudeGet(out)).toEqual({ scope: "user", command: "C:\\Program Files\\nodejs\\node.exe", args: "C:\\r\\handrail-mcp.js", connected: true });
    expect(parseClaudeGet(out.replace("✔ Connected", "✘ Failed to connect"))?.connected).toBe(false);
    expect(parseClaudeGet('No MCP server named "handrail".')).toBeUndefined();
  });
  it("reads `agy mcp list`", () => {
    const out = "NAME      TYPE   STATUS   COMMAND/URL\nhandrail  stdio  enabled  C:\\Program Files\\nodejs\\node.exe C:\\r\\handrail-mcp.js\nhandrail2 stdio  disabled x\n";
    expect(parseAgyList(out)).toEqual({ enabled: true, line: out.split("\n")[1] });
    expect(parseAgyList(out.replace("enabled ", "disabled"))?.enabled).toBe(false);
    expect(parseAgyList("No MCP servers configured.\n")).toBeUndefined();
  });
  it("reads `reg query /ve`", () => {
    expect(parseRegQuery(`\r\nHKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}\r\n    (Default)    REG_SZ    C:\\Users\\p\\x.json\r\n\r\n`)).toBe("C:\\Users\\p\\x.json");
    expect(parseRegQuery("ERROR: The system was unable to find the specified registry key or value.")).toBeUndefined();
  });
  it("reads the setup arguments", () => {
    expect(parseSetupArgs(["setup", "--extension-id", OTHER_ID, `--extension-id=${KEY_ID}`], undefined)).toEqual({ command: "setup", extensionIds: [OTHER_ID, KEY_ID] });
    expect(parseSetupArgs([], `${OTHER_ID},${KEY_ID}`)).toEqual({ command: "setup", extensionIds: [OTHER_ID, KEY_ID] });
    expect(() => parseSetupArgs(["setup", "--force"], undefined)).toThrow(/Unknown option/);
  });
});
