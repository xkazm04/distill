// r2-08 Remember this site: the sites where Distill opens by itself, and what the person chose on each, kept in
// chrome.storage.local (this device only; never synced, never sent). Shared by the service worker (does this load open
// the caption?) and the strip's frame (switch, Forget, the choices re-applied). The pure functions are tested in
// sites.test.ts; the chrome.* wrappers are thin.
import type { ClutterItem } from "@distill/engine";
import type { CleanReport } from "../messages";

export const SITES_KEY = "distill:sites";

/** A removed item the person showed again, matched on the next load by kind and label (ids change every load). */
export interface ShownItem { kind: ClutterItem["kind"]; label: string }

/** What the person chose on a remembered site. Absent: nothing chosen, Distill's default. */
export interface SitePrefs {
  /** Items brought back from "What was removed", one entry per item (two adverts shown again: two entries). */
  shown: ShownItem[];
  /** "source": the person chose "Keep <language>"; "translated": they kept the translation (Translate's default). */
  translate?: "source" | "translated";
  /** Easier to read on (Clean's default when the page needs it) or off. */
  comfort?: boolean;
}

export interface SiteEntry {
  /** When the person switched "Always clean this site" on (ms since epoch). */
  since: number;
  prefs: SitePrefs;
  /** Distill asked Chrome for this site itself (Forget gives it back). False when the site was already allowed (the
   *  side panel's "Read this page"), so Forget leaves that grant alone. */
  asked: boolean;
}

export type Sites = Record<string, SiteEntry>;

/** The origin Distill may remember: an http(s) page's origin, else null (file:, chrome:, data: never). */
export function siteOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** The one host permission pattern for a site: `https://example.org/*`. Never `<all_urls>`. */
export const originPattern = (origin: string): string => `${origin}/*`;

/** The site as the person reads it: "www.example.org". */
export const siteName = (origin: string): string => {
  try { return new URL(origin).host; } catch { return origin; }
};

/** Reads whatever is stored, keeping only well-formed entries (storage is shared with older builds). */
export function parseSites(raw: unknown): Sites {
  const out: Sites = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [origin, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Partial<SiteEntry> | null;
    if (!e || typeof e !== "object" || typeof e.since !== "number" || siteOrigin(origin) !== origin) continue;
    const p = (e.prefs ?? {}) as Partial<SitePrefs>;
    const prefs: SitePrefs = {
      shown: Array.isArray(p.shown) ? p.shown.filter((s): s is ShownItem => !!s && typeof s.kind === "string" && typeof s.label === "string").map((s) => ({ kind: s.kind, label: s.label })) : [],
    };
    if (p.translate === "source" || p.translate === "translated") prefs.translate = p.translate;
    if (typeof p.comfort === "boolean") prefs.comfort = p.comfort;
    out[origin] = { since: e.since, prefs, asked: e.asked !== false };
  }
  return out;
}

/** The items of this report the person showed again, as kept for the next load. */
export function shownOf(report: Pick<CleanReport, "items" | "restored">): ShownItem[] {
  const back = new Set(report.restored);
  return report.items.filter((it) => back.has(it.id)).map((it) => ({ kind: it.kind, label: it.label }));
}

/** The ids of this load's items to show again: each kept item matches the first not yet matched item of the same kind
 *  and label, in page order. A kept item that is not on the page this time is skipped. */
export function idsToShow(items: readonly ClutterItem[], shown: readonly ShownItem[]): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (const s of shown) {
    const it = items.find((i) => !used.has(i.id) && i.kind === s.kind && i.label === s.label);
    if (!it) continue;
    used.add(it.id);
    out.push(it.id);
  }
  return out;
}

export function samePrefs(a: SitePrefs, b: SitePrefs): boolean {
  return a.translate === b.translate && a.comfort === b.comfort && a.shown.length === b.shown.length
    && a.shown.every((s, i) => s.kind === b.shown[i]?.kind && s.label === b.shown[i]?.label);
}

/** The choices as the strip shows them now, to keep for the next load. `comfortKnown`: the page needed the reading
 *  layer at some point while the strip was open (else its 0 says nothing about a choice). Translate counts once done;
 *  before that the stored choice stays. */
export function prefsNow(
  stored: SitePrefs, report: Pick<CleanReport, "items" | "restored" | "comfort">,
  opts: { comfortKnown: boolean; translate?: { phase: string; showingSource: boolean } },
): SitePrefs {
  // A kept item this page does not have (another article without comments) stays kept for the pages that do.
  const absent: ShownItem[] = [];
  const used = new Set<string>();
  for (const s of stored.shown) {
    const it = report.items.find((i) => !used.has(i.id) && i.kind === s.kind && i.label === s.label);
    if (it) used.add(it.id); else absent.push(s);
  }
  const out: SitePrefs = { shown: [...shownOf(report), ...absent] };
  const t = opts.translate?.phase === "done" ? (opts.translate.showingSource ? "source" : "translated") : stored.translate;
  if (t) out.translate = t;
  const c = opts.comfortKnown ? report.comfort > 0 : stored.comfort;
  if (c !== undefined) out.comfort = c;
  return out;
}

/** What More lists under the switch: each kept choice in a few words. */
export function describePrefs(prefs: SitePrefs, langName: (lang: string) => string, pageLang?: string): string[] {
  const out: string[] = [];
  if (prefs.shown.length) out.push(`Shown again: ${prefs.shown.map((s) => s.label).join(", ")}`);
  if (prefs.translate === "source") out.push(`Kept in ${pageLang ? langName(pageLang) : "its own language"}, not translated`);
  if (prefs.translate === "translated") out.push("Translated");
  if (prefs.comfort === false) out.push("Easier to read: off");
  if (prefs.comfort === true) out.push("Easier to read: on");
  return out;
}

/** The service worker's decision for one tab update: open the caption by itself on this load? Pure: the caller has
 *  read the stored sites and asked Chrome whether the site's permission is still held. */
export interface AutoOpenInput {
  /** tabs.onUpdated changeInfo.status. */
  status?: string;
  /** The tab's URL: Chrome shows it only for a site Distill holds a permission for. */
  url?: string;
  sites: Sites;
  /** chrome.permissions.contains for the site's pattern (the permission actually granted). */
  granted: boolean;
}

export function autoOpenOrigin(i: Omit<AutoOpenInput, "granted">): string | null {
  if (i.status !== "complete") return null;
  const origin = siteOrigin(i.url);
  return origin && i.sites[origin] ? origin : null;
}

export function shouldAutoOpen(i: AutoOpenInput): boolean {
  return autoOpenOrigin(i) !== null && i.granted;
}

/** The sites left once Chrome took these origin patterns back (chrome.permissions.onRemoved). `<all_urls>` or a wider
 *  pattern taken back drops every site it covered. */
export function withoutRemoved(sites: Sites, removedPatterns: readonly string[]): Sites {
  const covers = (pattern: string, origin: string): boolean => {
    if (pattern === "<all_urls>" || pattern === "*://*/*") return true;
    if (pattern === originPattern(origin)) return true;
    const m = /^(\*|https?):\/\/(\*\.)?([^/]*)\/\*$/.exec(pattern);
    if (!m) return false;
    const u = new URL(origin);
    const scheme = m[1] === "*" || `${m[1]}:` === u.protocol;
    const host = m[3] === "*" || (m[2] ? u.hostname === m[3] || u.hostname.endsWith(`.${m[3]}`) : u.host === m[3] || u.hostname === m[3]);
    return scheme && host;
  };
  const out: Sites = {};
  for (const [origin, e] of Object.entries(sites)) if (!removedPatterns.some((p) => covers(p, origin))) out[origin] = e;
  return out;
}

// ---- chrome.storage.local ----------------------------------------------------------------------------------------

export async function loadSites(): Promise<Sites> {
  const got = await chrome.storage.local.get(SITES_KEY);
  return parseSites(got[SITES_KEY]);
}

export async function saveSites(sites: Sites): Promise<void> {
  if (Object.keys(sites).length) await chrome.storage.local.set({ [SITES_KEY]: sites });
  else await chrome.storage.local.remove(SITES_KEY);
}

/** Read, change, write one site (undefined removes it). */
export async function updateSite(origin: string, change: (e: SiteEntry | undefined) => SiteEntry | undefined): Promise<SiteEntry | undefined> {
  const sites = await loadSites();
  const next = change(sites[origin]);
  if (next) sites[origin] = next; else delete sites[origin];
  await saveSites(sites);
  return next;
}
