import type { HandrailPort, HostToPanel, PanelToHost } from "@distill/web/ui";
import { HANDRAIL_PORT } from "../messages";

/** A HandrailPort over a `chrome.runtime` port named "handrail" (the background worker relays it to the native host). */
export function connectHandrail(): HandrailPort {
  const subs = new Set<(e: HostToPanel) => void>();
  let port: chrome.runtime.Port | null = null;

  const open = () => {
    const p = chrome.runtime.connect({ name: HANDRAIL_PORT });
    port = p;
    p.onMessage.addListener((m: HostToPanel) => subs.forEach((cb) => cb(m)));
    p.onDisconnect.addListener(() => {
      port = null;
      subs.forEach((cb) => cb({ id: `s${Date.now()}`, type: "status", payload: { connected: false, reason: "the connection closed" } }));
    });
    return p;
  };
  open();

  return {
    onMessage(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
    post(e: PanelToHost) { try { (port ?? open()).postMessage(e); } catch { /* disconnected; status already told the panel */ } },
    disconnect() { port?.disconnect(); port = null; },
  };
}
