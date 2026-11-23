// Round 4, card 6 (r4-06): video chapters and sponsor parts, read from the times a video's description lists
// ("3:15 Omáčka", "1:02:30 Závěr"). Pure: text in, chapters out; nothing is fetched.
//
// A chapter is a line of the description that starts (or ends) with a time: "0:00 Úvod", "(3:15) Omáčka",
// "▶ 12:40 - Servírování", "Omáčka - 3:15". Times written inside a sentence ("at 5:20 I add salt") are not chapters.
// The list must start near the beginning (YouTube's own rule is 0:00; a few seconds in is still the start), and its
// times go up. A time that goes back starts nothing: it is skipped, so one stray line does not end the list.

export interface Chapter {
  /** Seconds from the start. */
  start: number;
  /** The description's own words for it. */
  title: string;
  /** The description names this part as a sponsor or an ad ("sponzor", "reklama", "sponsored by"). */
  sponsor?: boolean;
}

/** The first chapter starts at most this many seconds in. */
const START_NEAR = 30;
/** At most this many chapters (a description that lists hundreds of times is a tracklist, still fine, but capped). */
const MAX = 100;

/** "1:02:30", "12:40", "0:05"; minutes and seconds two digits after a colon. */
const TIME = String.raw`(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)`;
/** What may come before a leading time: bullets, arrows, emoji, brackets, spaces. No letters or digits. */
const LEAD = String.raw`^[\s\p{P}\p{S}\p{Extended_Pictographic}‍️]*?`;
const AT_START = new RegExp(`${LEAD}[([]?${TIME}[)\\]]?(?![\\d:])\\s*(.*)$`, "u");
const AT_END = new RegExp(`^(.*?\\p{L}.*?)\\s*[-–—:|•(\\[]?\\s*${TIME}[)\\]]?[\\s\\p{P}]*$`, "u");

/** Words that name a sponsor or an ad, Czech and English, as whole words. */
const SPONSOR = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:sponzor\p{L}*|sponsor\p{L}*|reklam(?!ac)\p{L}*|spoluprác\p{L}*|spoluprac\p{L}*|ad|ads|advert\p{L}*|promo (?:kód|code)|paid promotion)(?![\p{L}\p{N}])`, "iu");

/** Separators between a time and its words: "- Omáčka", ": Omáčka", "| Omáčka". */
const strip = (s: string): string => s.replace(/^[\s\-–—:|•·.)\]]+/u, "").replace(/[\s\-–—:|•·(]+$/u, "").replace(/\s+/g, " ").trim();

function seconds(h: string | undefined, m: string, s: string): number {
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s);
}

/** One line's time and words, or null when the line is not a chapter line. */
function lineChapter(line: string): Chapter | null {
  const t = line.trim();
  if (!t || t.length > 200) return null;
  const a = AT_START.exec(t);
  if (a) {
    // "1:02:30" with hours: minutes under 60. "75:10" without hours is fine (a long video written in minutes).
    if (a[1] !== undefined && Number(a[2]) > 59) return null;
    return { start: seconds(a[1], a[2] as string, a[3] as string), title: strip(a[4] ?? "") };
  }
  const b = AT_END.exec(t);
  if (b) {
    if (b[2] !== undefined && Number(b[3]) > 59) return null;
    return { start: seconds(b[2], b[3] as string, b[4] as string), title: strip(b[1] ?? "") };
  }
  return null;
}

/** Whether a chapter's words name a sponsor or an ad. */
export function isSponsor(title: string): boolean {
  return SPONSOR.test(title);
}

/** Chapters in order of time, from a description; empty when it lists fewer than two times. `duration` (seconds)
 *  drops times past the end. */
export function readChapters(description: string, duration?: number): Chapter[] {
  const out: Chapter[] = [];
  const end = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  for (const line of description.split(/\r?\n|[\u2028\u2029]/u)) {
    const c = lineChapter(line);
    if (!c) continue;
    if (!out.length && c.start > START_NEAR) continue;
    const prev = out[out.length - 1];
    if (prev && c.start <= prev.start) continue;
    if (c.start >= end) continue;
    const ch: Chapter = { start: c.start, title: c.title || `Part ${out.length + 1}` };
    if (isSponsor(c.title)) ch.sponsor = true;
    out.push(ch);
    if (out.length >= MAX) break;
  }
  return out.length >= 2 ? out : [];
}

/** Where chapter `i` ends: the next one's start, or the video's end (Infinity when unknown). */
export function chapterEnd(chapters: readonly Chapter[], i: number, duration?: number): number {
  return chapters[i + 1]?.start ?? (duration !== undefined && Number.isFinite(duration) ? duration : Infinity);
}

/** The chapter playing at `time`, as an index, or -1 before the first. */
export function chapterAt(chapters: readonly Chapter[], time: number): number {
  let at = -1;
  for (let i = 0; i < chapters.length; i++) if ((chapters[i] as Chapter).start <= time) at = i;
  return at;
}

/** "3:15", "1:02:30". */
export function formatTime(total: number): string {
  const t = Math.max(0, Math.floor(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
