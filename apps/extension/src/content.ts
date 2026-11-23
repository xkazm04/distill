// Runs in the page (the DOM lives here). Injected on demand by the side panel through chrome.scripting, so the
// extension holds no standing access to any site: it reads a page only with the activeTab grant from clicking its
// icon, or a site the person allowed from the panel.
import { extractActions, extractForm, extractPage, readErrors, readValues, writeValues } from "@distill/engine";
import { applyHighlight, applyLocate, fieldElements } from "@distill/web/dom";
import type { ContentRequest, ContentResponse, LocateTarget, PageChanged } from "./messages";
import { readPageTheme } from "./pageTheme";
import { watchPage } from "./pageWatch";
import * as caption from "./caption/page";
import { playAgain } from "./caption/calm";
import { setComfort } from "./caption/comfort";
import { readContacts, showContact } from "./caption/contact";
import { formProgress, nextField } from "./caption/formCheck";
import { applyTranslation, showSource, textBlocks, watchText } from "./caption/translate";
import { clearClaims, markClaims, readMainText, showText } from "./caption/claims";
import { setTables } from "./caption/tables";
import { setLinks } from "./caption/links";
import { applyPlain, plainBlocks, plainShown } from "./caption/translate";
import { readByline } from "@distill/engine";
import { setConsent } from "./caption/consent";
import { setDark } from "./caption/dark";
import { setTerms, termsAside } from "./caption/terms";
import { markActions, readActions, showAction } from "./caption/actions";
import { applyFormErrors, applyFormText, formErrors, formSource, formText, watchForm } from "./caption/formText";
import { showExplanation } from "./caption/explain";
import { readVideo, seek } from "./caption/video";
import { readProductFacts, showProduct } from "./caption/product";
import { tourStep } from "./caption/tour";

declare global {
  interface Window { __distillContent?: true }
}

/** Block id -> the element of the page it was read from, by the last distill:getPage. Never leaves the page. */
let sources = new Map<string, Element>();
/** Action id -> the control it names, by the last distill:listActions. Never leaves the page. */
let controls = new Map<string, Element>();
/** The person closed the caption on this document (r2-08): a remembered site does not open it again until the next load. */
let closedByPerson = false;

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

/** r4-02: what the strip reads once Clean answered, to add to the line later, waits for first sight (caption/page.ts
 *  afterFirstSight), so it does not hold the page's thread while the strip appears. */
const AFTER_FIRST_SIGHT = new Set<ContentRequest["type"]>(["distill:caption:mainText", "distill:caption:byline", "distill:caption:actions", "distill:caption:terms"]);

async function handle(req: ContentRequest): Promise<unknown> {
  if (AFTER_FIRST_SIGHT.has(req.type)) await caption.afterFirstSight();
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
    case "distill:caption:open":
      // r2-08: an automatic open never in a frame, never again on a document where the person closed Distill.
      if (req.auto && (window !== window.top || closedByPerson)) return { open: caption.isOpen() };
      if (caption.isOpen() && req.toggle) { caption.close(document); closedByPerson = true; return { open: false }; }
      caption.open(document, req.tabId);
      return { open: true };
    case "distill:caption:clean": return caption.clean(document, window);
    case "distill:caption:restore": return caption.restore(req.id);
    case "distill:caption:original": termsAside(caption.context, () => caption.showOriginal(document, req.on)); return { ok: true };
    case "distill:caption:size": return { height: caption.resize(req.height, window) };
    case "distill:caption:close": caption.close(document); closedByPerson = true; return { ok: true };
    // ---- round 1 (spark universal-core) ----
    case "distill:caption:comfort": return { comfort: setComfort(document, req.on) };
    case "distill:caption:play": playAgain(document); caption.recount(); return { ok: true };
    case "distill:caption:contact": return readContacts(document, Array.from(caption.context()?.removed.values() ?? []));
    case "distill:caption:showContact": showContact(document, req.id); return { ok: true };
    case "distill:caption:form": return formProgress(document);
    case "distill:caption:nextField": return nextField(document);
    case "distill:caption:blocks": {
      const ctx = caption.context();
      return ctx ? termsAside(caption.context, () => textBlocks(ctx)) : [];
    }
    case "distill:caption:translated": return { applied: termsAside(caption.context, () => applyTranslation(req.blocks)) };
    case "distill:caption:sourceText": termsAside(caption.context, () => showSource(req.on)); return { ok: true };
    case "distill:caption:watchText": watchText(req.tabId, caption.context); watchForm(document, req.tabId); return { ok: true };
    // r3-07: Translate, Plain and Original change the main text's own text nodes; prices and dates in your terms step
    // aside while they do (caption/terms.ts termsAside).
    // ---- round 2 ----
    case "distill:caption:pageInfo": return { title: document.title, url: location.href, origin: location.origin };
    case "distill:caption:markClaims": return { marked: markClaims(document, req.claims) };
    case "distill:caption:showText": return { found: showText(document, req.blockId, req.sentence) };
    case "distill:caption:clearClaims": clearClaims(document); return { ok: true };
    case "distill:caption:mainText": {
      const ctx = caption.context();
      // r3-07: read whole text nodes, never the pieces a price or a date written your way split them into.
      return ctx ? termsAside(caption.context, () => readMainText(ctx)) : [];
    }
    case "distill:caption:tables": return { tables: setTables(document, req.on) };
    case "distill:caption:links": setLinks(document, req.on); return { ok: true };
    // ---- round 2: plain words (r2-04) ----
    case "distill:caption:plainBlocks": {
      const ctx = caption.context();
      return ctx ? termsAside(caption.context, () => plainBlocks(ctx)) : [];
    }
    case "distill:caption:plainText": return { applied: termsAside(caption.context, () => applyPlain(req.blocks)) };
    case "distill:caption:plainShown": return { shown: termsAside(caption.context, () => plainShown(req.on)) };
    // ---- round 3 ----
    case "distill:caption:consent": return { consent: setConsent(document, req.on) };
    case "distill:caption:dark": return setDark(document, window, req.on);
    case "distill:caption:byline": return readByline(document);
    case "distill:caption:terms": {
      const ctx = caption.context();
      return ctx ? setTerms(ctx, req) : { prices: 0, dates: 0 };
    }
    case "distill:caption:actions": {
      const ctx = caption.context();
      return ctx ? termsAside(caption.context, () => readActions(ctx)) : [];
    }
    case "distill:caption:markActions": return { marked: markActions(document, req.on) };
    case "distill:caption:showAction": return { found: showAction(document, req.id) };
    // ---- round 4 ----
    case "distill:caption:formText": return formText(document);
    case "distill:caption:formTranslated": return { applied: applyFormText(document, req.blocks) };
    case "distill:caption:formErrors": return formErrors(document);
    case "distill:caption:formErrorsTranslated": return { applied: applyFormErrors(document, req.blocks) };
    case "distill:caption:formSource": formSource(document, req.on); return { ok: true };
    case "distill:caption:explainShow": showExplanation(document, req.id, req.text, req.source); return { ok: true };
    case "distill:caption:video": return readVideo(document);
    case "distill:caption:seek": return { ok: seek(document, req.seconds) };
    case "distill:caption:product": return readProductFacts(document);
    case "distill:caption:showProduct": return { found: showProduct(document, req.id) };
    case "distill:caption:tour": return { found: tourStep(document, req.step) };
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
