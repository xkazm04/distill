// Runs in the page (the DOM lives here). Injected on demand by the side panel through chrome.scripting, so the
// extension holds no standing access to any site: it needs only the activeTab grant from clicking its icon.
import { extractForm, extractPage, readValues, writeValues } from "@distill/engine";
import { applyHighlight } from "@distill/web/dom";
import type { ContentRequest, ContentResponse } from "./messages";

declare global {
  interface Window { __distillContent?: true }
}

async function handle(req: ContentRequest): Promise<unknown> {
  switch (req.type) {
    case "distill:ping": return { ready: true };
    case "distill:getPage": return extractPage(document, location.href);
    case "distill:getForm": return extractForm(document, location.href, req.formIndex);
    case "distill:readValues": return readValues(document, req.structure);
    case "distill:writeValues": return writeValues(document, req.structure, req.values);
    case "distill:highlight": applyHighlight(document, req.fieldIds); return { ok: true };
  }
}

if (!window.__distillContent) {
  window.__distillContent = true;
  chrome.runtime.onMessage.addListener((req: ContentRequest, sender, send: (r: ContentResponse<unknown>) => void) => {
    if (sender.id !== chrome.runtime.id) return false; // only our own side panel may drive the page
    handle(req).then(
      (data) => send({ ok: true, data }),
      (e: unknown) => send({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true; // reply asynchronously
  });
}
