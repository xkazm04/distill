// The caption frame's one way to the page: the content script of the top frame of its own tab.
import type { ContentReplies, ContentRequest, ContentResponse } from "../../messages";

export const tabId = Number(new URLSearchParams(location.search).get("tabId"));

/** To the content script of the top frame of this tab (never to other frames, never to this frame). */
export async function send<K extends ContentRequest["type"]>(req: ContentRequest): Promise<ContentReplies[K]> {
  const res = (await chrome.tabs.sendMessage(tabId, req, { frameId: 0 })) as ContentResponse<ContentReplies[K]> | undefined;
  if (!res) throw new Error("The page did not answer.");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
