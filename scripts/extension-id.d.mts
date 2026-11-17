/** The Chrome extension id for a manifest `key` (base64 DER public key): sha256, first 32 hex digits mapped 0-f -> a-p. */
export function extensionIdFromKey(base64Key: string): string;
