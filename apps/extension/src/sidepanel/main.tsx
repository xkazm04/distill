import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { guideLibrary, Workspace } from "@distill/web/ui";
// The guide library, inside this bundle: looking a guide up needs no network at all (guides/README.md).
import library from "virtual:distill-guides";
// The Distill style ships the brand fonts, self-hosted (an extension page cannot load remote fonts).
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/fredoka/wght.css";
import "@distill/web/ui/styles.css";
import "./panel.css";
import { isPageChanged } from "../messages";
import { checkAccess, type Access } from "./access";
import { AccessNeeded, BrowserPage } from "./accessView";
import { tabGuideStore } from "./guideStore";
import { TabHost } from "./host";
import { connectHandrail, helperAllowed, requestHelper } from "./handrailPort";
import { LookSetting, useLook } from "./look";
import { pinnedTabId, tabUpdatedListener } from "./tabEvents";
import { UpdateNotice } from "./update/UpdateNotice";

interface ShownTab { id: number; title: string; url?: string }

/** Matched on this device. Drafts only in a developer's own build with VITE_GUIDE_DRAFTS=1, never the public one. */
const guides = guideLibrary(async () => library, { drafts: import.meta.env.VITE_GUIDE_DRAFTS === "1" });

function Panel() {
  const pinned = useMemo(() => pinnedTabId(location.search), []);
  const [tab, setTab] = useState<ShownTab | null | undefined>(undefined);
  /** The shown tab finished loading a page (a reload or a navigation). */
  const [loads, setLoads] = useState(0);
  /** The page changed in place (the content script's distill:pageChanged). */
  const [changes, setChanges] = useState(0);
  /** The person gave a permission (a site, all sites, or the helper program). */
  const [grants, setGrants] = useState(0);
  const shown = useRef<ShownTab | null | undefined>(undefined);
  shown.current = tab;

  // ---- which tab, and when it changes --------------------------------------------------------------------------
  useEffect(() => {
    const read = async () => {
      const t = pinned === undefined
        ? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        : await chrome.tabs.get(pinned).catch(() => undefined);
      if (t?.id === undefined) { setTab(null); return; }
      const next: ShownTab = { id: t.id, title: t.title ?? "", url: t.url ?? t.pendingUrl };
      setTab((old) => (old && old.id === next.id && old.title === next.title && old.url === next.url ? old : next));
    };
    void read();
    const onActivated = () => { if (pinned === undefined) void read(); };
    // Only the tab this panel shows: another tab finishing its load must not touch the form guide.
    const onUpdated = tabUpdatedListener(() => shown.current?.id, () => { void read(); setLoads((n) => n + 1); });
    const onMessage = (m: unknown, sender: chrome.runtime.MessageSender) => {
      if (isPageChanged(m) && sender.tab?.id !== undefined && sender.tab.id === shown.current?.id) setChanges((n) => n + 1);
    };
    const onGranted = () => setGrants((n) => n + 1);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.permissions.onAdded.addListener(onGranted);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.permissions.onAdded.removeListener(onGranted);
    };
  }, [pinned]);

  // One host and one guide store per tab, kept across the tab's navigations: the views re-read instead of restarting.
  const tabId = tab?.id;
  const title = useRef("");
  title.current = tab?.title ?? "";
  const host = useMemo(() => (tabId !== undefined ? new TabHost(tabId, () => title.current) : null), [tabId]);
  const guideStore = useMemo(() => (tabId !== undefined ? tabGuideStore(tabId) : undefined), [tabId]);

  // ---- may Distill read it? Checked for every tab, every load and every permission given ------------------------
  const [checked, setChecked] = useState<{ host: TabHost; access: Access } | null>(null);
  /** The loads the access check has seen succeed: the Workspace reads afresh only once the new page answers. */
  const [readKey, setReadKey] = useState(0);
  useEffect(() => {
    if (!host) return;
    let live = true;
    void checkAccess(host, shown.current?.url).then((access) => {
      if (!live) return;
      setChecked({ host, access });
      if (access.kind === "ok") setReadKey(loads);
    });
    return () => { live = false; };
  }, [host, loads, grants]);
  const access = checked?.host === host ? checked.access : undefined;

  // ---- the helper program: optional, connected only once the person allowed it --------------------------------
  const port = useMemo(() => connectHandrail(), []);
  const [helperOk, setHelperOk] = useState<boolean | null>(null);
  useEffect(() => {
    void helperAllowed().then((ok) => { setHelperOk(ok); if (ok) port.connect(); });
    return () => port.disconnect();
  }, [port]);
  const connectHelper = useCallback(() => { void requestHelper(port).then(setHelperOk); }, [port]);

  const readable = access?.kind === "ok" ? host : null;
  const { look, setLook, status } = useLook(readable, readKey);
  const lookSetting = <LookSetting look={look} onLook={setLook} status={status} />;

  if (tab === undefined) return <p role="status">Looking for the page...</p>;
  if (!host) return <><p className="notice" role="status">Open a web page, then click the Distill icon.</p>{lookSetting}</>;
  if (!access) return <p role="status" className="access-wait">Looking at this page...</p>;
  if (access.kind === "browser") return <><BrowserPage />{lookSetting}</>;
  if (access.kind === "needed") {
    return <><AccessNeeded origin={access.origin} onGranted={() => setGrants((n) => n + 1)} />{lookSetting}</>;
  }
  return (
    <>
      <Workspace host={host} handrail={port} refreshKey={readKey} changeKey={changes} guideStore={guideStore} guides={guides}
        onConnectHelper={helperOk === false ? connectHelper : undefined} />
      {lookSetting}
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><Panel /><UpdateNotice /></StrictMode>);
