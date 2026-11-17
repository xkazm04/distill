// Installs the Chrome native messaging manifest for handrail-host.
//   npm run install-host -w @distill/handrail -- --extension-id <32 letters a-p>
//   (or set DISTILL_EXTENSION_ID). Add --uninstall to remove it again.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { channelDir } from "./channel.js";

export const HOST_NAME = "dev.distill.handrail";

export function validateExtensionId(id: string): string {
  if (!/^[a-p]{32}$/.test(id)) throw new Error("The extension id must be 32 letters from a to p (see chrome://extensions).");
  return id;
}

export function buildManifest(hostPath: string, extensionId: string) {
  return {
    name: HOST_NAME,
    description: "Distill Handrail: lets your own coding agent propose form values that you accept in the page.",
    path: hostPath,
    type: "stdio" as const,
    allowed_origins: [`chrome-extension://${validateExtensionId(extensionId)}/`],
  };
}

export function manifestDir(platform = process.platform): string | undefined {
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
  if (platform === "linux") return join(homedir(), ".config", "google-chrome", "NativeMessagingHosts");
  return undefined; // Windows keeps the manifest wherever we like and points the registry at it.
}

function parseArgs(argv: string[]) {
  let id = process.env["DISTILL_EXTENSION_ID"] ?? "";
  let uninstall = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--extension-id") id = argv[++i] ?? "";
    else if (a?.startsWith("--extension-id=")) id = a.slice("--extension-id=".length);
    else if (a === "--uninstall") uninstall = true;
  }
  return { id, uninstall };
}

function main(): void {
  const { id, uninstall } = parseArgs(process.argv.slice(2));
  const hostJs = resolve(dirname(fileURLToPath(import.meta.url)), "bin", "handrail-host.js");
  const dir = channelDir();
  const isWin = process.platform === "win32";
  const wrapper = join(dir, isWin ? "handrail-host.cmd" : "handrail-host.sh");
  const manifestPath = isWin ? join(dir, `${HOST_NAME}.json`) : join(manifestDir() ?? dir, `${HOST_NAME}.json`);

  if (uninstall) {
    rmSync(manifestPath, { force: true });
    rmSync(wrapper, { force: true });
    if (isWin) { try { execFileSync("reg", ["delete", `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, "/f"], { stdio: "ignore" }); } catch { /* not there */ } }
    console.log("Handrail host removed.");
    return;
  }

  if (!id) throw new Error("Give the extension id: --extension-id <id> or DISTILL_EXTENSION_ID. Find it in chrome://extensions.");
  mkdirSync(dir, { recursive: true });
  // Chrome launches the manifest's path directly, so it must be an executable: a small wrapper that runs this node.
  if (isWin) writeFileSync(wrapper, `@echo off\r\n"${process.execPath}" "${hostJs}" %*\r\n`);
  else { writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${hostJs}" "$@"\n`); chmodSync(wrapper, 0o755); }

  const manifest = buildManifest(wrapper, id);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  if (isWin) {
    execFileSync("reg", ["add", `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], { stdio: "ignore" });
  }
  console.log(`Handrail host installed for chrome-extension://${id}/\n  manifest: ${manifestPath}\n  host:     ${wrapper}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
