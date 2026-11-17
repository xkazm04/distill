import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extensionIdFromKey } from "../../../scripts/extension-id.mjs";
import { loadExtensionIdFromKey } from "../src/extension-id.js";
import {
  BROWSERS, HOST_NAME, allowedOrigins, buildManifest, composeExtensionIds, hostLocations, idsFromOrigins, parseWrapper,
  registryKey, validateExtensionId, wrapperPath, wrapperText,
} from "../src/install.js";

const A = "a".repeat(32);
const B = "b".repeat(32);

describe("native messaging manifest", () => {
  it("lists every given extension in allowed_origins", () => {
    const m = buildManifest("C:\\x\\host.cmd", [A, B]);
    expect(m).toMatchObject({ name: HOST_NAME, type: "stdio", path: "C:\\x\\host.cmd" });
    expect(m.allowed_origins).toEqual([`chrome-extension://${A}/`, `chrome-extension://${B}/`]);
  });
  it("needs at least one id and rejects a malformed one", () => {
    expect(() => buildManifest("h", [])).toThrow();
    expect(() => validateExtensionId("*")).toThrow();
    expect(() => validateExtensionId("A".repeat(32))).toThrow();
    expect(() => validateExtensionId("q".repeat(32))).toThrow();
  });
});

describe("extension ids and allowed_origins", () => {
  it("composes ids in first-seen order, each once", () => {
    expect(composeExtensionIds([A], [B, A], [B])).toEqual([A, B]);
    expect(() => composeExtensionIds([A], ["nope"])).toThrow(/not an extension id/);
  });
  it("reads ids back from origins and ignores anything else", () => {
    expect(idsFromOrigins([...allowedOrigins([A, B]), "https://evil.example/", `chrome-extension://${A}/`, 7])).toEqual([A, B]);
    expect(idsFromOrigins(undefined)).toEqual([]);
  });
  it("derives the id from the manifest key with the shared scripts/extension-id.mjs", async () => {
    // "AAAA" is three zero bytes; SHA-256 = 709e80c88487a2411e1ee4dfb9f22a86..., each hex digit 0-f -> a-p.
    const fromKey = await loadExtensionIdFromKey(fileURLToPath(new URL("../../..", import.meta.url)));
    expect(fromKey).toBe(extensionIdFromKey);
    expect(fromKey("AAAA")).toBe("hajoiamiieihkcebbobooenpljpcckig");
    await expect(loadExtensionIdFromKey("/no/such/checkout")).rejects.toThrow(/missing/);
  });
  it("gives the extension's real key its stable id", () => {
    const m = JSON.parse(readFileSync(new URL("../../../apps/extension/public/manifest.json", import.meta.url), "utf8")) as { key: string };
    expect(extensionIdFromKey(m.key)).toBe("pbmfhppffaiedhljpgpigancfhknohol");
  });
});

describe("where each browser looks", () => {
  it("Windows: one manifest in Handrail's folder, one HKCU key per browser", () => {
    const l = hostLocations("win32", "C:\\Users\\p", "C:\\Users\\p\\AppData\\Local\\Distill\\handrail");
    expect(l.map((x) => x.browser.id)).toEqual(["chrome", "edge", "chromium"]);
    expect(new Set(l.map((x) => x.manifestPath))).toEqual(new Set([`C:\\Users\\p\\AppData\\Local\\Distill\\handrail\\${HOST_NAME}.json`]));
    expect(l.map((x) => x.registryKey)).toEqual([
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
      `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`,
    ]);
    expect(registryKey(BROWSERS[0]!)).toBe(l[0]!.registryKey);
  });
  it("macOS and Linux: a manifest in each browser's own folder, no registry", () => {
    const mac = hostLocations("darwin", "/Users/p", "/tmp/h");
    expect(mac.map((x) => x.manifestPath)).toEqual([
      `/Users/p/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json`,
      `/Users/p/Library/Application Support/Microsoft Edge/NativeMessagingHosts/${HOST_NAME}.json`,
      `/Users/p/Library/Application Support/Chromium/NativeMessagingHosts/${HOST_NAME}.json`,
    ]);
    const linux = hostLocations("linux", "/home/p", "/run/user/1/distill-handrail");
    expect(linux.map((x) => x.manifestPath)).toEqual([
      `/home/p/.config/google-chrome/NativeMessagingHosts/${HOST_NAME}.json`,
      `/home/p/.config/microsoft-edge/NativeMessagingHosts/${HOST_NAME}.json`,
      `/home/p/.config/chromium/NativeMessagingHosts/${HOST_NAME}.json`,
    ]);
    expect(linux.every((x) => x.registryKey === undefined)).toBe(true);
  });
  it("writes a wrapper that runs this node, and reads it back", () => {
    expect(wrapperPath("win32", "C:\\d")).toBe("C:\\d\\handrail-host.cmd");
    expect(wrapperPath("linux", "/d")).toBe("/d/handrail-host.sh");
    const w = wrapperText("win32", "C:\\Program Files\\nodejs\\node.exe", "C:\\r\\host.js");
    expect(w).toBe('@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\r\\host.js" %*\r\n');
    expect(parseWrapper(w)).toEqual({ nodePath: "C:\\Program Files\\nodejs\\node.exe", hostJs: "C:\\r\\host.js" });
    expect(parseWrapper(wrapperText("linux", "/usr/bin/node", "/r/host.js"))).toEqual({ nodePath: "/usr/bin/node", hostJs: "/r/host.js" });
    expect(parseWrapper("echo hi")).toBeUndefined();
  });
});
