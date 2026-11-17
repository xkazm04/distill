import type { HandrailPort, HostToPanel, PanelToHost } from "@distill/web/ui";
import { HANDRAIL_PORT } from "../messages";

/** The optional permission the helper program (Handrail) needs: Chrome talking to a program on this computer. */
export const HELPER_PERMISSION: chrome.permissions.Permissions = { permissions: ["nativeMessaging"] };

/** Whether the person already allowed Distill to talk to the helper program. */
export function helperAllowed(): Promise<boolean> {
  return chrome.permissions.contains(HELPER_PERMISSION).catch(() => false);
}

export interface HelperPort extends HandrailPort {
  /** Opens the connection (the background worker relays it to the native host). Call only once the permission is held. */
  connect(): void;
}

/**
 * A HandrailPort over a `chrome.runtime` port named "handrail". It stays closed until `connect()`: nativeMessaging is
 * optional, so the panel connects only when the permission is held (see helperAllowed and requestHelper).
 */
export function connectHandrail(): HelperPort {
  const subs = new Set<(e: HostToPanel) => void>();
  let port: chrome.runtime.Port | null = null;
  let wanted = false;
  /** The last connection status. The worker may answer before the views subscribe (they mount once the tab is
   *  found), so a late subscriber gets it at once instead of never hearing that the helper is missing. */
  let status: HostToPanel | null = null;
  const deliver = (m: HostToPanel) => {
    if (m.type === "status") status = m;
    subs.forEach((cb) => cb(m));
  };

  const open = () => {
    const p = chrome.runtime.connect({ name: HANDRAIL_PORT });
    port = p;
    status = null;
    p.onMessage.addListener((m: HostToPanel) => deliver(m));
    p.onDisconnect.addListener(() => {
      port = null;
      deliver({ id: `s${Date.now()}`, type: "status", payload: { connected: false, reason: "the connection closed" } });
    });
    return p;
  };

  return {
    onMessage(cb) {
      subs.add(cb);
      if (status) cb(status);
      return () => { subs.delete(cb); };
    },
    post(e: PanelToHost) {
      if (!wanted) return;
      try { (port ?? open()).postMessage(e); } catch { /* disconnected; status already told the panel */ }
    },
    disconnect() { wanted = false; port?.disconnect(); port = null; },
    connect() { wanted = true; if (!port) open(); },
  };
}

/**
 * "Connect your helper program": Chrome asks the person first (this must start inside the click), and only a yes
 * connects. Resolves to whether the permission was given.
 */
export async function requestHelper(port: HelperPort): Promise<boolean> {
  const granted = await chrome.permissions.request(HELPER_PERMISSION).catch(() => false);
  if (granted) port.connect();
  return granted;
}
