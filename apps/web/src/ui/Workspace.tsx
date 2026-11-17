import { useCallback, useEffect, useState } from "react";
import type { PageModel, UserSettingsDoc } from "@distill/engine";
import { isFirebaseConfigured } from "../firebase";
import { DEFAULT_SETTINGS, loadLocalSettings, loadRemoteSettings, saveSettings } from "./data";
import { ConfigNotice, ModelStatus } from "./chips";
import { FocusView } from "./FocusView";
import { HandrailPanel } from "./HandrailPanel";
import { Recast } from "./Recast";
import { Wayfill } from "./Wayfill";
import type { HandrailPort } from "./handrailTypes";
import type { PageHost } from "./host";
import { useLocalModel } from "./useLocalModel";

export type Tab = "focus" | "wayfill" | "recast" | "handrail";

const LANGS: [string, string][] = [
  ["en", "English"], ["cs", "Czech"], ["de", "German"], ["es", "Spanish"], ["fr", "French"], ["pl", "Polish"],
  ["uk", "Ukrainian"], ["vi", "Vietnamese"], ["ar", "Arabic"], ["tr", "Turkish"],
];

interface Props {
  host: PageHost;
  /** Present only where the agent bridge can exist (the extension). */
  handrail?: HandrailPort | null;
  initialTab?: Tab;
  onTab?: (t: Tab) => void;
  /** Extension: the page may change under the panel; bump to re-read it. */
  refreshKey?: number;
}

export function Workspace({ host, handrail, initialTab = "focus", onTab, refreshKey = 0 }: Props) {
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [original, setOriginalState] = useState(false);
  const [page, setPage] = useState<PageModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettingsDoc>(() => loadLocalSettings());
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const model = useLocalModel();

  const setTab = useCallback((t: Tab) => { setTabState(t); onTab?.(t); }, [onTab]);
  useEffect(() => setTabState(initialTab), [initialTab]);

  const setOriginal = useCallback((on: boolean) => {
    setOriginalState(on);
    void host.showOriginal(on);
  }, [host]);

  useEffect(() => {
    let live = true;
    setPage(null);
    setError(null);
    host.getPage().then(
      (p) => live && setPage(p),
      (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not read this page."),
    );
    return () => { live = false; };
  }, [host, refreshKey]);

  // Settings: device copy first (instant), then the Firestore copy when there is one.
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    loadRemoteSettings().then((s) => s && setSettings(s)).catch(() => undefined);
  }, []);
  const changeSettings = (s: UserSettingsDoc) => { setSettings(s); void saveSettings(s).catch(() => undefined); };

  const focus = page ? (
    <FocusView page={page} settings={settings} onSettings={changeSettings} scrollToBlock={scrollTo} />
  ) : null;

  const tabs: { id: Tab; label: string }[] = [
    { id: "focus", label: "Read" },
    { id: "wayfill", label: "Fill a form" },
    { id: "recast", label: "New layout" },
    ...(handrail !== undefined ? [{ id: "handrail" as Tab, label: "Agent" }] : []),
  ];

  return (
    <div className="workspace">
      <header className="ws-head">
        <div className="ws-title">
          <h1>{host.label()}</h1>
          {page && <p className="muted">Language: {page.lang}. {page.blocks.length} blocks read.</p>}
        </div>
        <div className="ws-controls">
          <button type="button" role="switch" aria-checked={original} className={`switch ${original ? "on" : ""}`}
            onClick={() => setOriginal(!original)} data-testid="original-switch">
            <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
            Original page
          </button>
          <ModelStatus model={model} />
        </div>
      </header>

      <ConfigNotice />

      <nav aria-label="Views">
        <div role="tablist" className="tabs">
          {tabs.map((t) => (
            <button key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="panel"
              className={tab === t.id ? "tab on" : "tab"} onClick={() => { setOriginal(false); setTab(t.id); }}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="panel" hidden={original}>
        {error && <p className="notice notice-warn" role="alert" data-testid="page-error">{error}</p>}
        {!page && !error && <p role="status">Reading the page...</p>}
        {page && tab === "focus" && focus}
        {page && tab === "wayfill" && (
          <Wayfill host={host} settings={settings} model={model} onShowOriginal={() => setOriginal(true)} />
        )}
        {page && tab === "recast" && (
          <Recast page={page} enabled={settings.recastEnabled} fallback={focus}
            onSource={(id) => { setScrollTo(id); setTab("focus"); }} />
        )}
        {tab === "handrail" && handrail !== undefined && <HandrailPanel host={host} port={handrail} />}
        {page && <Settings settings={settings} onChange={changeSettings} />}
      </div>

      {/* Web: the original page, always mounted so typed values survive a switch. Extension: the tab itself. */}
      {host.originalPane?.(original)}
      {original && !host.originalPane && (
        <div className="panel" data-testid="original-note">
          <p>You are looking at the original page, exactly as it is. Nothing here has been changed except the fields you filled in.</p>
          <button type="button" className="btn btn-primary" onClick={() => setOriginal(false)}>Back to Distill</button>
        </div>
      )}
    </div>
  );
}

function Settings({ settings, onChange }: { settings: UserSettingsDoc; onChange: (s: UserSettingsDoc) => void }) {
  return (
    <details className="settings">
      <summary>Settings</summary>
      <label>
        I read in
        <select value={settings.readerLang} onChange={(e) => onChange({ ...settings, readerLang: e.target.value })}>
          {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label className="choice">
        <input type="checkbox" checked={settings.recastEnabled} onChange={(e) => onChange({ ...settings, recastEnabled: e.target.checked })} />
        Offer the new layout
      </label>
      <button type="button" className="btn btn-link" onClick={() => onChange(DEFAULT_SETTINGS)}>Reset settings</button>
    </details>
  );
}
