// Spark universal-core round 2, card 2: one claim checked on the web (task checkClaim, cloud, grounded in Google
// Search). The answer is untrusted: a closed set of verdicts, plain text, and sources accepted only when they are
// among the search results the service itself returned (grounding metadata), never a link the model wrote.

export type ClaimVerdict = "supported" | "disputed" | "mixed" | "notFound";
export const CLAIM_VERDICTS: readonly ClaimVerdict[] = ["supported", "disputed", "mixed", "notFound"];

/** A web page the search behind a check used (from the response's grounding metadata). */
export interface CheckSource { title: string; url: string }

export interface ClaimCheck {
  claimId: string;
  verdict: ClaimVerdict;
  /** One plain sentence, at most about 240 characters. */
  reason: string;
  /** Sources that passed: https only, among `grounding`, at most 5. */
  sources: CheckSource[];
}

export interface CheckResult {
  check: ClaimCheck | null;
  /** Things refused: an unknown verdict, a source not in the search results, HTML. */
  dropped: number;
}

/** The reason's length cap (characters); a longer one is cut at a word and ends with "...". */
export const REASON_MAX = 240;
/** At most this many sources per check. */
export const SOURCES_MAX = 5;
/** A source's shown title is cut to this many characters. */
const TITLE_MAX = 90;

const TAG = /<\/?[a-zA-Z][^<>]*>/g;
const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)\S+/gi;
/** Fields where a model might put links of its own. They are never shown; each entry counts as refused. */
const MODEL_LINK_FIELDS = ["sources", "links", "urls", "citations", "references"];

/** The answer as an object: as given, or parsed from text (a fence or words around the JSON are tolerated). */
function asObject(answer: unknown): Record<string, unknown> | null {
  if (answer && typeof answer === "object" && !Array.isArray(answer)) return answer as Record<string, unknown>;
  if (typeof answer !== "string") return null;
  const text = answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Plain text: tags out, whitespace collapsed. `hadHtml` says whether anything was taken out. */
function plain(text: string): { text: string; hadHtml: boolean } {
  const noTags = text.replace(TAG, " ");
  const hadHtml = noTags !== text || /[<>]/.test(noTags);
  return { text: noTags.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim(), hadHtml };
}

/** Cuts `text` to `max` characters at a word, ending with "..." when it was cut. */
function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.-]+$/, "")}...`;
}

/** The host of an https URL, or null when `url` is not one. */
function httpsHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname ? u.hostname : null;
  } catch {
    return null;
  }
}

/** The grounding service's own redirect host: the link works, but its host says nothing to a reader. */
const REDIRECT_HOST = /(^|\.)vertexaisearch\.cloud\.google\.com$/i;

/**
 * The door for checkClaim's answer. `grounding`: the sources the service reported for this answer.
 *
 * - verdict: one of CLAIM_VERDICTS, else the whole answer is refused (check null, counted);
 * - reason: plain text (HTML taken out and counted), no links in it (taken out and counted), at most REASON_MAX;
 * - sources: ONLY from `grounding`, https only (others counted), the same address once, at most SOURCES_MAX; links
 *   the model wrote in its own answer are never shown (each counted).
 */
export function parseCheck(answer: unknown, grounding: readonly CheckSource[], claimId: string): CheckResult {
  let dropped = 0;
  const obj = asObject(answer);
  if (!obj) return { check: null, dropped: 1 };

  for (const field of MODEL_LINK_FIELDS) {
    const v = obj[field];
    if (Array.isArray(v)) dropped += v.length;
    else if (v !== undefined && v !== null && v !== "") dropped += 1;
  }

  const verdict = obj.verdict;
  if (typeof verdict !== "string" || !(CLAIM_VERDICTS as readonly string[]).includes(verdict)) {
    return { check: null, dropped: dropped + 1 };
  }

  let reason = "";
  if (typeof obj.reason === "string") {
    const p = plain(obj.reason);
    if (p.hadHtml) dropped += 1;
    const noLinks = p.text.replace(URL_IN_TEXT, " ");
    if (noLinks !== p.text) dropped += 1;
    reason = cap(noLinks.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim(), REASON_MAX);
  } else if (obj.reason !== undefined) {
    dropped += 1;
  }

  const sources: CheckSource[] = [];
  const seen = new Set<string>();
  for (const g of grounding) {
    const url = typeof g?.url === "string" ? g.url.trim() : "";
    const host = httpsHost(url);
    if (!host) { dropped += 1; continue; }
    if (seen.has(url)) continue; // the service often lists one page more than once: not a refusal
    if (sources.length >= SOURCES_MAX) continue;
    seen.add(url);
    const title = plain(typeof g.title === "string" ? g.title : "").text;
    const fallback = REDIRECT_HOST.test(host) ? "A web source" : host.replace(/^www\./, "");
    sources.push({ title: cap(title || fallback, TITLE_MAX), url });
  }

  return { check: { claimId, verdict: verdict as ClaimVerdict, reason, sources }, dropped };
}
