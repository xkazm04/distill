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
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
