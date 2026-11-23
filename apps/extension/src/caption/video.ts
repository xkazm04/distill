// Round 4, card 6 (r4-06): the page's main video, its description's chapters (engine readChapters), and seeking.
// Reads the page's own words only: the description's text as it stands (on YouTube the collapsed description already
// holds all of it, so "more" is never clicked) and the player's time. Nothing is fetched, nothing on the page changes
// except the player's position when the person picks a chapter or presses Skip.
import { readChapters } from "@distill/engine";
import type { VideoInfo } from "../messages";

const HIDE = "data-distill-hide";
/** The players a site names as its main one, best first. */
const MAIN_PLAYER = ["#movie_player video", "video.html5-main-video", "[itemprop=video] video", "main video", "article video"];
/** Where a site keeps the description, best first. YouTube: the inline expander (its text is all there, folded by CSS). */
const DESCRIPTION = [
  "ytd-watch-metadata ytd-text-inline-expander",
  "#description-inline-expander",
  "ytd-watch-metadata #description",
  "#description",
  "[itemprop=description]",
  ".video-description",
  ".description",
  "[data-description]",
];

const area = (v: HTMLVideoElement): number => {
  const r = v.getBoundingClientRect();
  return r.width * r.height;
};

/** The page's main video: the one the site names as its player, else the largest one shown. */
export function mainVideo(doc: Document): HTMLVideoElement | null {
  for (const sel of MAIN_PLAYER) {
    const v = doc.querySelector<HTMLVideoElement>(sel);
    if (v && !v.closest(`[${HIDE}]`)) return v;
  }
  const all = Array.from(doc.querySelectorAll("video")).filter((v) => !v.closest(`[${HIDE}]`));
  if (all.length <= 1) return all[0] ?? null;
  return all.reduce((best, v) => (area(v) > area(best) ? v : best));
}

/** The text of an element with its line breaks: <br> and block ends count as new lines (textContent alone joins them). */
export function textWithLines(el: Element): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { out.push(n.nodeValue ?? ""); return; }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const tag = e.localName;
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") return;
    if (tag === "br") { out.push("\n"); return; }
    const block = /^(?:p|div|li|dt|dd|h[1-6]|tr|section|article|blockquote|pre|ul|ol|table)$/.test(tag);
    if (block) out.push("\n");
    for (const c of Array.from(e.childNodes)) walk(c);
    if (block) out.push("\n");
  };
  walk(el);
  return out.join("").replace(/\n{3,}/g, "\n\n");
}

/** YouTube, folded: the watch page's DOM holds only the first lines of the description ("…více"). The whole of it is in
 *  the page itself, in the player data the page was served with (an inline <script>, `"shortDescription"`). It is read
 *  from the DOM as text, never run and never fetched, and only while that data is for the video in the address bar
 *  (YouTube moves between videos without loading a page, and the script stays as it was). Cached per address. */
let served: { url: string; text: string } | null = null;
export function servedDescription(doc: Document): string {
  const url = doc.location?.href ?? "";
  if (served?.url === url) return served.text;
  let text = "";
  const id = /[?&]v=([\w-]{6,})/.exec(url)?.[1];
  if (id) {
    for (const s of Array.from(doc.querySelectorAll("script:not([src])"))) {
      const t = s.textContent ?? "";
      if (!t.includes("ytInitialPlayerResponse")) continue;
      const vid = /"videoDetails":\{[^}]*?"videoId":"([\w-]+)"/.exec(t)?.[1];
      const m = /"shortDescription":("(?:[^"\\]|\\.)*")/.exec(t);
      if (vid !== id || !m) continue;
      try { text = String(JSON.parse(m[1] as string)); } catch { text = ""; }
      break;
    }
  }
  served = { url, text };
  return text;
}

/** The description's text: the whole one the page was served with (YouTube), else the longest of the places a site
 *  keeps it on the page. */
export function descriptionText(doc: Document): string {
  const whole = servedDescription(doc);
  if (whole) return whole;
  let best = "";
  for (const sel of DESCRIPTION) {
    for (const el of Array.from(doc.querySelectorAll(sel)).slice(0, 4)) {
      if (el.closest(`[${HIDE}]`) && !el.closest("ytd-watch-metadata")) continue;
      const t = textWithLines(el);
      if (t.length > best.length) best = t;
    }
  }
  return best;
}

/** The site plays its own advert in the player now (YouTube marks the player), so its time is not the video's. */
const advertPlaying = (v: HTMLVideoElement): boolean => !!v.closest(".ad-showing, .ad-interrupting");

/** Cache of the last description read, so a poll each second does not parse it again when nothing changed. */
let last: { text: string; duration: number | undefined; chapters: VideoInfo["chapters"] } | null = null;

/** The main video's chapters and sponsor parts from its description, its length and where it is now; null when the
 *  page has no video, or its description lists no chapters. */
export function readVideo(doc: Document): VideoInfo | null {
  const video = mainVideo(doc);
  if (!video) return null;
  const ad = advertPlaying(video);
  const d = video.duration;
  const duration = !ad && Number.isFinite(d) && d > 0 ? d : undefined;
  const text = descriptionText(doc);
  if (!last || last.text !== text || last.duration !== duration) last = { text, duration, chapters: readChapters(text, duration) };
  if (!last.chapters.length) return null;
  const info: VideoInfo = { chapters: last.chapters };
  if (duration !== undefined) info.duration = duration;
  if (!ad && Number.isFinite(video.currentTime)) info.currentTime = video.currentTime;
  return info;
}

/** Moves the main video to `seconds`. False when there is no video, or the time is not a time. */
export function seek(doc: Document, seconds: number): boolean {
  const video = mainVideo(doc);
  if (!video || !Number.isFinite(seconds) || seconds < 0) return false;
  if (advertPlaying(video)) return false;
  const d = video.duration;
  video.currentTime = Number.isFinite(d) && d > 0 ? Math.min(seconds, Math.max(0, d - 0.25)) : seconds;
  return true;
}
