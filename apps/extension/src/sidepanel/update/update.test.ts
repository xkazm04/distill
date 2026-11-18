// @vitest-environment node
// Updating from inside the extension: what counts as a newer release, reading the release zip, the checks that
// must hold before a byte is written, and the write itself (into a folder a test stands in for).
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkFolder, checkPackage, sha256Hex, writeOrder, writePackage, type FileEntry, type Folder } from "./package";
import { isNewer, isRelease, LATEST_RELEASE_URL, parseRelease, parseVersion } from "./release";
import { checkForUpdate, CHECK_EVERY_MS, downloadPackage, installInto, STORAGE_KEY, updaterKind } from "./updater";
import { crc32, readZip, safeName, type ZipEntry } from "./zip";

const enc = (s: string) => new TextEncoder().encode(s);

/** A zip laid out the way scripts/pack-extension.mjs writes one. `crc` overrides the checksum, to damage it. */
function zip(files: { name: string; data: Uint8Array; store?: boolean; crc?: number }[]): Uint8Array {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = f.store ? Buffer.from(f.data) : deflateRawSync(f.data);
    const crc = f.crc ?? crc32(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(f.store ? 0 : 8, 8);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(f.data.length, 22); head.writeUInt16LE(name.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(f.store ? 0 : 8, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(f.data.length, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    local.push(head, name, packed); central.push(cen, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, dir, end]));
}

/** A folder in memory, recording the order of writes and removals. */
class MemFolder implements Folder {
  files = new Map<string, string>();
  dirs = new Map<string, MemFolder>();
  constructor(readonly state: { log: string[]; failOn?: string } = { log: [] }, readonly path = "") {}
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) { if (!o?.create) throw new Error("NotFound"); d = new MemFolder(this.state, `${this.path}${name}/`); this.dirs.set(name, d); }
    return d;
  }
  async getFileHandle(name: string, o?: { create?: boolean }): Promise<FileEntry> {
    if (!this.files.has(name) && !o?.create) throw new Error("NotFound");
    return {
      getFile: async () => ({ text: async () => this.files.get(name) ?? "" }),
      createWritable: async () => {
        let pending = "";
        return {
          write: async (d: Uint8Array) => { if (this.path + name === this.state.failOn) throw new Error("disk"); pending = new TextDecoder().decode(d); },
          close: async () => { this.files.set(name, pending); this.state.log.push(this.path + name); },
        };
      },
    };
  }
  async removeEntry(name: string) { this.files.delete(name); this.dirs.delete(name); this.state.log.push(`-${this.path}${name}`); }
  async *keys() { yield* [...this.files.keys(), ...this.dirs.keys()]; }
}

const KEY = "PUBLICKEY";
const manifest = (version: string, key = KEY) => JSON.stringify({ manifest_version: 3, name: "Distill", version, key });
const build = (version: string, key = KEY): ZipEntry[] => [
  { name: "manifest.json", data: enc(manifest(version, key)) },
  { name: "background.js", data: enc(`bg ${version}`) },
  { name: "content.js", data: enc(`content ${version}`) },
  { name: "sidepanel.html", data: enc(`<html>${version}</html>`) },
  { name: `assets/sidepanel-${version}.js`, data: enc(`panel ${version}`) },
  { name: "icons/icon-16.png", data: enc("png") },
];
/** A folder that holds `version`, with a clean log. */
async function installed(version: string): Promise<MemFolder> {
  const f = new MemFolder();
  await writePackage(f, build(version));
  f.state.log.length = 0;
  return f;
}

const ghRelease = (version: string, over: Record<string, unknown> = {}, asset: Record<string, unknown> = {}) => ({
  tag_name: `v${version}`, draft: false, prerelease: false, html_url: `https://github.com/xkazm04/distill/releases/tag/v${version}`,
  assets: [
    { name: `distill-extension-${version}-store.zip`, url: "https://api.github.com/repos/xkazm04/distill/releases/assets/1", size: 10 },
    { name: `distill-extension-${version}.zip`, url: "https://api.github.com/repos/xkazm04/distill/releases/assets/2", size: 1234, digest: `sha256:${"AB".repeat(32)}`, ...asset },
  ],
  ...over,
});

describe("versions", () => {
  it("reads Chrome versions, with or without a v", () => {
    expect(parseVersion("v0.2.0")).toEqual([0, 2, 0]);
    expect(parseVersion("1.2.3.4")).toEqual([1, 2, 3, 4]);
    for (const bad of ["", "1.2.3.4.5", "1.x", "0.2.0-beta", "latest"]) expect(parseVersion(bad)).toBeNull();
  });
  it("compares by number, not by text", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.2", "0.2.0")).toBe(false);
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
    expect(isNewer("junk", "0.1.0")).toBe(false);
  });
});

describe("a release from GitHub's answer", () => {
  it("takes the unpacked download, never the store copy", () => {
    expect(parseRelease(ghRelease("0.2.0"))).toEqual({
      version: "0.2.0", assetUrl: "https://api.github.com/repos/xkazm04/distill/releases/assets/2", size: 1234,
      sha256: "ab".repeat(32), page: "https://github.com/xkazm04/distill/releases/tag/v0.2.0",
    });
  });
  it("refuses drafts, pre-releases, other repositories, another version's zip and absurd sizes", () => {
    expect(parseRelease(ghRelease("0.2.0", { draft: true }))).toBeNull();
    expect(parseRelease(ghRelease("0.2.0", { prerelease: true }))).toBeNull();
    expect(parseRelease(ghRelease("0.2.0", { html_url: "https://github.com/someone/else/releases/tag/v0.2.0" }))).toBeNull();
    expect(parseRelease(ghRelease("0.2.0", {}, { url: "https://evil.example/distill.zip" }))).toBeNull();
    expect(parseRelease(ghRelease("0.2.0", {}, { url: "https://api.github.com/repos/someone/else/releases/assets/2" }))).toBeNull();
    expect(parseRelease(ghRelease("0.2.0", {}, { name: "distill-extension-0.3.0.zip" }))).toBeNull();
    expect(parseRelease(ghRelease("0.2.0", {}, { size: 500 * 1024 * 1024 }))).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ tag_name: "v0.2.0" })).toBeNull();
  });
  it("a stored release is checked like a fetched one", () => {
    const r = parseRelease(ghRelease("0.2.0"))!;
    expect(isRelease(r)).toBe(true);
    expect(isRelease({ ...r, assetUrl: "https://evil.example/x.zip" })).toBe(false);
    expect(isRelease({ ...r, page: "javascript:alert(1)" })).toBe(false);
  });
});

describe("reading the release zip", () => {
  it("round-trips deflated and stored files and skips folders", async () => {
    const big = enc("distill ".repeat(5000));
    const out = await readZip(zip([
      { name: "assets/", data: new Uint8Array(), store: true }, { name: "manifest.json", data: enc("{}") },
      { name: "assets/a.js", data: big }, { name: "icons/i.png", data: enc("png"), store: true },
    ]));
    expect(out.map((e) => e.name)).toEqual(["manifest.json", "assets/a.js", "icons/i.png"]);
    expect(out[1]!.data).toEqual(big);
  });
  it("refuses names that could leave the folder", async () => {
    for (const name of ["../evil.js", "/abs.js", "a/../../b.js", "C:/x.js", "a\\b.js", "a//b.js", "a/./b.js", "con. ", ""]) expect(safeName(name)).toBe(false);
    expect(safeName("assets/sidepanel-AbC_1.js")).toBe(true);
    await expect(readZip(zip([{ name: "../evil.js", data: enc("x") }]))).rejects.toThrow(/unsafe name/);
  });
  it("refuses a file that does not match its checksum, a repeated name, and something that is not a zip", async () => {
    await expect(readZip(zip([{ name: "a.js", data: enc("x"), crc: 1 }]))).rejects.toThrow(/checksum/);
    await expect(readZip(zip([{ name: "a.js", data: enc("x") }, { name: "A.js", data: enc("y") }]))).rejects.toThrow(/twice/);
    await expect(readZip(enc("<html>not found</html>"))).rejects.toThrow(/not a zip/);
    const cut = zip([{ name: "a.js", data: enc("hello hello hello") }]);
    cut[35] = cut[35]! ^ 0xff; // damage the packed bytes
    await expect(readZip(cut)).rejects.toThrow();
  });
});

describe("the package must be a later build of this same extension", () => {
  const running = { key: KEY, version: "0.2.0" };
  it("accepts a later version with the same key", () => {
    expect(checkPackage(build("0.3.0"), running, "0.3.0")).toEqual({ ok: true, version: "0.3.0" });
  });
  it("refuses another key, the same or an older version, a version other than announced, and a missing entry point", () => {
    expect(checkPackage(build("0.3.0", "OTHER"), running)).toMatchObject({ ok: false, why: expect.stringMatching(/not the same extension/) });
    expect(checkPackage(build("0.2.0"), running)).toMatchObject({ ok: false, why: expect.stringMatching(/not newer/) });
    expect(checkPackage(build("0.1.0"), running)).toMatchObject({ ok: false });
    expect(checkPackage(build("0.4.0"), running, "0.3.0")).toMatchObject({ ok: false, why: expect.stringMatching(/not 0\.3\.0/) });
    expect(checkPackage(build("0.3.0").filter((e) => e.name !== "background.js"), running)).toMatchObject({ ok: false, why: expect.stringMatching(/background\.js/) });
    expect(checkPackage([{ name: "manifest.json", data: enc("not json") }], running)).toMatchObject({ ok: false });
    expect(checkPackage(build("0.3.0"), { version: "0.2.0" })).toMatchObject({ ok: false, why: expect.stringMatching(/no fixed identity/) });
  });
});

describe("the folder must hold the running extension", () => {
  const running = { key: KEY, version: "0.2.0" };
  it("accepts the folder with the running manifest", async () => {
    expect(await checkFolder(await installed("0.2.0"), running)).toEqual({ ok: true, version: "0.2.0" });
  });
  it("refuses an empty folder, another extension and another version of Distill", async () => {
    expect(await checkFolder(new MemFolder(), running)).toMatchObject({ ok: false, why: expect.stringMatching(/no manifest/) });
    const other = new MemFolder(); other.files.set("manifest.json", manifest("0.2.0", "OTHER"));
    expect(await checkFolder(other, running)).toMatchObject({ ok: false, why: expect.stringMatching(/another extension/) });
    expect(await checkFolder(await installed("0.1.0"), running)).toMatchObject({ ok: false, why: expect.stringMatching(/0\.1\.0/) });
  });
});

describe("writing the package", () => {
  it("writes the manifest last, after the entry points", () => {
    const order = writeOrder(build("0.3.0")).map((e) => e.name);
    expect(order.at(-1)).toBe("manifest.json");
    expect(order.slice(0, 2)).toEqual(["assets/sidepanel-0.3.0.js", "icons/icon-16.png"]);
  });
  it("replaces the files, removes only the old content-named files, and touches nothing else", async () => {
    const folder = await installed("0.2.0");
    folder.files.set("notes.txt", "mine");
    const result = await installInto(folder, build("0.3.0"), { key: KEY, version: "0.2.0" });
    expect(result).toEqual({ ok: true, version: "0.2.0" });
    expect(JSON.parse(folder.files.get("manifest.json")!).version).toBe("0.3.0");
    expect(folder.files.get("background.js")).toBe("bg 0.3.0");
    expect([...folder.dirs.get("assets")!.files.keys()]).toEqual(["sidepanel-0.3.0.js"]);
    expect(folder.files.get("notes.txt")).toBe("mine");
    const { log } = folder.state;
    expect(log.indexOf("manifest.json")).toBe(log.filter((l) => !l.startsWith("-")).length - 1);
    expect(log.filter((l) => l.startsWith("-"))).toEqual(["-assets/sidepanel-0.2.0.js"]);
  });
  it("writes nothing into a folder that is not the running extension's", async () => {
    const folder = await installed("0.1.0");
    expect(await installInto(folder, build("0.3.0"), { key: KEY, version: "0.2.0" })).toMatchObject({ ok: false });
    expect(folder.state.log).toEqual([]);
  });
  it("a write that fails leaves the old manifest and the old content-named files", async () => {
    const folder = await installed("0.2.0");
    folder.state.failOn = "background.js";
    await expect(installInto(folder, build("0.3.0"), { key: KEY, version: "0.2.0" })).rejects.toThrow();
    expect(JSON.parse(folder.files.get("manifest.json")!).version).toBe("0.2.0");
    expect(folder.dirs.get("assets")!.files.has("sidepanel-0.2.0.js")).toBe(true);
  });
});

describe("the check", () => {
  type Area = Pick<chrome.storage.StorageArea, "get" | "set"> & { data: Record<string, unknown> };
  const area = (initial: Record<string, unknown> = {}): Area => {
    const data = { ...initial };
    return { data, get: async (k: unknown) => ({ [k as string]: data[k as string] }), set: async (v: Record<string, unknown>) => { Object.assign(data, v); } } as unknown as Area;
  };
  const answering = (body: unknown, calls: unknown[][] = [], status = 200) =>
    (async (...a: unknown[]) => { calls.push(a); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;

  it("asks the one fixed address, without cookies, and offers a newer release", async () => {
    const calls: unknown[][] = [], a = area();
    const found = await checkForUpdate({ current: "0.1.0", now: CHECK_EVERY_MS, area: a, fetch: answering(ghRelease("0.2.0"), calls) });
    expect(found?.version).toBe("0.2.0");
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(LATEST_RELEASE_URL);
    expect(calls[0]![1]).toMatchObject({ credentials: "omit" });
    expect((a.data[STORAGE_KEY] as { checkedAt: number }).checkedAt).toBe(CHECK_EVERY_MS);
  });
  it("asks at most once a day, answering from the last check in between", async () => {
    const calls: unknown[][] = [], a = area();
    const f = answering(ghRelease("0.2.0"), calls);
    await checkForUpdate({ current: "0.1.0", now: CHECK_EVERY_MS, area: a, fetch: f });
    expect((await checkForUpdate({ current: "0.1.0", now: CHECK_EVERY_MS * 2 - 1, area: a, fetch: f }))?.version).toBe("0.2.0");
    expect(calls).toHaveLength(1);
    await checkForUpdate({ current: "0.1.0", now: CHECK_EVERY_MS * 2, area: a, fetch: f });
    expect(calls).toHaveLength(2);
    await checkForUpdate({ current: "0.1.0", now: CHECK_EVERY_MS * 2 + 1, force: true, area: a, fetch: f });
    expect(calls).toHaveLength(3);
  });
  it("offers nothing when the release is this version, also from the stored answer", async () => {
    const a = area();
    expect(await checkForUpdate({ current: "0.2.0", now: CHECK_EVERY_MS, area: a, fetch: answering(ghRelease("0.2.0")) })).toBeNull();
    expect(await checkForUpdate({ current: "0.2.0", now: CHECK_EVERY_MS + 5, area: a, fetch: answering({}) })).toBeNull();
  });
  it("stays quiet when GitHub cannot be reached, and fails only when the person asked", async () => {
    const down = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await checkForUpdate({ current: "0.1.0", now: CHECK_EVERY_MS, area: area(), fetch: down })).toBeNull();
    await expect(checkForUpdate({ current: "0.1.0", now: CHECK_EVERY_MS, force: true, area: area(), fetch: down })).rejects.toThrow();
    await expect(checkForUpdate({ current: "0.1.0", now: CHECK_EVERY_MS, force: true, area: area(), fetch: answering({}, [], 403) })).rejects.toThrow();
  });
  it("does not trust what is in storage", async () => {
    const a = area({ [STORAGE_KEY]: { checkedAt: CHECK_EVERY_MS, release: { version: "9.0.0", assetUrl: "https://evil.example/x.zip", size: 5, page: "https://evil.example" } } });
    expect(await checkForUpdate({ current: "0.1.0", now: CHECK_EVERY_MS + 1, area: a, fetch: answering({}) })).toBeNull();
  });
});

describe("the download", () => {
  const running = { key: KEY, version: "0.2.0" };
  const serve = (bytes: Uint8Array, calls: unknown[][] = []) =>
    (async (...a: unknown[]) => { calls.push(a); return new Response(bytes as Uint8Array<ArrayBuffer>); }) as unknown as typeof fetch;
  const releaseFor = async (bytes: Uint8Array, version = "0.3.0") => ({
    version, assetUrl: "https://api.github.com/repos/xkazm04/distill/releases/assets/2", size: bytes.length,
    sha256: await sha256Hex(bytes), page: "https://github.com/xkazm04/distill/releases/tag/v0.3.0",
  });
  it("returns the files of a package that is the right size, checksum and extension", async () => {
    const bytes = zip(build("0.3.0")), calls: unknown[][] = [];
    const entries = await downloadPackage(await releaseFor(bytes), running, serve(bytes, calls));
    expect(entries.map((e) => e.name)).toContain("manifest.json");
    expect(calls[0]![1]).toMatchObject({ credentials: "omit", headers: { Accept: "application/octet-stream" } });
  });
  it("refuses a wrong size, a wrong checksum, a damaged zip and another extension's package", async () => {
    const bytes = zip(build("0.3.0"));
    const release = await releaseFor(bytes);
    await expect(downloadPackage({ ...release, size: bytes.length + 1 }, running, serve(bytes))).rejects.toThrow(/size/);
    await expect(downloadPackage({ ...release, sha256: "0".repeat(64) }, running, serve(bytes))).rejects.toThrow(/checksum/);
    const junk = enc("x".repeat(100));
    await expect(downloadPackage(await releaseFor(junk), running, serve(junk))).rejects.toThrow(/unpacked/);
    const other = zip(build("0.3.0", "OTHER"));
    await expect(downloadPackage(await releaseFor(other), running, serve(other))).rejects.toThrow(/not the same extension/);
    const mislabelled = zip(build("0.4.0"));
    await expect(downloadPackage(await releaseFor(mislabelled), running, serve(mislabelled))).rejects.toThrow(/not 0\.3\.0/);
  });
});

describe("who updates this copy", () => {
  it("only the on-device build loaded unpacked updates itself", () => {
    expect(updaterKind({}, "public")).toBe("self");
    expect(updaterKind({ update_url: "https://clients2.google.com/service/update2/crx" }, "public")).toBe("none");
    expect(updaterKind({}, "own")).toBe("none");
    expect(updaterKind({}, undefined)).toBe("none");
  });
});
