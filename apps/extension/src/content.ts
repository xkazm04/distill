// Runs in the page (the DOM lives here). Injected on demand by the side panel through chrome.scripting, so the
// extension holds no standing access to any site: it reads a page only with the activeTab grant from clicking its
// icon, or a site the person allowed from the panel.
import { extractActions, extractForm, extractPage, readErrors, readValues, writeValues } from "@distill/engine";
import { applyHighlight, applyLocate, fieldElements } from "@distill/web/dom";
import type { ContentRequest, ContentResponse, LocateTarget, PageChanged } from "./messages";
import { readPageTheme } from "./pageTheme";
import { watchPage } from "./pageWatch";

declare global {
  interface Window { __distillContent?: true }
}

/** Block id -> the element of the page it was read from, by the last distill:getPage. Never leaves the page. */
let sources = new Map<string, Element>();
/** Action id -> the control it names, by the last distill:listActions. Never leaves the page. */
let controls = new Map<string, Element>();

/** Clicks a control the person accepted. Only one from the last listing, and only while it is still in the page. */
function doAction(actionId: string): void {
  const el = controls.get(actionId);
  if (!el || !el.isConnected) throw new Error("That button or link is no longer on the page.");
  (el as HTMLElement).click();
}

const reducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function locate(target: LocateTarget | null, color?: string): void {
  let els: Element[] = [];
  if (target && "blockId" in target) {
    const el = sources.get(target.blockId);
    if (el?.isConnected) els = [el];
  } else if (target) {
    els = fieldElements(document, target.fieldIds);
  }
  applyLocate(document, els, color, reducedMotion());
}

async function handle(req: ContentRequest): Promise<unknown> {
  switch (req.type) {
    case "distill:ping": return { ready: true };
    case "distill:getPage": {
      const next = new Map<string, Element>();
      const page = extractPage(document, location.href, { onSource: (id, el) => next.set(id, el) });
      sources = next;
      return page;
    }
    case "distill:getForm": return extractForm(document, location.href, req.formIndex);
    case "distill:readValues": return readValues(document, req.structure);
    case "distill:writeValues": return writeValues(document, req.structure, req.values);
    case "distill:readErrors": return readErrors(document, req.structure);
    case "distill:highlight": applyHighlight(document, req.fieldIds, req.color); return { ok: true };
    case "distill:getTheme": return readPageTheme(document);
    case "distill:locate": locate(req.target, req.color); return { ok: true };
    case "distill:listActions": {
      const next = new Map<string, Element>();
      const actions = extractActions(document, location.href, (id, el) => next.set(id, el));
      controls = next;
      return actions;
    }
    case "distill:doAction": doAction(req.actionId); return { ok: true };
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

  const stop = watchPage(window, document, (reason) => {
    const msg: PageChanged = { type: "distill:pageChanged", reason };
    try {
      // No panel open is fine: nobody needs to know.
      void chrome.runtime.sendMessage(msg).catch(() => undefined);
    } catch {
      stop(); // the extension was reloaded or removed: this copy of the script is orphaned
    }
  });
}
