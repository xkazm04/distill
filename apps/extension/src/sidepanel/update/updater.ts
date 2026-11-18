// The browser side of updating: the daily check, the download, the folder the person chose, and the restart.
// The decisions (what a release is, what a package must be, what is written where) are in release.ts and package.ts.
import { checkFolder, checkPackage, sha256Hex, writePackage, type Checked, type Folder, type Identity } from "./package";
import { DOWNLOAD_ORIGINS, isNewer, isRelease, LATEST_RELEASE_URL, parseRelease, type Release } from "./release";
import { readZip, ZipError, type ZipEntry } from "./zip";

/**
 * Who updates this copy.
 * - "self": the on-device build, loaded unpacked from the release zip. It checks and can install.
 * - "none": a Chrome Web Store install (Chrome updates it; the manifest then has an update_url) and a build made from
 *   source (the release zip is the on-device build, so installing it would replace the builder's own).
 */
export type UpdaterKind = "self" | "none";
export const updaterKind = (manifest: { update_url?: unknown }, variant: string | undefined): UpdaterKind =>
  variant === "public" && manifest.update_url === undefined ? "self" : "none";

export const STORAGE_KEY = "update";
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

interface Stored { checkedAt: number; release?: Release }
type Area = Pick<chrome.storage.StorageArea, "get" | "set">;

/**
 * The newest release when it is newer than `current`, else null. Asks GitHub at most once a day unless `force`;
 * in between it answers from what the last check found. Throws only on a forced check that could not be made.
 */
export async function checkForUpdate(o: {
  current: string; now: number; force?: boolean; area: Area; fetch: typeof fetch;
}): Promise<Release | null> {
  const raw = (await o.area.get(STORAGE_KEY).catch(() => ({} as Record<string, unknown>)))[STORAGE_KEY] as Partial<Stored> | undefined;
  const last = typeof raw?.checkedAt === "number" ? raw.checkedAt : 0;
  const known = isRelease(raw?.release) ? raw.release : undefined;
  const newer = (r: Release | undefined) => (r && isNewer(r.version, o.current) ? r : null);
  if (!o.force && last <= o.now && o.now - last < CHECK_EVERY_MS) return newer(known);
  let release: Release | null;
  try {
    // No cookies and no cache: the request says nothing but "which version is the newest".
    const r = await o.fetch(LATEST_RELEASE_URL, { credentials: "omit", cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    release = parseRelease(await r.json());
  } catch (e) {
    if (o.force) throw e;
    return newer(known); // offline, or GitHub is busy: try again next time the panel opens
  }
  await o.area.set({ [STORAGE_KEY]: { checkedAt: o.now, ...(release ? { release } : {}) } satisfies Stored }).catch(() => undefined);
  return newer(release ?? undefined);
}

export class UpdateError extends Error {}

/** Downloads the release and checks it is a later build of this same extension. Nothing is written anywhere. */
export async function downloadPackage(release: Release, running: Identity, fetchFn: typeof fetch): Promise<ZipEntry[]> {
  let bytes: Uint8Array;
  try {
    const r = await fetchFn(release.assetUrl, { credentials: "omit", cache: "no-store", headers: { Accept: "application/octet-stream" } });
    if (!r.ok) throw new Error(String(r.status));
    bytes = new Uint8Array(await r.arrayBuffer());
  } catch {
    throw new UpdateError("The download did not arrive. Check the connection and try again.");
  }
  if (bytes.length !== release.size) throw new UpdateError("The download is not the size GitHub lists, so it was not used.");
  if (release.sha256 && (await sha256Hex(bytes)) !== release.sha256) throw new UpdateError("The download does not match the checksum GitHub lists, so it was not used.");
  let entries: ZipEntry[];
  try { entries = await readZip(bytes); }
  catch (e) { throw new UpdateError(`The download could not be unpacked: ${e instanceof ZipError ? e.message : "it is damaged"}.`); }
  const checked = checkPackage(entries, running, release.version);
  if (!checked.ok) throw new UpdateError(checked.why);
  return entries;
}

/** Checks the folder is the running extension's, then writes the package into it. */
export async function installInto(folder: Folder, entries: ZipEntry[], running: Identity, onProgress?: (done: number, of: number) => void): Promise<Checked> {
  const checked = await checkFolder(folder, running);
  if (!checked.ok) return checked;
  await writePackage(folder, entries, onProgress);
  return checked;
}

// ---- access to GitHub's download hosts, only for the download ---------------------------------------------------

/** Asks for the download hosts (inside the person's click). Returns whether this call added them. */
export async function withDownloadAccess<T>(run: () => Promise<T>): Promise<T> {
  const had = await chrome.permissions.contains({ origins: DOWNLOAD_ORIGINS });
  if (!had && !(await chrome.permissions.request({ origins: DOWNLOAD_ORIGINS }))) {
    throw new UpdateError("Chrome did not allow the download from GitHub, so nothing was downloaded.");
  }
  try { return await run(); }
  finally { if (!had) await chrome.permissions.remove({ origins: DOWNLOAD_ORIGINS }).catch(() => false); } // given back straight away
}

// ---- the folder the person chose, kept on this device ------------------------------------------------------------

/** A folder handle from the browser: Folder, plus asking for the right to write. */
export interface ChosenFolder extends Folder {
  queryPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
}
type Picker = (o: { mode: "readwrite"; id: string }) => Promise<ChosenFolder>;

export const canPickFolder = (): boolean => typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
export const pickFolder = (): Promise<ChosenFolder> =>
  (globalThis as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker({ mode: "readwrite", id: "distill-extension" });

const DB = "distill-update", STORE = "folder", KEY = "extension";
const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const tx = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = run(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally { db.close(); }
};
/** The handle is kept in this browser profile only; it names a folder and gives nothing until the person allows it. */
export const rememberedFolder = (): Promise<ChosenFolder | undefined> => tx<ChosenFolder | undefined>("readonly", (s) => s.get(KEY)).catch(() => undefined);
export const rememberFolder = (f: ChosenFolder): Promise<void> => tx("readwrite", (s) => s.put(f, KEY)).then(() => undefined, () => undefined);
export const forgetFolder = (): Promise<void> => tx("readwrite", (s) => s.delete(KEY)).then(() => undefined, () => undefined);
