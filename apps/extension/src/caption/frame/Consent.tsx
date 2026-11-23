// Round 3, card r3-04: cookie banners answered for you. The page side presses a banner's reject button after Clean
// (caption/consent.ts, hooked into page.ts); this section says what happened on this page and holds the switch, kept on
// this device (chrome.storage.local): for this site, and for every site. On by default. No AI.
import { useEffect, useState } from "react";
import type { CleanReport, ConsentOutcome } from "../../messages";
import { consentWanted, loadConsentPrefs, saveConsentPrefs, type ConsentPrefs } from "../consent";
import { siteName, siteOrigin } from "../sites";
import { send } from "./send";

const WHAT: Record<ConsentOutcome, string> = {
  rejected: "Distill pressed the cookie banner's own reject button on this page. Only the cookies the site needs are allowed.",
  hidden: "The cookie banner had no button that rejects everything, so Distill only hid it. Nothing was pressed.",
  none: "No cookie banner on this page.",
  off: "Off here: cookie banners are only hidden, never answered.",
};

export function ConsentSection(props: { report: CleanReport; setReport: (r: CleanReport) => void }) {
  const { report, setReport } = props;
  const [origin, setOrigin] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ConsentPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [info, kept] = await Promise.all([
        send<"distill:caption:pageInfo">({ type: "distill:caption:pageInfo" }).catch(() => null),
        loadConsentPrefs(),
      ]);
      if (!live) return;
      setOrigin(siteOrigin(info?.url));
      setPrefs(kept);
    })();
    return () => { live = false; };
  }, []);

  if (!prefs) return null;
  const here = consentWanted(prefs, origin);
  const everywhere = prefs.on ?? true;

  /** Keep the choice, then tell the page (switching on answers a banner still waiting; off only hides). */
  const change = async (next: ConsentPrefs) => {
    setBusy(true);
    try {
      await saveConsentPrefs(next);
      setPrefs(next);
      const { consent } = await send<"distill:caption:consent">({ type: "distill:caption:consent", on: consentWanted(next, origin) });
      setReport({ ...report, consent });
    } finally {
      setBusy(false);
    }
  };
  const setHere = (on: boolean) => {
    if (!origin) return change({ ...prefs, on });
    const sites = { ...prefs.sites };
    // The same as every site: no choice of its own is kept.
    if (on === everywhere) delete sites[origin]; else sites[origin] = on;
    return change({ ...prefs, sites });
  };
  const setEverywhere = (on: boolean) => change({ ...prefs, on });

  const outcome = report.consent;
  return (
    <section aria-labelledby="cap-consent-h" data-testid="cap-consent-section">
      <h2 id="cap-consent-h">Cookie banners</h2>
      <label className="switch" title="Distill presses the banner's own &quot;Reject all&quot; or &quot;Only necessary&quot;. Never Accept.">
        <input type="checkbox" role="switch" checked={here} disabled={busy} onChange={(e) => void setHere(e.currentTarget.checked)}
          data-testid="cap-consent" />
        <span>Reject cookies for me{origin ? ` on ${siteName(origin)}` : ""}</span>
      </label>
      {origin && (
        <label className="switch">
          <input type="checkbox" role="switch" checked={everywhere} disabled={busy} onChange={(e) => void setEverywhere(e.currentTarget.checked)}
            data-testid="cap-consent-all" />
          <span>On every site</span>
        </label>
      )}
      {outcome && <p className="note" data-testid="cap-consent-note" data-outcome={outcome}>{WHAT[outcome]}</p>}
      <p className="note">Kept on this device only. Distill never presses Accept.</p>
    </section>
  );
}
