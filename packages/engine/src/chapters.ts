// Round 4, card 6 (r4-06): video chapters and sponsor parts, read from the times a video's description lists
// ("3:15 Omáčka", "1:02:30 Závěr"). Pure: text in, chapters out; nothing is fetched. CONTRACT STUB: the r4-06 builder
// fills it in.

export interface Chapter {
  /** Seconds from the start. */
  start: number;
  /** The description's own words for it. */
  title: string;
  /** The description names this part as a sponsor or an ad ("sponzor", "reklama", "sponsored by"). */
  sponsor?: boolean;
}

/** Chapters in order of time, from a description; empty when it lists fewer than two times. `duration` (seconds)
 *  drops times past the end. */
export function readChapters(_description: string, _duration?: number): Chapter[] {
  return [];
}
