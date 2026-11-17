// Per-viewer layout choices of the workspace, kept in this browser only. Storage can be missing or refuse (a private
// window, blocked site data), so every read falls back to the default and every write may silently not happen.

/** Whether the original page is hidden or shown beside Distill ("full" is a moment, never kept). */
export const ORIGINAL_KEY = "distill.original";
/** The share of the width the original takes while it is beside Distill, in percent. */
export const SPLIT_KEY = "distill.split";

export const SPLIT = { min: 25, max: 70, start: 45 } as const;

export type OriginalLayout = "hide" | "beside";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice lasts for this visit */
  }
}

export function readOriginal(): OriginalLayout {
  return read(ORIGINAL_KEY) === "beside" ? "beside" : "hide";
}
export function writeOriginal(v: OriginalLayout): void {
  write(ORIGINAL_KEY, v);
}

export const clampSplit = (n: number): number => Math.min(SPLIT.max, Math.max(SPLIT.min, Math.round(n)));

export function readSplit(): number {
  const n = Number(read(SPLIT_KEY));
  return read(SPLIT_KEY) !== null && Number.isFinite(n) ? clampSplit(n) : SPLIT.start;
}
export function writeSplit(n: number): void {
  write(SPLIT_KEY, String(clampSplit(n)));
}
