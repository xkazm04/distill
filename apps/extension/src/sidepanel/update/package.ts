// A downloaded release, checked and written into the folder Chrome loads Distill from.
//
// Chrome gives an extension no way to replace its own files. What it does give a page is the File System Access API:
// the person picks a folder once, and the page may then write into it. So the person picks the folder Distill was
// loaded from, Distill writes the new version there, and `chrome.runtime.reload()` makes Chrome read it.
//
// Nothing is written unless all of this holds:
// - the package is a Distill build with the SAME manifest key as the running one (so the same extension id), a later
//   version, and the files a build always has;
// - the folder holds the running extension: its manifest has that key and the running version.
// The manifest is written last, so a write that stops half way leaves the old manifest in place.
import { isNewer } from "./release";
import type { ZipEntry } from "./zip";

/** The part of the manifest the checks use. */
export interface Identity { key?: string; version: string }

/** The parts of FileSystemDirectoryHandle this file uses (so a test can stand in for a folder). */
export interface Folder {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<Folder>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileEntry>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}
export interface FileEntry {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

export type Checked = { ok: true; version: string } | { ok: false; why: string };

const MANIFEST = "manifest.json";
/** The files Chrome starts from. They go last, the manifest after all of them. */
const ENTRY_POINTS = ["content.js", "sidepanel.html", "background.js"];
/** Where the build puts files named by their content; only there may an old file be removed. */
const HASHED_DIR = "assets";

const parseManifest = (text: string): Record<string, unknown> | null => {
  try {
    const m: unknown = JSON.parse(text);
    return typeof m === "object" && m !== null && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
  } catch { return null; }
};

/** Is this package a later Distill for the same extension id? */
export function checkPackage(entries: ZipEntry[], running: Identity, announced?: string): Checked {
  if (!running.key) return { ok: false, why: "This copy of Distill has no fixed identity, so it cannot check that an update is its own." };
  const file = entries.find((e) => e.name === MANIFEST);
  const manifest = file ? parseManifest(new TextDecoder().decode(file.data)) : null;
  if (!manifest) return { ok: false, why: "The download is not a Distill extension." };
  if (manifest.key !== running.key) return { ok: false, why: "The download is not the same extension as this one." };
  if (manifest.manifest_version !== 3 || typeof manifest.version !== "string") return { ok: false, why: "The download is not a Distill extension." };
  if (!isNewer(manifest.version, running.version)) return { ok: false, why: `The download is version ${manifest.version}, which is not newer than this one (${running.version}).` };
  if (announced !== undefined && manifest.version !== announced) return { ok: false, why: `The download says it is version ${manifest.version}, not ${announced}.` };
  for (const name of ENTRY_POINTS) if (!entries.some((e) => e.name === name)) return { ok: false, why: `The download is incomplete (${name} is missing).` };
  return { ok: true, version: manifest.version };
}

/** Is this the folder Chrome loaded the running extension from? */
export async function checkFolder(folder: Folder, running: Identity): Promise<Checked> {
  let manifest: Record<string, unknown> | null = null;
  try { manifest = parseManifest(await (await (await folder.getFileHandle(MANIFEST)).getFile()).text()); } catch { /* no manifest here */ }
  if (!manifest) return { ok: false, why: "That folder is not Distill's: it has no manifest.json. Choose the folder you loaded in Chrome's extensions page." };
  if (!running.key || manifest.key !== running.key) return { ok: false, why: "That folder holds another extension, not this Distill." };
  if (manifest.version !== running.version) {
    return { ok: false, why: `That folder holds Distill ${String(manifest.version)}, but version ${running.version} is running. Choose the folder Chrome loaded it from.` };
  }
  return { ok: true, version: running.version };
}

async function writeFile(folder: Folder, name: string, data: Uint8Array): Promise<void> {
  const parts = name.split("/");
  let dir = folder;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const writable = await (await dir.getFileHandle(parts[parts.length - 1]!, { create: true })).createWritable();
  await writable.write(data);
  await writable.close(); // Chrome writes to a temporary file and swaps it in here: a file is old or new, never half
}

/** The order files are written in: everything else, then the entry points, then the manifest. */
export function writeOrder(entries: ZipEntry[]): ZipEntry[] {
  const rank = (n: string) => (n === MANIFEST ? 2 : ENTRY_POINTS.includes(n) ? 1 : 0);
  return [...entries].sort((a, b) => rank(a.name) - rank(b.name));
}

/**
 * Writes the package into the folder and removes the previous build's content-named files. Call checkPackage and
 * checkFolder first. Throws when a write fails; the manifest is then still the old one.
 */
export async function writePackage(folder: Folder, entries: ZipEntry[], onProgress?: (done: number, of: number) => void): Promise<void> {
  const ordered = writeOrder(entries);
  let done = 0;
  for (const e of ordered) {
    await writeFile(folder, e.name, e.data);
    onProgress?.(++done, ordered.length);
  }
  // Only inside assets/, and only after the new manifest is in place: nothing else in the folder is ever removed.
  try {
    const assets = await folder.getDirectoryHandle(HASHED_DIR);
    const keep = new Set(entries.filter((e) => e.name.startsWith(`${HASHED_DIR}/`)).map((e) => e.name.slice(HASHED_DIR.length + 1).split("/")[0]!));
    const stale: string[] = [];
    for await (const name of assets.keys()) if (!keep.has(name)) stale.push(name);
    for (const name of stale) await assets.removeEntry(name).catch(() => undefined); // an old file left behind harms nothing
  } catch { /* no assets folder: nothing to tidy */ }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
