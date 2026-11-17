/**
 * Whether a `chrome.tabs.onUpdated` event should make the side panel re-read its page. Only the tab the panel is
 * showing counts: a background tab, another window or an auto-refreshing page finishing its load must never rebuild
 * the page host, because that sends the form guide back to step 1. With no tab shown yet, any finished load may be
 * the page the person wants, so it counts.
 */
export function shouldReread(updatedTabId: number, info: { status?: string }, shownTabId: number | null | undefined): boolean {
  if (info.status !== "complete") return false;
  return shownTabId === null || shownTabId === undefined || updatedTabId === shownTabId;
}

/**
 * The panel's `chrome.tabs.onUpdated` listener. `shownTabId` is read at event time (a ref in the panel), so the
 * listener registered once still sees the tab the panel shows now.
 */
export function tabUpdatedListener(shownTabId: () => number | null | undefined, reread: () => void) {
  return (tabId: number, info: { status?: string }): void => {
    if (shouldReread(tabId, info, shownTabId())) reread();
  };
}
