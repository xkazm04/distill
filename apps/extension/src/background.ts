// Service worker: opens the side panel from the toolbar icon, relays the Handrail port to the native host once the
// person allowed it, and forgets a tab's kept form answers when the tab closes.
import { HANDRAIL_NATIVE_HOST, HANDRAIL_PORT } from "./messages";
import { forgetTab } from "./sidepanel/guideStore";

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

/** How long the native host must stay up before the panel hears "connected": Chrome reports a missing or broken
 *  helper program as a disconnect a moment after connectNative, and the panel should not flash "Connected" first. */
export const CONNECTED_AFTER_MS = 300;

/**
 * E2E ONLY. `vite build --mode e2e` keeps this; every other build drops it (the MODE comparison is replaced at build
 * time and the branch is dead code). The end-to-end tests play the helper program from the service worker: they
 * switch it on before opening the panel, read what the panel sends and send it host requests, so the harness drives
 * Handrail in real Chrome without a native host on the machine.
 */
interface FakeHelper { on: boolean; panels: Set<chrome.runtime.Port>; inbox: unknown[] }
const fakeHelper: FakeHelper | null = import.meta.env.MODE === "e2e" ? { on: false, panels: new Set(), inbox: [] } : null;
if (fakeHelper) {
  (globalThis as { __distillFakeHelper?: unknown }).__distillFakeHelper = {
    enable() { fakeHelper.on = true; },
    send(m: unknown) { fakeHelper.panels.forEach((p) => p.postMessage(m)); return fakeHelper.panels.size; },
    take() { return fakeHelper.inbox.splice(0); },
  };
}

chrome.runtime.onConnect.addListener((panel) => {
  if (panel.name !== HANDRAIL_PORT) return;
  if (fakeHelper?.on) {
    fakeHelper.panels.add(panel);
    panel.onMessage.addListener((m) => { fakeHelper.inbox.push(m); });
    panel.onDisconnect.addListener(() => { fakeHelper.panels.delete(panel); });
    panel.postMessage({ id: "s-fake", type: "status", payload: { connected: true } });
    return;
  }
  let native: chrome.runtime.Port | null = null;
  let gone = false;
  const early: unknown[] = []; // what the panel sent while the permission was being checked
  const status = (connected: boolean, reason?: string) => {
    try {
      panel.postMessage({ id: `s${Date.now()}`, type: "status", payload: reason ? { connected, reason } : { connected } });
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
        status(false, "Distill is not yet allowed to talk to the helper program");
        return;
      }
      const n = chrome.runtime.connectNative(HANDRAIL_NATIVE_HOST);
      native = n;
      n.onMessage.addListener((m) => panel.postMessage(m));
      n.onDisconnect.addListener(() => {
        native = null;
        status(false, chrome.runtime.lastError?.message ?? "it stopped");
      });
      for (const m of early.splice(0)) {
        try { n.postMessage(m); } catch { /* host is gone; the status message says so */ }
      }
      // The panel's "connected" follows the port: say so once the helper program is up.
      setTimeout(() => { if (native === n && !gone) status(true); }, CONNECTED_AFTER_MS);
    },
    () => status(false, "Distill could not check its permission for the helper program"),
  );
});

// A closed tab's guide (its place and answers) and its answers by label are removed from this device.
chrome.tabs.onRemoved.addListener((tabId) => { void forgetTab(tabId).catch(() => undefined); });
