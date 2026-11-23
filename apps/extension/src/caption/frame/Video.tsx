// Round 4, card r4-06: video chapters and sponsor parts. The page side reads the times the video's description lists
// (engine readChapters, no AI, nothing fetched); More lists them, each a button that moves the player there, with the
// one playing marked. While a part the description names as a sponsor or an ad plays, the strip's row offers one calm
// "Skip sponsor" button; nothing is skipped without the person pressing it.
import { useEffect, useSyncExternalStore } from "react";
import { chapterAt, chapterEnd, chapterTime } from "@distill/engine";
import type { CleanReport, VideoInfo } from "../../messages";
import { send } from "./send";
import "./video.css";

/** While chapters are known: how often the player's time is read. */
const PLAYING_MS = 1000;
/** While none are known yet (a site fills its description late): how often to look again, and for how long. */
const LOOK_MS = 2000;
const LOOK_FOR_MS = 30_000;
const LOOK_LATE_MS = 10_000;

// One reader for the frame's life, shared by the row and More.
let info: VideoInfo | null = null;
let started = false;
const subs = new Set<() => void>();
const emit = () => { for (const s of subs) s(); };

async function poll(): Promise<void> {
  const next = await send<"distill:caption:video">({ type: "distill:caption:video" }).catch(() => null);
  const same = JSON.stringify(next) === JSON.stringify(info);
  info = next;
  if (!same) emit();
}

function start(): void {
  if (started) return;
  started = true;
  const t0 = Date.now();
  const tick = async () => {
    await poll();
    const wait = info ? PLAYING_MS : Date.now() - t0 < LOOK_FOR_MS ? LOOK_MS : LOOK_LATE_MS;
    setTimeout(() => void tick(), wait);
  };
  void tick();
}

const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
const snapshot = () => info;

/** The video's chapters and where it is, once Clean answered (null on a page without chapters). */
export function useVideo(report: CleanReport | null): VideoInfo | null {
  const ready = report !== null;
  useEffect(() => { if (ready) start(); }, [ready]);
  return useSyncExternalStore(subscribe, snapshot);
}

/** Moves the player and reads it again at once, so the mark follows without waiting for the next poll. */
async function seekTo(seconds: number): Promise<boolean> {
  const { ok } = await send<"distill:caption:seek">({ type: "distill:caption:seek", seconds }).catch(() => ({ ok: false }));
  await poll();
  return ok;
}

/** The sponsor part playing now, with where it ends; null when none plays. */
export function sponsorNow(v: VideoInfo | null): { title: string; end: number } | null {
  if (!v || v.currentTime === undefined) return null;
  const i = chapterAt(v.chapters, v.currentTime);
  const c = v.chapters[i];
  if (!c?.sponsor) return null;
  const end = chapterEnd(v.chapters, i, v.duration);
  if (!Number.isFinite(end) || v.currentTime >= end - 0.5) return null;
  return { title: c.title, end };
}

/** In the strip's row: "Skip sponsor" while a sponsor part plays. */
export function VideoRow(props: { report: CleanReport }) {
  const v = useVideo(props.report);
  const s = sponsorNow(v);
  if (!s) return null;
  return (
    <button type="button" className="btn sm" onClick={() => void seekTo(s.end)} title={`${s.title}: skip to ${chapterTime(s.end)}`}
      data-testid="cap-video-skip">Skip sponsor</button>
  );
}

export function VideoSection(props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const v = useVideo(props.report);
  if (!v?.chapters.length) return null;
  const now = v.currentTime === undefined ? -1 : chapterAt(v.chapters, v.currentTime);
  const sponsors = v.chapters.filter((c) => c.sponsor).length;
  return (
    <section className="video" aria-labelledby="cap-video-h" data-testid="cap-video">
      <h2 id="cap-video-h">Chapters ({v.chapters.length})</h2>
      <ol className="video-list">
        {v.chapters.map((c, i) => (
          <li key={`${c.start}-${i}`} data-testid="cap-chapter" data-start={c.start} data-sponsor={c.sponsor ? "" : undefined}
            aria-current={i === now ? "true" : undefined}>
            <button type="button" className="video-go" onClick={() => void seekTo(c.start)} aria-label={`Play from ${chapterTime(c.start)}: ${c.title}`}>
              <span className="video-time">{chapterTime(c.start)}</span>
              <span className="video-title">{c.title}</span>
            </button>
            {c.sponsor && <span className="video-tag" data-testid="cap-chapter-sponsor">Sponsor</span>}
            {i === now && <span className="video-now">Playing</span>}
          </li>
        ))}
      </ol>
      <p className="note">From the video's description, no AI.{sponsors > 0 ? " A sponsor part offers Skip in the strip while it plays." : ""}</p>
    </section>
  );
}
