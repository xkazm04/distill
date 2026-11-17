import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { PageModel, UserSettingsDoc } from "@distill/engine";
import { isFirebaseConfigured } from "../firebase";
import { DEFAULT_SETTINGS, loadLocalSettings, loadRemoteSettings, saveSettings } from "./data";
import { ConfigNotice, ModelCard } from "./chips";
import { FocusView } from "./FocusView";
import { HandrailPanel, useHandrail } from "./HandrailPanel";
import { keptSections, Recast } from "./Recast";
import { Wayfill } from "./Wayfill";
import type { HandrailPort } from "./handrailTypes";
import type { GuideStore } from "./guideStore";
import type { LocateTarget, PageHost } from "./host";
import { clampSplit, readOriginal, readSplit, SPLIT, writeOriginal, writeSplit, type OriginalLayout } from "./prefs";
import { useLocalModel } from "./useLocalModel";
import { PageSkeleton } from "./loading";

export type Tab = "focus" | "wayfill" | "recast" | "handrail";
/** Where the original page is: hidden, beside Distill (web, wide screens), or in place of Distill. */
export type OriginalMode = "hide" | "beside" | "full";

/** The main area must be at least this wide (px) for the original to sit beside Distill. */
export const BESIDE_MIN_WIDTH = 1100;

const LANGS: [string, string][] = [
  ["en", "English"], ["cs", "Czech"], ["de", "German"], ["es", "Spanish"], ["fr", "French"], ["pl", "Polish"],
  ["uk", "Ukrainian"], ["vi", "Vietnamese"], ["ar", "Arabic"], ["tr", "Turkish"],
];

const ICONS: Record<Tab, ReactNode> = {
  focus: <path d="M3 5.5C5.5 4.5 8.5 4.5 12 6.5c3.5-2 6.5-2 9-1v13c-2.5-1-5.5-1-9 1-3.5-2-6.5-2-9-1zM12 6.5v13" />,
  wayfill: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  recast: <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />,
  handrail: <path d="M5 12h14M12 5l7 7-7 7" />,
};

interface Props {
  host: PageHost;
  /** Present only where the agent bridge can exist (the extension). */
  handrail?: HandrailPort | null;
  initialTab?: Tab;
  onTab?: (t: Tab) => void;
  /** Extension: the page was loaded again (a reload or a navigation in the tab); bump to read it afresh. */
  refreshKey?: number;
  /** Extension: the page changed in place (its content or its address, without a load); bump to re-read it without
   *  resetting the views. Read refreshes in place; Fill a form keeps its place while the form is the same one. */
  changeKey?: number;
  /** Where the form guide keeps its place and answers, on this device only (see guideStore.ts). */
  guideStore?: GuideStore;
  /** Extension: the helper program (Handrail) needs the person's OK first. Present until it is given; the Agent view
   *  offers it as "Connect your helper program". */
  onConnectHelper?: () => void;
  /** The shell's mark, at the top of the sidebar and of the narrow top bar. Without it: the word "Distill". */
  brand?: ReactNode;
  /** The shell's list of pages (links), under "Pages" in the sidebar. */
  pages?: ReactNode;
  /** The shell's own settings (the web app's light and dark choice), at the foot of the sidebar. */
  footer?: ReactNode;
  /** Where "Home" in the header leads. No Home link without it (the extension has no home page). */
  homeHref?: string;
}

/** True when a key press belongs to a field the person is typing in. */
function inEditable(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return !!el && (!!el.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") || (el as HTMLElement).isContentEditable === true);
}

/** The rendered width of `ref`, kept up to date. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") {
      addEventListener("resize", measure);
      return () => removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function Workspace({ host, handrail, initialTab = "focus", onTab, refreshKey = 0, changeKey = 0, guideStore, onConnectHelper, brand, pages, footer, homeHref }: Props) {
  const [tab, setTabState] = useState<Tab>(initialTab);
  const [page, setPage] = useState<PageModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettingsDoc>(() => loadLocalSettings());
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const [steps, setSteps] = useState<number | null>(null);
  const [sections, setSections] = useState<number | null>(null);
  const [drawer, setDrawer] = useState(false);
  const model = useLocalModel();
  // The agent bridge lives as long as the Workspace: requests are answered and proposals kept whichever tab is open.
  const agent = useHandrail(handrail, host);
  // Once the person opens "Fill a form" for this page, the guide stays mounted (hidden on other tabs), so its step and
  // answers survive a tab switch and the agent can read and move it from any tab. A new page starts closed again.
  const [wayfillHost, setWayfillHost] = useState<PageHost | null>(null);
  useEffect(() => { if (tab === "wayfill") setWayfillHost(host); }, [tab, host]);
  const keepWayfill = tab === "wayfill" || wayfillHost === host;

  // ---- the original page: hidden, beside, or full ------------------------------------------------------------------
  const mainRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mainWidth = useWidth(mainRef);
  const canBeside = !!host.originalPane && mainWidth >= BESIDE_MIN_WIDTH;
  // The person's kept choice; without one, Fill a form opens with the original beside (where it is possible) and the
  // other views without it.
  const [choice, setChoice] = useState<OriginalLayout | null>(() => readOriginal());
  const layout: OriginalLayout = choice ?? (tab === "wayfill" ? "beside" : "hide");
  const [full, setFull] = useState(false);
  const [split, setSplit] = useState<number>(() => readSplit());
  const [dragging, setDragging] = useState(false);
  const mode: OriginalMode = full ? "full" : layout === "beside" && canBeside ? "beside" : "hide";
  const beside = mode === "beside";

  const chooseOriginal = useCallback((m: OriginalMode) => {
    if (m === "full") setFull(true);
    else {
      setFull(false);
      setChoice(m);
      writeOriginal(m);
    }
  }, []);
  /** The one "show me the original" action of the views: beside Distill when it fits, instead of it otherwise. A host
   *  without a pane (the extension) has nothing to show: the tab beside the panel is the original. */
  const showOriginal = useCallback(() => {
    if (!host.originalPane) return;
    if (canBeside) { setFull(false); setChoice("beside"); } else setFull(true);
  }, [canBeside, host]);
  useEffect(() => { void host.showOriginal(mode !== "hide"); }, [host, mode]);

  const setTab = useCallback((t: Tab) => { setTabState(t); onTab?.(t); }, [onTab]);
  useEffect(() => setTabState(initialTab), [initialTab]);
  /** Choosing a view always shows Distill again (the original stays beside it when it was). */
  const pick = useCallback((t: Tab) => { setFull(false); setDrawer(false); setTab(t); }, [setTab]);

  // ---- pointing at the source in the original: while it is beside, or always where the tab itself is beside -------
  const pointable = beside || (!host.originalPane && !!host.locate);
  const locate = useCallback((t: LocateTarget | null) => {
    if (pointable && host.locate) void host.locate(t).catch(() => undefined);
  }, [pointable, host]);
  const stepFields = useRef<string[]>([]);
  const onStep = useCallback((ids: string[]) => {
    stepFields.current = ids;
    if (pointable && tab === "wayfill") locate(ids.length ? { fieldIds: ids } : null);
  }, [pointable, tab, locate]);
  useEffect(() => {
    if (!pointable) return;
    locate(tab === "wayfill" && stepFields.current.length ? { fieldIds: stepFields.current } : null);
  }, [pointable, tab, locate]);
  const wasPointable = useRef(false);
  useEffect(() => {
    if (wasPointable.current && !pointable) void host.locate?.(null).catch(() => undefined);
    wasPointable.current = pointable;
  }, [pointable, host]);

  useEffect(() => {
    let live = true;
    setPage(null);
    setError(null);
    setSteps(null);
    setDrawer(false);
    host.getPage().then(
      (p) => { if (!live) return; setPage(p); setSections(keptSections(p)); },
      (e: unknown) => live && setError(e instanceof Error ? e.message : "Could not read this page."),
    );
    return () => { live = false; };
  }, [host, refreshKey]);

  // The page changed in place: read it again and show the new reading where the old one was, with no skeleton and no
  // reset. An identical reading changes nothing (no new AI call); a failed one keeps what is on screen.
  const seenChange = useRef(changeKey);
  useEffect(() => {
    if (seenChange.current === changeKey) return;
    seenChange.current = changeKey;
    let live = true;
    host.getPage().then(
      (p) => {
        if (!live) return;
        setPage((old) => (old && JSON.stringify(old) === JSON.stringify(p) ? old : p));
        setSections(keptSections(p));
        setError(null);
      },
      () => undefined,
    );
    return () => { live = false; };
  }, [host, changeKey]);

  // Settings: device copy first (instant), then the Firestore copy when there is one.
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    loadRemoteSettings().then((s) => s && setSettings(s)).catch(() => undefined);
  }, []);
  const changeSettings = (s: UserSettingsDoc) => { setSettings(s); void saveSettings(s).catch(() => undefined); };

  const waiting = handrail !== undefined && tab !== "handrail" ? agent.pending.length : 0;
  const views: { id: Tab; label: string; sub?: string }[] = [
    { id: "focus", label: "Read", sub: page ? `${page.blocks.length} ${page.blocks.length === 1 ? "block" : "blocks"}` : undefined },
    {
      id: "wayfill", label: "Fill a form",
      sub: steps !== null ? (steps ? `${steps} ${steps === 1 ? "step" : "steps"}` : "No form on this page") : page ? (page.formCount ? "A form is on this page" : "No form on this page") : undefined,
    },
    {
      id: "recast", label: "New layout",
      sub: !settings.recastEnabled ? "Switched off" : sections !== null ? `${sections} ${sections === 1 ? "section" : "sections"}` : "Made when you open it",
    },
    ...(handrail !== undefined ? [{ id: "handrail" as Tab, label: "Agent", sub: agent.connected ? "Connected" : "Not connected" }] : []),
  ];

  // Keys 1-4 switch views, except while the person is typing in a field.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || inEditable(e.target)) return;
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
      const v = views[n - 1];
      if (!v) return;
      e.preventDefault();
      pick(v.id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // ---- the narrow drawer -----------------------------------------------------------------------------------------
  const sideId = useId();
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback(() => { setDrawer(false); menuRef.current?.focus(); }, []);
  useEffect(() => {
    if (!drawer) return;
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); closeDrawer(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer, closeDrawer]);

  // ---- the divider between the original and Distill --------------------------------------------------------------
  const changeSplit = (n: number) => { const v = clampSplit(n); setSplit(v); writeSplit(v); };
  const onDividerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const by: Record<string, number> = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step };
    if (e.key in by) changeSplit(split + (by[e.key] as number));
    else if (e.key === "Home") changeSplit(SPLIT.min);
    else if (e.key === "End") changeSplit(SPLIT.max);
    else if (e.key === "Enter") changeSplit(SPLIT.start);
    else return;
    e.preventDefault();
  };
  const dragTo = (e: PointerEvent<HTMLDivElement>) => {
    const r = bodyRef.current?.getBoundingClientRect();
    if (r && r.width > 0) setSplit(clampSplit(((e.clientX - r.left) / r.width) * 100));
  };

  const focus = page ? (
    <FocusView page={page} settings={settings} onSettings={changeSettings} scrollToBlock={scrollTo}
      onLocate={pointable ? (id) => locate(id ? { blockId: id } : null) : undefined} />
  ) : null;
  const current = views.find((v) => v.id === tab);

  return (
    <div className="workspace" data-drawer={drawer ? "open" : undefined}>
      <div className="ws-frame">
        <aside className="ws-side" id={sideId} aria-label="Distill">
          <div className="ws-brandrow">
            <div className="ws-brand">{brand ?? <span className="ws-brand-word">Distill</span>}</div>
            <button type="button" className="ws-close" ref={closeRef} aria-label="Close the menu" onClick={closeDrawer}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          {pages && (
            <nav className="ws-sec" aria-label="Pages">
              <p className="ws-sec-h" aria-hidden="true">Pages</p>
              {pages}
            </nav>
          )}

          <nav className="ws-sec" aria-label="Views">
            <p className="ws-sec-h" aria-hidden="true">Views</p>
            <div role="tablist" aria-orientation="vertical" aria-label="Views" className="ws-views">
              {views.map((v, i) => (
                <button key={v.id} role="tab" type="button" id={`tab-${v.id}`} aria-selected={tab === v.id} aria-controls="panel"
                  aria-keyshortcuts={String(i + 1)} className="ws-navbtn" onClick={() => pick(v.id)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{ICONS[v.id]}</svg>
                  <span className="ws-two">
                    {v.label}
                    {v.id === "handrail" && waiting > 0
                      ? <span className="chip ws-badge" data-testid="agent-badge">{waiting} waiting</span>
                      : v.sub && <small>{v.sub}</small>}
                  </span>
                  <kbd aria-hidden="true">{i + 1}</kbd>
                </button>
              ))}
            </div>
          </nav>

          <div className="ws-sidefoot">
            <ModelCard model={model} />
            <Settings settings={settings} onChange={changeSettings} />
            {footer && <div className="ws-footslot">{footer}</div>}
          </div>
        </aside>
        <div className="ws-scrim" aria-hidden="true" onClick={closeDrawer} />

        <div className="ws-main" ref={mainRef}>
          <div className="ws-mtop">
            <button type="button" className="ws-menu" ref={menuRef} aria-expanded={drawer} aria-controls={sideId} onClick={() => setDrawer(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
              Menu
            </button>
            <div className="ws-brand">{brand ?? <span className="ws-brand-word">Distill</span>}</div>
            <span className="ws-mview">{current?.label}</span>
          </div>

          <header className="ws-head">
            <div className="ws-title">
              {homeHref && (
                <><a className="ws-home" href={homeHref}><span aria-hidden="true">‹</span> Home</a><span className="ws-sep" aria-hidden="true">/</span></>
              )}
              <h1>{host.label()}</h1>
              {page && (
                <span className="muted ws-meta">
                  <span className="ws-tag" title={`The page is in ${page.lang}`}>{page.lang.toUpperCase()}</span>
                  <span className="ws-blocks">{page.blocks.length} blocks read</span>
                </span>
              )}
            </div>
            {/* The extension has no Original control: the tab beside the panel is the original, never changed. */}
            {host.originalPane && <OriginalControl mode={mode} canBeside={canBeside} onChange={chooseOriginal} />}
          </header>

          <ConfigNotice />

          <div className={dragging ? "ws-body dragging" : "ws-body"} ref={bodyRef} data-original={mode}
            style={beside ? { gridTemplateColumns: `minmax(0, ${split}fr) .75rem minmax(0, ${100 - split}fr)` } : undefined}>
            {host.originalPane && (
              // Always mounted in the same place, so the page (and what was typed into it) is never reloaded.
              <section className="ws-orig" id="ws-orig" aria-label="Original page" hidden={mode === "hide"}>
                <div className="ws-pane-head">
                  <span className="ws-pane-title">Original page{page ? <span className="muted"> · {page.lang}</span> : null}</span>
                  {beside && <button type="button" className="btn btn-small" onClick={() => chooseOriginal("full")}>Full</button>}
                  <button type="button" className="btn btn-small" onClick={() => chooseOriginal("hide")}>{beside ? "Hide" : "Back to Distill"}</button>
                </div>
                {host.originalPane(mode !== "hide")}
              </section>
            )}
            {beside && (
              <div className="ws-divider" role="separator" tabIndex={0} aria-orientation="vertical" aria-controls="ws-orig"
                aria-label="Width of the original page" aria-valuemin={SPLIT.min} aria-valuemax={SPLIT.max} aria-valuenow={split}
                aria-valuetext={`Original page ${split} percent of the width`} data-testid="split"
                onKeyDown={onDividerKey}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setDragging(true); e.preventDefault(); }}
                onPointerMove={(e) => { if (dragging) dragTo(e); }}
                onPointerUp={() => { if (dragging) { setDragging(false); writeSplit(split); } }}
                onPointerCancel={() => setDragging(false)}
                onDoubleClick={() => changeSplit(SPLIT.start)}>
                <span className="ws-grip" />
              </div>
            )}

            <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="ws-view" hidden={mode === "full"}>
              {error && <p className="notice notice-warn" role="alert" data-testid="page-error">{error}</p>}
              {!page && !error && (
                <div className="ws-content">
                  <p role="status" className="muted ws-status">Reading the page...</p>
                  <div className="reading"><PageSkeleton /></div>
                </div>
              )}
              {waiting > 0 && (
                <p className="notice ws-waiting" role="status" data-testid="agent-waiting">
                  Your helper program suggested {waiting === 1 ? "an answer" : `${waiting} answers`}. Nothing is filled in until you accept.{" "}
                  <button type="button" className="btn btn-link" onClick={() => pick("handrail")}>See suggestions</button>
                </p>
              )}
              {page && tab === "focus" && focus}
              {page && keepWayfill && (
                <div hidden={tab !== "wayfill"} data-testid="wayfill-pane">
                  <Wayfill host={host} settings={settings} model={model} onSteps={setSteps} onStep={onStep}
                    onShowOriginal={showOriginal} guideStore={guideStore} reloadKey={refreshKey} changeKey={changeKey} />
                </div>
              )}
              {page && tab === "recast" && (
                <Recast page={page} enabled={settings.recastEnabled} fallback={focus} onSections={setSections}
                  onSource={(id) => {
                    if (pointable) locate({ blockId: id });
                    else { setScrollTo(id); setTab("focus"); }
                  }} />
              )}
              {tab === "handrail" && handrail !== undefined && (
                <div className="ws-pad">
                  {onConnectHelper && (
                    <div className="card" data-testid="handrail-connect">
                      <h2>Connect your helper program</h2>
                      <p>
                        A helper program on your computer can read this page and suggest answers. Chrome will ask whether
                        Distill may talk to programs on your computer. Nothing is filled in until you press Accept.
                      </p>
                      <button type="button" className="btn btn-primary" onClick={onConnectHelper}>Connect your helper program</button>
                    </div>
                  )}
                  <HandrailPanel state={agent} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ORIGINAL_LABELS: Record<OriginalMode, { label: string; title: string }> = {
  hide: { label: "Hide", title: "Show only Distill" },
  beside: { label: "Beside", title: "Show the original page next to Distill" },
  full: { label: "Full", title: "Show the original page instead of Distill" },
};

/** Original: Hide · Beside · Full. A radio group, so arrow keys move between the choices. */
function OriginalControl({ mode, canBeside, onChange }: { mode: OriginalMode; canBeside: boolean; onChange: (m: OriginalMode) => void }) {
  const id = useId();
  const choices: OriginalMode[] = canBeside ? ["hide", "beside", "full"] : ["hide", "full"];
  return (
    <div className="ws-original" data-testid="original-control">
      <span className="ws-tool-label" id={`${id}-l`}>Original</span>
      <div className="seg" role="radiogroup" aria-labelledby={`${id}-l`}>
        {choices.map((c) => (
          <label key={c} className={mode === c ? "on" : ""} title={ORIGINAL_LABELS[c].title}>
            <input type="radio" className="visually-hidden" name={`${id}-original`} value={c} checked={mode === c}
              onChange={() => onChange(c)} data-testid={`original-${c}`} />
            <span>{ORIGINAL_LABELS[c].label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Settings({ settings, onChange }: { settings: UserSettingsDoc; onChange: (s: UserSettingsDoc) => void }) {
  const id = useId();
  return (
    <section className="ws-settings" aria-label="Settings">
      <div className="ws-row">
        <label htmlFor={`${id}-lang`}>I read in</label>
        <select id={`${id}-lang`} value={settings.readerLang} onChange={(e) => onChange({ ...settings, readerLang: e.target.value })}>
          {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </div>
      <label className="choice">
        <input type="checkbox" checked={settings.recastEnabled} onChange={(e) => onChange({ ...settings, recastEnabled: e.target.checked })} />
        Offer the new layout
      </label>
      <button type="button" className="btn btn-link ws-reset" onClick={() => onChange(DEFAULT_SETTINGS)}>Reset settings</button>
    </section>
  );
}
