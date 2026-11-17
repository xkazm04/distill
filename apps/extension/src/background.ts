// Service worker: opens the side panel from the toolbar icon, and relays the Handrail port to the native host.
import { HANDRAIL_NATIVE_HOST, HANDRAIL_PORT } from "./messages";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onConnect.addListener((panel) => {
  if (panel.name !== HANDRAIL_PORT) return;
  const native = chrome.runtime.connectNative(HANDRAIL_NATIVE_HOST);
  native.onMessage.addListener((m) => panel.postMessage(m));
  native.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message ?? "it stopped";
    try {
      panel.postMessage({ id: `s${Date.now()}`, type: "status", payload: { connected: false, reason } });
    } catch { /* the panel is already gone */ }
  });
  panel.onMessage.addListener((m) => { try { native.postMessage(m); } catch { /* host is gone; the status message says so */ } });
  panel.onDisconnect.addListener(() => native.disconnect());
});
