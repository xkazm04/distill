// Shared hygiene for model output: model text is untrusted. Strings only, no tags, no script URLs, hard caps.

export const MAX_TEXT = 400;
export const MAX_ITEMS = 20;

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const decode = (s: string): string =>
  s.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'").replace(/&amp;/gi, "&");

/** Plain text from a string: entities decoded, tags removed, whitespace collapsed, capped at `cap` characters. */
export function cleanText(v: unknown, cap = MAX_TEXT): string | null {
  if (typeof v !== "string") return null;
  let s = decode(v);
  for (let i = 0; i < 4; i++) {
    const next = s
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/?[a-z!?][^>]*>?/gi, " ");
    if (next === s) break;
    s = next;
  }
  s = Array.from(s).filter((ch) => { const c = ch.charCodeAt(0); return c >= 0x20 || c === 9 || c === 10 || c === 13; }).join("").replace(/\s+/g, " ").trim();
  return s.length > cap ? s.slice(0, cap - 1).trimEnd() + String.fromCharCode(0x2026) : s;
}

const SQUASH_OUT = new Set([0xa0, 0x2028, 0x2029, 0xfeff]);
const squash = (s: string): string =>
  Array.from(s).filter((ch) => { const c = ch.charCodeAt(0); return c > 0x20 && !SQUASH_OUT.has(c) && !(c >= 0x200b && c <= 0x200f); }).join("").toLowerCase();

/** True when any string, key or value, anywhere in the value carries a script URL. */
export function hasScriptUrl(v: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (typeof v === "string") {
    const q = squash(v);
    return q.includes("javascript:") || q.includes("vbscript:") || q.includes("data:text/html");
  }
  if (Array.isArray(v)) return v.some((x) => hasScriptUrl(x, depth + 1));
  if (isObj(v)) return Object.entries(v).some(([k, x]) => hasScriptUrl(k, depth + 1) || hasScriptUrl(x, depth + 1));
  return false;
}

/** Keep at most MAX_REASONS reasons, summarising the rest. */
export function capReasons(reasons: string[], max = 10): string[] {
  return reasons.length <= max ? reasons : [...reasons.slice(0, max), `and ${reasons.length - max} more`];
}
