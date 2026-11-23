// r2-08 Remember this site, the service worker's side: when a remembered site finishes loading in a tab, open the
// caption by itself, the way the toolbar click does (the content script, then distill:caption:open), and Clean runs.
//
// No new permission: tabs.onUpdated needs none, and Chrome shows a tab's URL to the extension only on a site it holds a
// host permission for, which is exactly the remembered ones. That permission also lets chrome.scripting put the
// content script in the tab without a click. Only the top frame ever gets it (no allFrames), and the page side refuses
// an automatic open in a frame or after the person closed Distill on this document (content.ts).
import type { ContentRequest } from "../messages";
import { hasSite } from "./sitePermission";
import { autoOpenOrigin, loadSites, saveSites, withoutRemoved } from "./sites";

/** Tabs whose automatic open is under way: a second "complete" for the same load does not start another. */
const opening = new Set<number>();

/** Opens the caption in this tab without a click. Resolves whether it is open now. */
export async function autoOpen(tabId: number): Promise<boolean> {
  if (opening.has(tabId)) return false;
  opening.add(tabId);
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    const req: ContentRequest = { type: "distill:caption:open", tabId, auto: true };
    const res = (await chrome.tabs.sendMessage(tabId, req, { frameId: 0 })) as { ok: boolean; data?: { open: boolean } } | undefined;
    return !!res?.ok && !!res.data?.open;
  } finally {
    opening.delete(tabId);
  }
}

/** One tab update: open by itself when the tab finished loading a remembered site whose permission is still held. */
export async function onTabUpdated(tabId: number, status: string | undefined, url: string | undefined): Promise<boolean> {
  if (status !== "complete" || !url) return false; // cheap: most updates stop here, before any storage read
  const sites = await loadSites();
  const origin = autoOpenOrigin({ status, url, sites });
  if (!origin || !(await hasSite(origin))) return false;
  return autoOpen(tabId);
}

/** Chrome took permissions back (the person removed the site in Chrome's settings, or Forget): drop those sites, so
 *  Distill stops opening there and More shows the switch off. */
export async function onPermissionsRemoved(origins: readonly string[] | undefined): Promise<void> {
  if (!origins?.length) return;
  const sites = await loadSites();
  const left = withoutRemoved(sites, origins);
  if (Object.keys(left).length !== Object.keys(sites).length) await saveSites(left);
}

export function registerAutoOpen(): void {
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    void onTabUpdated(tabId, info.status, tab.url).catch(() => undefined);
  });
  chrome.permissions.onRemoved.addListener((p) => { void onPermissionsRemoved(p.origins).catch(() => undefined); });
}
