// Round 5, r5-03: the strip's first line as a short sentence plus small chips. The sentence says the most important
// thing ("Cleaned · in English"); every other fact is a chip with a number that opens More on its part. The full status
// text (status.ts) stays in the status element for screen readers and the e2e specs; this is what the eye reads.
// Pure: tested in lineParts.test.ts.
import { bylineAgo, bylineDay, type Byline } from "@distill/engine";
import type { CleanReport } from "../../messages";
import type { Part } from "./parts";
import type { PlainState } from "./Plain";
import { langName } from "./status";
import type { TranslateState } from "./Translate";

/** The sentence, and the shorter one used first when the line runs out of room (a phone). */
export interface Sentence { long: string; short: string }

/** One fact as a chip: its words (a number first where there is one), the part of More it opens, a longer title. */
export interface FactChip { id: string; text: string; part: Part; title: string }

export interface LineInput {
  report: CleanReport | null;
  problem?: string | null;
  translate: Pick<TranslateState, "phase" | "from" | "to" | "problem" | "showingSource">;
  plain: Pick<PlainState, "phase">;
  claims: number;
  actions: number;
  byline: Byline | null;
  now?: Date;
  /** The reader's language ("en"). */
  reader?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const primary = (lang: string): string => lang.split("-")[0]?.toLowerCase() || "und";

/** The sentence: what matters most on this page now. */
export function sentence(i: LineInput): Sentence {
  if (i.problem) return { long: i.problem, short: "Something went wrong" };
  const r = i.report;
  if (!r) return { long: "Cleaning the page...", short: "Cleaning..." };
  const t = i.translate;
  const from = langName(t.from ?? primary(r.lang));
  const reader = langName(t.to ?? i.reader ?? "en");
  const cleaned = r.items.length > 0;
  const onlyCookies = r.consent === "rejected" && r.items.every((it) => it.kind === "cookie");
  if (i.plain.phase === "working") return { long: "Rewriting in plain words...", short: "Rewriting..." };
  if (i.plain.phase === "on") return { long: "Showing plain words", short: "Plain words" };
  if (i.plain.phase === "failed") return { long: "Not rewritten in plain words", short: "Not rewritten" };
  if (t.phase === "translating") return { long: `Translating from ${from}...`, short: "Translating..." };
  if (t.phase === "failed") return { long: `Not translated from ${from}`, short: "Not translated" };
  if (t.phase === "done" && !t.showingSource) return cleaned ? { long: `Cleaned · in ${reader}`, short: `In ${reader}` } : { long: `In ${reader} · nothing to remove`, short: `In ${reader}` };
  if (onlyCookies) return { long: "Cookies rejected · nothing else to remove", short: "Cookies rejected" };
  const lang = primary(r.lang);
  const foreign = lang !== "und" && lang !== primary(i.reader ?? "en");
  if (foreign) return cleaned ? { long: `Cleaned · page in ${langName(lang)}`, short: "Cleaned" } : { long: `Page in ${langName(lang)} · nothing to remove`, short: `In ${langName(lang)}` };
  return cleaned ? { long: "Page cleaned", short: "Cleaned" } : { long: "Nothing to remove", short: "Nothing to remove" };
}

/** The chips, in the order they fold from the end: removed, claims, to do, the date, cookies, paused videos. */
export function chips(i: LineInput): FactChip[] {
  const r = i.report;
  if (!r || i.problem) return [];
  const out: FactChip[] = [];
  const removed = r.items.length - r.restored.length;
  const onlyCookies = r.consent === "rejected" && r.items.every((it) => it.kind === "cookie");
  if (removed > 0 && !onlyCookies) {
    const back = r.restored.length ? `, ${r.restored.length} shown again` : "";
    out.push({ id: "removed", text: `${removed} removed`, part: "removed", title: `${plural(removed, "distraction", "distractions")} removed${back}. Open What was removed.` });
  }
  if (i.claims > 0) out.push({ id: "claims", text: plural(i.claims, "claim", "claims"), part: "check", title: `${plural(i.claims, "claim", "claims")} to check. Open Check.` });
  if (i.actions > 0) out.push({ id: "actions", text: `${i.actions} to do`, part: "do", title: `${plural(i.actions, "thing", "things")} this page asks of you. Open Do.` });
  const date = dateChip(i.byline, i.now ?? new Date());
  if (date) out.push(date);
  if (r.consent === "rejected" && !onlyCookies) out.push({ id: "cookies", text: "cookies rejected", part: "settings", title: "The cookie banner's own reject button was pressed for you. Open Settings." });
  if (r.calm.media) out.push({ id: "videos", text: `paused ${plural(r.calm.media, "video", "videos")}`, part: "settings", title: `${plural(r.calm.media, "video", "videos")} paused. Open Settings.` });
  return out;
}

/** "published 3 years ago", when the page was updated well after it was published (the byline's own rule). */
function dateChip(b: Byline | null, now: Date): FactChip | null {
  if (!b?.published || !b.updated) return null;
  const p = bylineDay(b.published);
  const u = bylineDay(b.updated);
  if (p === undefined || u === undefined || u - p <= 7) return null;
  return { id: "date", text: `published ${bylineAgo(p, now)}`, part: "page", title: `Published ${bylineAgo(p, now)}, updated ${bylineAgo(u, now)}. Open This page.` };
}

/** Widths measured in the strip (px). */
export interface LineWidths { long: number; short: number; chips: number[]; plus: number; gap: number }

/**
 * What fits in `room` px, a chip shown whole or folded into "+n", never cut. First the long sentence with every chip.
 * On a phone the sentence shortens first (short with every chip, then short with fewer). On a wide strip the
 * sentence is worth more than the last chips: they fold first while the long sentence keeps at least one chip beside
 * it; only then does it shorten.
 */
export function fit(room: number, w: LineWidths, phone = false): { short: boolean; shown: number } {
  const n = w.chips.length;
  const row = (sentenceW: number, k: number) =>
    sentenceW + w.chips.slice(0, k).reduce((s, c) => s + c + w.gap, 0) + (k < n ? w.plus + w.gap : 0);
  if (row(w.long, n) <= room) return { short: false, shown: n };
  if (!phone) for (let k = n - 1; k > 0; k--) if (row(w.long, k) <= room) return { short: false, shown: k };
  if (row(w.short, n) <= room) return { short: true, shown: n };
  for (let k = n - 1; k > 0; k--) if (row(w.short, k) <= room) return { short: true, shown: k };
  return { short: true, shown: 0 };
}
