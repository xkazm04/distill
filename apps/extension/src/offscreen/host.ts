// The service worker's side of the offscreen document (protocol.ts): it opens the document when a caption first asks,
// relays each task to it, and closes it when the last caption that held a port is gone.
import {
  isStateAsk, OFFSCREEN_JUSTIFICATION, OFFSCREEN_PORT, OFFSCREEN_URL, type OffscreenAnswer, type OffscreenAsk, type OffscreenReply,
  type OffscreenRun, type OffscreenStateAnswer, type OffscreenStateAsk, type OffscreenStateRun,
} from "./protocol";
import type { LocalModelState } from "@distill/engine";

/** The captions that may need the document now. */
const users = new Set<chrome.runtime.Port>();
/** Opening and closing run one after the other, never at once. */
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(step: () => Promise<T>): Promise<T> => {
  const next = chain.then(step, step);
  chain = next.catch(() => undefined);
  return next;
};

async function hasDocument(): Promise<boolean> {
  return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })).length > 0;
}

const open = () => serial(async () => {
  if (await hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: OFFSCREEN_JUSTIFICATION,
  });
});

const close = () => serial(async () => {
  if (users.size || !(await hasDocument())) return;
  await chrome.offscreen.closeDocument();
});

/** Hands one task to the document; opens it again if it closed itself meanwhile. */
async function relay(ask: Omit<OffscreenAsk, "id">): Promise<OffscreenReply> {
  const msg: OffscreenRun = { type: "distill:offscreen:run", ask };
  for (let attempt = 0; ; attempt++) {
    await open();
    try {
      const reply = (await chrome.runtime.sendMessage(msg)) as OffscreenReply | undefined;
      if (reply) return reply;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
    if (attempt >= 3) throw new Error("The offscreen document did not answer.");
    await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
  }
}

/** Asks the document for the on-device model's state; opens it if needed. */
async function relayState(): Promise<LocalModelState> {
  const msg: OffscreenStateRun = { type: "distill:offscreen:state" };
  await open();
  const state = (await chrome.runtime.sendMessage(msg)) as LocalModelState | undefined;
  if (!state) throw new Error("The offscreen document did not answer.");
  return state;
}

/** For the worker's onConnect: takes the caption's offscreen port (true), or leaves the port to others (false). */
export function offscreenPort(port: chrome.runtime.Port): boolean {
  if (port.name !== OFFSCREEN_PORT) return false;
  // Only Distill's own extension pages (the caption frame): never a content script, whose sender is the page's address.
  if (port.sender?.id !== chrome.runtime.id || !port.sender.url?.startsWith(chrome.runtime.getURL(""))) { port.disconnect(); return true; }
  users.add(port);
  port.onMessage.addListener((ask: OffscreenAsk | OffscreenStateAsk) => {
    if (isStateAsk(ask)) {
      void relayState().then(
        (modelState) => post(port, { id: ask.id, ok: true, modelState }),
        () => post(port, { id: ask.id, ok: false, kind: "other" }),
      );
      return;
    }
    const { id, ...task } = ask;
    void relay(task).then(
      (reply) => post(port, { ...reply, id }),
      () => post(port, { id, ok: false, kind: "other" }),
    );
  });
  port.onDisconnect.addListener(() => {
    users.delete(port);
    void close().catch(() => undefined);
  });
  return true;
}

function post(port: chrome.runtime.Port, answer: OffscreenAnswer | OffscreenStateAnswer): void {
  try { port.postMessage(answer); } catch { /* the caption is gone */ }
}
