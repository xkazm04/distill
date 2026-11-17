import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "@distill/web/ui";
import "@distill/web/ui/styles.css";
import { TabHost } from "./host";
import { connectHandrail } from "./handrailPort";

function Panel() {
  const [tab, setTab] = useState<{ id: number; title: string } | null | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);
  const port = useMemo(() => connectHandrail(), []);

  useEffect(() => {
    const read = async () => {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      setTab(t?.id !== undefined ? { id: t.id, title: t.title ?? "" } : null);
    };
    void read();
    const onActivated = () => void read();
    const onUpdated = (_id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (info.status === "complete") { void read(); setRefresh((n) => n + 1); }
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => { chrome.tabs.onActivated.removeListener(onActivated); chrome.tabs.onUpdated.removeListener(onUpdated); };
  }, []);

  const tabId = tab?.id;
  const tabTitle = tab?.title ?? "";
  const host = useMemo(() => (tabId !== undefined ? new TabHost(tabId, tabTitle) : null), [tabId, tabTitle, refresh]);

  if (tab === undefined) return <p role="status">Looking for the page...</p>;
  if (!host) return <p className="notice" role="status">Open a web page, then click the Distill icon.</p>;
  return <Workspace host={host} handrail={port} refreshKey={refresh} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(<StrictMode><Panel /></StrictMode>);
