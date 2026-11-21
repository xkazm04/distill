import { sha256 } from "./sha256.js";
import type { FormStructure } from "./types.js";

/** sha-256 hex of origin + path + the ordered (fieldId, kind, label) list. Structure only, never a value. */
export async function fingerprint(url: string, fields: FormStructure["fields"]): Promise<string> {
  let base = url;
  try {
    const u = new URL(url);
    base = u.origin + u.pathname;
  } catch {
    /* keep the raw string */
  }
  const text = base + "\n" + fields.map((f) => `${f.fieldId}\t${f.kind}\t${f.label}`).join("\n");
  const bytes = new TextEncoder().encode(text);
  // crypto.subtle exists only in a secure context; a content script on a plain http page has none.
  const subtle = (globalThis.crypto as (Crypto & { subtle?: SubtleCrypto }) | undefined)?.subtle;
  const digest = subtle ? new Uint8Array(await subtle.digest("SHA-256", bytes)) : sha256(bytes);
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
