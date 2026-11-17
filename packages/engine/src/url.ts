/**
 * The address a model may carry: origin + path only. Query strings and fragments routinely hold a person's data or a
 * session/reset token (`?email=...`, `#access_token=...`), and FormStructure.url is stored in Firestore form guides (per person today, possibly shared later)
 * so neither is ever kept. An address that does not parse becomes "".
 */
export function publicUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin === "null" ? "" : `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}
