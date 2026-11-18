// Which version is the newest, read from the project's GitHub releases. Pure: no browser, no network.
//
// The check sends nothing about the person or the page: one GET of a fixed address, without cookies. Everything the
// answer says is untrusted: only addresses under this repository are accepted, and the package itself is checked
// again before a byte is written (package.ts).

export const REPOSITORY = "xkazm04/distill";
/** The one address the check reads. */
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
/** Where a download may come from: the API, and the hosts GitHub redirects a release file to. */
export const DOWNLOAD_ORIGINS = ["https://api.github.com/*", "https://*.githubusercontent.com/*"];

const ASSET_URL = new RegExp(`^https://api\\.github\\.com/repos/${REPOSITORY}/releases/assets/\\d+$`);
const PAGE_URL = new RegExp(`^https://github\\.com/${REPOSITORY}/releases/`);
/** The download people load unpacked (scripts/pack-extension.mjs). Never the "-store" copy: it has no key. */
const ASSET_NAME = /^distill-extension-(\d+(?:\.\d+){0,3})\.zip$/;
/** No release zip is anywhere near this; a larger one is not ours. */
export const MAX_PACKAGE_BYTES = 40 * 1024 * 1024;

export interface Release {
  /** As in the manifest: "0.2.0". */
  version: string;
  /** The API address of the zip (fetched with Accept: application/octet-stream). */
  assetUrl: string;
  size: number;
  /** Lower-case hex, when GitHub states one. */
  sha256?: string;
  /** The release's page, for reading the notes and for installing by hand. */
  page: string;
}

/** "0.2.0" or "v0.2.0" as numbers; null when it is not a Chrome version (1 to 4 whole numbers). */
export function parseVersion(text: string): number[] | null {
  const m = /^v?(\d{1,6}(?:\.\d{1,6}){0,3})$/.exec(text.trim());
  return m ? m[1]!.split(".").map(Number) : null;
}

/** True when `candidate` is a later version than `current`. False when either is not a version. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 4; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The release in GitHub's answer, or null when it is a draft, a pre-release, or not shaped like one of ours. */
export function parseRelease(json: unknown): Release | null {
  if (!isRecord(json) || json.draft === true || json.prerelease === true) return null;
  if (typeof json.tag_name !== "string" || typeof json.html_url !== "string" || !PAGE_URL.test(json.html_url)) return null;
  const tag = parseVersion(json.tag_name);
  if (!tag || !Array.isArray(json.assets)) return null;
  for (const a of json.assets) {
    if (!isRecord(a) || typeof a.name !== "string" || typeof a.url !== "string" || typeof a.size !== "number") continue;
    const named = ASSET_NAME.exec(a.name);
    if (!named || !ASSET_URL.test(a.url)) continue;
    // The file must be the tag's version: a release that carries another version's zip is a mistake, not an update.
    if (parseVersion(named[1]!)!.join(".") !== tag.join(".")) continue;
    if (!Number.isInteger(a.size) || a.size <= 0 || a.size > MAX_PACKAGE_BYTES) continue;
    const digest = typeof a.digest === "string" ? /^sha256:([0-9a-f]{64})$/i.exec(a.digest)?.[1]?.toLowerCase() : undefined;
    return { version: named[1]!, assetUrl: a.url, size: a.size, page: json.html_url, ...(digest ? { sha256: digest } : {}) };
  }
  return null;
}

/** A stored release is trusted no more than a fetched one. */
export function isRelease(v: unknown): v is Release {
  return isRecord(v) && typeof v.version === "string" && parseVersion(v.version) !== null
    && typeof v.assetUrl === "string" && ASSET_URL.test(v.assetUrl)
    && typeof v.size === "number" && v.size > 0 && v.size <= MAX_PACKAGE_BYTES
    && typeof v.page === "string" && PAGE_URL.test(v.page)
    && (v.sha256 === undefined || (typeof v.sha256 === "string" && /^[0-9a-f]{64}$/.test(v.sha256)));
}
