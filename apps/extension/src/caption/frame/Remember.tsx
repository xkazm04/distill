// Spark universal-core round 2, card 8: Always clean this site. Asks Chrome for that one site, keeps the person's
// choices for it on this device, and Forget removes them. No AI.
//
// useRemember runs for the strip's whole life (main.tsx), not only while More is open: on a remembered site it puts the
// kept choices back once Clean answered (items shown again, reading comfort off, "Keep <language>"), then keeps what
// the person changes. The service worker opens the strip by itself on the next load (caption/autoOpen.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import type { CleanReport } from "../../messages";
import { hasSite, removeSite, requestSite } from "../sitePermission";
import { describePrefs, idsToShow, loadSites, parseSites, prefsNow, samePrefs, siteName, siteOrigin, SITES_KEY, updateSite, type SiteEntry } from "../sites";
import { knowComfort } from "./Comfort";
import { send } from "./send";
import { langName } from "./status";
import type { Translate } from "./Translate";

export interface Remember {
  /** The page's origin once known; null on a page Distill cannot remember (not http/https). */
  origin: string | null;
  /** The kept entry: the switch is on. */
  entry: SiteEntry | undefined;
  busy: boolean;
  problem: string | null;
  /** Inside the click: asks Chrome for this site, then keeps it. */
  turnOn(): void;
  forget(): Promise<void>;
}

export function useRemember(report: CleanReport | null, setReport: (r: CleanReport) => void, translate: Translate): Remember {
  const [origin, setOrigin] = useState<string | null>(null);
  const [entry, setEntry] = useState<SiteEntry | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The site's permission was held before the switch was turned on (the side panel's "Read this page"). */
  const heldBefore = useRef(false);
  /** Kept choices put back on this load: "no" -> "running" -> "done". Nothing is kept until then. */
  const applied = useRef<"no" | "running" | "done">("no");
  const keptSource = useRef(false);
  const comfortKnown = useRef(false);

  // The site, and whether it is remembered (also when the service worker drops it: permission removed in Chrome).
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const info = await send<"distill:caption:pageInfo">({ type: "distill:caption:pageInfo" });
        const o = siteOrigin(info.url);
        if (!live) return;
        setOrigin(o);
        if (o) {
          heldBefore.current = await hasSite(o);
          const sites = await loadSites();
          if (live) setEntry(sites[o]);
        }
      } catch { /* no page answer: the section stays hidden */ }
      if (live) setLoaded(true);
    })();
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!origin) return;
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && SITES_KEY in changes) setEntry(parseSites(changes[SITES_KEY]?.newValue)[origin]);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [origin]);

  if (report && report.comfort > 0) comfortKnown.current = true;

  // Put the kept choices back, once, after Clean answered.
  useEffect(() => {
    if (!report || !loaded || applied.current !== "no") return;
    if (!entry) { applied.current = "done"; return; }
    applied.current = "running";
    const prefs = entry.prefs;
    void (async () => {
      let r = report;
      try {
        for (const id of idsToShow(r.items, prefs.shown)) {
          r = await send<"distill:caption:restore">({ type: "distill:caption:restore", id });
        }
        if (prefs.comfort === false && r.comfort > 0) {
          knowComfort(r.comfort);
          const { comfort } = await send<"distill:caption:comfort">({ type: "distill:caption:comfort", on: false });
          r = { ...r, comfort };
        }
        if (r !== report) setReport(r);
      } catch (e) {
        console.warn("[distill] Could not put back what was kept for this site:", e);
      } finally {
        applied.current = "done";
      }
    })();
  }, [report, loaded, entry, setReport]);

  // "Keep <language>" kept: as soon as the translation starts, the page keeps its own words (the translation stays one
  // click away, "Show English"), so the reader never sees the page flip.
  const { state: tstate, keepSource } = translate;
  useEffect(() => {
    // Translate itself held back on this load (r3-10: nothing sent); a translation that starts later is the person's.
    if (tstate.held) keptSource.current = true;
    if (keptSource.current || entry?.prefs.translate !== "source") return;
    if ((tstate.phase === "translating" || tstate.phase === "done") && !tstate.showingSource) {
      keptSource.current = true;
      void keepSource(true).catch(() => undefined);
    }
  }, [entry, tstate.held, tstate.phase, tstate.showingSource, keepSource]);

  // Keep what the person changes while the site is remembered.
  useEffect(() => {
    if (!report || !origin || !entry || applied.current !== "done") return;
    const next = prefsNow(entry.prefs, report, { comfortKnown: comfortKnown.current, translate: tstate });
    if (samePrefs(next, entry.prefs)) return;
    void updateSite(origin, (e) => (e ? { ...e, prefs: next } : e)).catch(() => undefined);
  }, [report, origin, entry, tstate]);

  const turnOn = useCallback(() => {
    if (!origin) return;
    setBusy(true);
    setProblem(null);
    // First thing in the click: Chrome asks the person (a user gesture is needed).
    requestSite(origin).then(async (granted) => {
      if (!granted) { setProblem(`Chrome did not allow it. Distill will not open by itself on ${siteName(origin)}.`); return; }
      const prefs = prefsNow({ shown: [] }, report ?? { items: [], restored: [], comfort: 0 }, { comfortKnown: comfortKnown.current, translate: tstate });
      if (tstate.phase === "done" && tstate.showingSource) keptSource.current = true;
      const kept = await updateSite(origin, () => ({ since: Date.now(), prefs, asked: !heldBefore.current }));
      applied.current = "done";
      setEntry(kept);
    }).catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  }, [origin, report, tstate]);

  const forget = useCallback(async () => {
    if (!origin) return;
    setBusy(true);
    setProblem(null);
    try {
      const was = entry;
      await updateSite(origin, () => undefined);
      setEntry(undefined);
      // Only a permission Distill asked for itself goes back; a site allowed from the side panel stays allowed.
      if (was?.asked !== false) await removeSite(origin);
      heldBefore.current = await hasSite(origin);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [origin, entry]);

  return { origin, entry, busy, problem, turnOn, forget };
}

export function RememberSection(props: { report: CleanReport; remember?: Remember }) {
  const r = props.remember;
  if (!r?.origin) return null;
  const site = siteName(r.origin);
  const on = !!r.entry;
  const kept = r.entry ? describePrefs(r.entry.prefs, langName, props.report.lang) : [];
  return (
    <section aria-labelledby="cap-remember-h" data-testid="cap-remember">
      <h2 id="cap-remember-h">This site</h2>
      <label className="switch">
        <input type="checkbox" role="switch" checked={on} disabled={r.busy} data-testid="cap-remember-switch"
          onChange={(e) => { if (e.currentTarget.checked) r.turnOn(); else void r.forget(); }} />
        <span>Always clean this site</span>
      </label>
      {on ? (
        <>
          <p className="note" data-testid="cap-remember-note">Distill opens by itself on {site}. Kept on this device only.</p>
          {kept.length > 0 && <p className="note" data-testid="cap-remember-kept">Remembered here: {kept.join(" · ")}.</p>}
          <button type="button" className="link" disabled={r.busy} onClick={() => void r.forget()} data-testid="cap-remember-forget">Forget this site</button>
        </>
      ) : (
        <p className="note">Chrome will ask to let Distill open on {site} only.</p>
      )}
      {r.problem && <p className="note" role="alert">{r.problem}</p>}
    </section>
  );
}
