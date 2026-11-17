// The Chrome extension id a manifest `key` gives. Chrome's rule: SHA-256 of the DER-encoded public key (the `key`
// value is that DER, base64), the first 32 hex digits, each digit 0-f written as a letter a-p.
// Shared: pack-extension.mjs writes it to apps/extension/release/extension-id.txt, and the Handrail set-up uses it for
// the native host's allowed_origins (chrome-extension://<id>/).
import { createHash } from "node:crypto";

/** @param {string} base64Key the manifest's `key` (a base64 DER public key; whitespace is ignored) */
export function extensionIdFromKey(base64Key) {
  const der = Buffer.from(base64Key.replace(/\s+/g, ""), "base64");
  if (der.length === 0) throw new Error("extensionIdFromKey: the key is empty");
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...hex].map((d) => String.fromCharCode(97 + parseInt(d, 16))).join("");
}
