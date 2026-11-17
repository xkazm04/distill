import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "@distill/web/ui";
// The Distill style ships the brand fonts, self-hosted (an extension page cannot load remote fonts).
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/fredoka/wght.css";
import "@distill/web/ui/styles.css";
import "./panel.css";
import { TabHost } from "./host";
import { connectHandrail } from "./handrailPort";
import { LookSetting, useLook } from "./look";
import { tabUpdatedListener } from "./tabEvents";

/**
 * `sidepanel.html?tabId=<n>` pins the panel to tab n: it shows that tab and ignores which tab is active. The end-to-end
 * harness opens the panel this way in an ordinary page. Harmless in production: it only picks which tab the panel
 * shows, and the access rules for reading that tab still apply.
 */
function pinnedTabId(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("tabId");
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

function Panel() {
  const [tab, setTab] = useState<{ id: number; title: string } | null | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);
  const port = useMemo(() => connectHandrail(), []);
  const shownTabId = useRef<number | undefined>(undefined);
  shownTabId.current = tab?.id;

  useEffect(() => {
    const pinned = pinnedTabId(location.search);
    const read = async () => {
      const t = pinned === undefined
        ? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        : await chrome.tabs.get(pinned).catch(() => undefined);
      setTab(t?.id !== undefined ? { id: t.id, title: t.title ?? "" } : null);
    };
    void read();
    const onActivated = () => { if (pinned === undefined) void read(); };
    // Only the tab this panel shows: another tab finishing its load must not reset the form guide.
    const onUpdated = tabUpdatedListener(() => shownTabId.current, () => { void read(); setRefresh((n) => n + 1); });
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => { chrome.tabs.onActivated.removeListener(onActivated); chrome.tabs.onUpdated.removeListener(onUpdated); };
  }, []);

  const tabId = tab?.id;
  const tabTitle = tab?.title ?? "";
  const host = useMemo(() => (tabId !== undefined ? new TabHost(tabId, tabTitle) : null), [tabId, tabTitle, refresh]);
  const { look, setLook, status } = useLook(host, refresh);
  const lookSetting = <LookSetting look={look} onLook={setLook} status={status} />;

  if (tab === undefined) return <p role="status">Looking for the page...</p>;
  if (!host) return <><p className="notice" role="status">Open a web page, then click the Distill icon.</p>{lookSetting}</>;
  return <><Workspace host={host} handrail={port} refreshKey={refresh} />{lookSetting}</>;
}

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><Panel /></StrictMode>);
