// The native messaging host install: which files and registry keys each browser reads, and what goes in them.
// Pure functions only; tools/handrail/src/agent-setup.ts does the writing. Run it with `npm run agent:setup`.
import path from "node:path";

export const HOST_NAME = "dev.distill.handrail";

export function validateExtensionId(id: string): string {
  if (!/^[a-p]{32}$/.test(id)) throw new Error(`"${id}" is not an extension id. An id is 32 letters from a to p (see chrome://extensions).`);
  return id;
}

/** Valid ids in first-seen order, each once. */
export function composeExtensionIds(...lists: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  for (const list of lists) for (const id of list) if (!out.includes(validateExtensionId(id))) out.push(id);
  return out;
}

export function allowedOrigins(ids: readonly string[]): string[] {
  return ids.map((id) => `chrome-extension://${validateExtensionId(id)}/`);
}

/** The ids an installed manifest already allows; anything that is not a well-formed origin is ignored. */
export function idsFromOrigins(origins: unknown): string[] {
  if (!Array.isArray(origins)) return [];
  const out: string[] = [];
  for (const o of origins) {
    const m = typeof o === "string" ? /^chrome-extension:\/\/([a-p]{32})\/$/.exec(o) : null;
    if (m?.[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export interface HostManifest {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins: string[];
}

export function buildManifest(hostPath: string, extensionIds: readonly string[]): HostManifest {
  if (extensionIds.length === 0) throw new Error("At least one extension id is needed.");
  return {
    name: HOST_NAME,
    description: "Distill Handrail: lets your own coding agent propose form values that you accept in the page.",
    path: hostPath,
    type: "stdio",
    allowed_origins: allowedOrigins(extensionIds),
  };
}

export function manifestText(m: HostManifest): string {
  return JSON.stringify(m, null, 2) + "\n";
}

export type BrowserId = "chrome" | "edge" | "chromium";

export interface Browser {
  id: BrowserId;
  label: string;
  /** Under HKCU; the browser reads `<this>\NativeMessagingHosts\<host name>`. */
  windowsKey: string;
  /** Under ~/Library/Application Support. */
  macDir: string;
  /** Under ~/.config. */
  linuxDir: string;
  /** Written even when the browser's profile folder does not exist (macOS, Linux). */
  always: boolean;
}

// Chromium's own builds, and Playwright's test browser, look under both Google\Chrome and Chromium (both key names are in
// chrome.dll of Playwright's chromium-1254); Edge reads its own key first. Registering all three costs three tiny keys.
export const BROWSERS: readonly Browser[] = [
  { id: "chrome", label: "Google Chrome", windowsKey: "Software\\Google\\Chrome", macDir: "Google/Chrome", linuxDir: "google-chrome", always: true },
  { id: "edge", label: "Microsoft Edge", windowsKey: "Software\\Microsoft\\Edge", macDir: "Microsoft Edge", linuxDir: "microsoft-edge", always: false },
  { id: "chromium", label: "Chromium and the test browser", windowsKey: "Software\\Chromium", macDir: "Chromium", linuxDir: "chromium", always: false },
];

export function registryKey(b: Browser): string {
  return `HKCU\\${b.windowsKey}\\NativeMessagingHosts\\${HOST_NAME}`;
}

function pathFor(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

/** The browser's own folder, whose presence tells us it is installed (macOS, Linux). */
export function browserProfileDir(b: Browser, platform: NodeJS.Platform, home: string): string | undefined {
  const p = pathFor(platform);
  if (platform === "darwin") return p.join(home, "Library", "Application Support", ...b.macDir.split("/"));
  if (platform === "win32") return undefined;
  return p.join(home, ".config", b.linuxDir);
}

export interface HostLocation {
  browser: Browser;
  /** Where the manifest file lives. On Windows all browsers share one file. */
  manifestPath: string;
  /** Windows only: the HKCU key whose default value is manifestPath. */
  registryKey?: string;
}

/** Where each browser looks for the host. `dataDir` is Handrail's own folder (%LOCALAPPDATA%\Distill\handrail on Windows). */
export function hostLocations(platform: NodeJS.Platform, home: string, dataDir: string): HostLocation[] {
  const p = pathFor(platform);
  if (platform === "win32") {
    const manifestPath = p.join(dataDir, `${HOST_NAME}.json`);
    return BROWSERS.map((browser) => ({ browser, manifestPath, registryKey: registryKey(browser) }));
  }
  return BROWSERS.map((browser) => ({
    browser,
    manifestPath: p.join(browserProfileDir(browser, platform, home) ?? home, "NativeMessagingHosts", `${HOST_NAME}.json`),
  }));
}

/** Chrome starts the manifest's `path` directly, so it must be a program: a small wrapper that runs this node. */
export function wrapperPath(platform: NodeJS.Platform, dataDir: string): string {
  return pathFor(platform).join(dataDir, platform === "win32" ? "handrail-host.cmd" : "handrail-host.sh");
}

export function wrapperText(platform: NodeJS.Platform, nodePath: string, hostJs: string): string {
  if (platform === "win32") return `@echo off\r\n"${nodePath}" "${hostJs}" %*\r\n`;
  return `#!/bin/sh\nexec "${nodePath}" "${hostJs}" "$@"\n`;
}

/** The node and script a wrapper runs, read back for the doctor. */
export function parseWrapper(text: string): { nodePath: string; hostJs: string } | undefined {
  const m = /"([^"]+)"\s+"([^"]+)"/.exec(text);
  return m?.[1] && m[2] ? { nodePath: m[1], hostJs: m[2] } : undefined;
}
