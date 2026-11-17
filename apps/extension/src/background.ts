// Service worker: opens the side panel from the toolbar icon, relays the Handrail port to the native host once the
// person allowed it, and forgets a tab's kept form answers when the tab closes.
import { HANDRAIL_NATIVE_HOST, HANDRAIL_PORT } from "./messages";
import { forgetTab } from "./sidepanel/guideStore";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onConnect.addListener((panel) => {
  if (panel.name !== HANDRAIL_PORT) return;
  let native: chrome.runtime.Port | null = null;
  let gone = false;
  const early: unknown[] = []; // what the panel sent while the permission was being checked
  const status = (reason: string) => {
    try {
      panel.postMessage({ id: `s${Date.now()}`, type: "status", payload: { connected: false, reason } });
    } catch { /* the panel is already gone */ }
  };

  panel.onMessage.addListener((m) => {
    if (!native) { early.push(m); return; }
    try { native.postMessage(m); } catch { /* host is gone; the status message says so */ }
  });
  panel.onDisconnect.addListener(() => { gone = true; native?.disconnect(); });

  // nativeMessaging is optional: without the person's OK there is no native connection at all.
  void chrome.permissions.contains({ permissions: ["nativeMessaging"] }).then(
    (held) => {
      if (gone) return;
      if (!held || typeof chrome.runtime.connectNative !== "function") {
        status("Distill is not yet allowed to talk to the helper program");
        return;
      }
      const n = chrome.runtime.connectNative(HANDRAIL_NATIVE_HOST);
      native = n;
      n.onMessage.addListener((m) => panel.postMessage(m));
      n.onDisconnect.addListener(() => {
        native = null;
        status(chrome.runtime.lastError?.message ?? "it stopped");
      });
      for (const m of early.splice(0)) {
        try { n.postMessage(m); } catch { /* host is gone; the status message says so */ }
      }
    },
    () => status("Distill could not check its permission for the helper program"),
  );
});

// A closed tab's guide (its place and answers) and its answers by label are removed from this device.
chrome.tabs.onRemoved.addListener((tabId) => { void forgetTab(tabId).catch(() => undefined); });
