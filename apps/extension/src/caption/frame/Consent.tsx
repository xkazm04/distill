// Round 3, card r3-04: cookie banners answered for you. The page side presses a banner's reject button after Clean
// (caption/consent.ts, hooked into page.ts); this section says what happened on this page and holds the switch, kept on
// this device (chrome.storage.local): for this site, and for every site. On by default. No AI.
import { useEffect, useState } from "react";
import type { CleanReport, ConsentOutcome } from "../../messages";
import { consentWanted, loadConsentPrefs, saveConsentPrefs, type ConsentPrefs } from "../consent";
import { siteName, siteOrigin } from "../sites";
import { Note, Section, Switch } from "./kit";
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
    <Section id="cap-consent-h" title="Cookie banners" testid="cap-consent-section" className="k-switches">
      <Switch checked={here} disabled={busy} onChange={(on) => void setHere(on)} testid="cap-consent"
        label={`Reject cookies for me${origin ? ` on ${siteName(origin)}` : ""}`}
        title={'Distill presses the banner\'s own "Reject all" or "Only necessary". Never Accept.'} />
      {origin && <Switch checked={everywhere} disabled={busy} onChange={(on) => void setEverywhere(on)} label="On every site" testid="cap-consent-all" />}
      {outcome && <Note testid="cap-consent-note" attrs={{ "data-outcome": outcome }}>{WHAT[outcome]}</Note>}
      <Note>Kept on this device only. Distill never presses Accept.</Note>
    </Section>
  );
}
