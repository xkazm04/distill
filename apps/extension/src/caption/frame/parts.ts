// Round 5, r5-02: More in four parts plus What was removed, one small tab row. Which part opens first, and the person's
// last choice per site (chrome.storage.local, this device only, keyed by origin like caption/sites.ts). The pure
// functions are tested in parts.test.ts; the storage wrappers are thin.

/** The parts of More, in tab order. */
export type Part = "page" | "do" | "check" | "settings" | "removed";
export const PARTS: readonly Part[] = ["page", "do", "check", "settings", "removed"];

/** The tab's words; `short` at phone width, where five tabs share 360 px. */
export const PART_LABEL: Record<Part, { long: string; short: string }> = {
  page: { long: "This page", short: "Page" },
  do: { long: "Do", short: "Do" },
  check: { long: "Check", short: "Check" },
  settings: { long: "Settings", short: "Settings" },
  removed: { long: "What was removed", short: "Removed" },
};

export const isPart = (v: unknown): v is Part => typeof v === "string" && (PARTS as readonly string[]).includes(v);

/** What the page holds, for the part More opens on. */
export interface PartSignals {
  /** Claims found by the model and kept (r2-01). */
  claims: number;
  /** The model is still looking for claims (More opened before the answer): an article opens on Check meanwhile,
   *  and falls back to This page if none are found (the part then has nothing in it). */
  claimsComing?: boolean;
  /** The page is an article (claims matter most there). */
  article: boolean;
  /** Things the page asks of the reader (r3-09). */
  actions: number;
  /** The things to do are still being read. */
  actionsComing?: boolean;
  /** A form or a letter (PageKind). */
  formOrLetter: boolean;
}

/** The part with the most to say: Check when claims were found on an article; Do on a form or letter with things to
 *  do; otherwise This page. */
export function defaultPart(s: PartSignals): Part {
  if (s.article && (s.claims > 0 || s.claimsComing)) return "check";
  if (s.formOrLetter && (s.actions > 0 || s.actionsComing)) return "do";
  return "page";
}

/**
 * The part to show: the person's last choice on this site when that part has something in it, else the default when it
 * has, else the first part with something in it (What was removed always has: its count and the Distill links).
 */
export function pickPart(filled: readonly Part[], preferred: Part, remembered?: Part | null): Part {
  if (remembered && filled.includes(remembered)) return remembered;
  if (filled.includes(preferred)) return preferred;
  return PARTS.find((p) => filled.includes(p)) ?? "removed";
}

/** The next tab for a key on the tab row (arrows wrap; Home and End go to the ends), or null for any other key. */
export function nextTab(filled: readonly Part[], current: Part, key: string): Part | null {
  if (!filled.length) return null;
  const i = Math.max(0, filled.indexOf(current));
  switch (key) {
    case "ArrowRight": return filled[(i + 1) % filled.length] ?? null;
    case "ArrowLeft": return filled[(i - 1 + filled.length) % filled.length] ?? null;
    case "Home": return filled[0] ?? null;
    case "End": return filled[filled.length - 1] ?? null;
    default: return null;
  }
}

export const PARTS_KEY = "distill:moreParts";

/** The stored choices, keeping only well-formed ones (an http(s) origin, a known part). */
export function parseChoices(raw: unknown): Record<string, Part> {
  const out: Record<string, Part> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [origin, part] of Object.entries(raw as Record<string, unknown>)) {
    if (/^https?:\/\/[^/]+$/.test(origin) && isPart(part)) out[origin] = part;
  }
  return out;
}

/** The person's last part on this site, or null. */
export async function loadChoice(origin: string): Promise<Part | null> {
  try {
    const got = await chrome.storage.local.get(PARTS_KEY);
    return parseChoices(got[PARTS_KEY])[origin] ?? null;
  } catch { return null; }
}

/** Keeps the person's choice for this site on the device. */
export async function saveChoice(origin: string, part: Part): Promise<void> {
  try {
    const got = await chrome.storage.local.get(PARTS_KEY);
    const all = parseChoices(got[PARTS_KEY]);
    all[origin] = part;
    await chrome.storage.local.set({ [PARTS_KEY]: all });
  } catch { /* storage refused: the choice lasts this visit only */ }
}
