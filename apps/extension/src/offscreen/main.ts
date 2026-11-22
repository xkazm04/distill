// The offscreen document's script (protocol.ts): answers the service worker's run() requests through the same AI
// wrapper the caption frame uses (@distill/web/ai), here in a document of Distill's own where no site's policy reaches.
// It closes itself after a while without work, in case the service worker went away before it could close it.
import { localModelState, run, toAiError, type RunResult } from "@distill/web/ai";
import { answer, isOffscreenRun, isOffscreenStateRun, type OffscreenAsk } from "./protocol";

/** A document nobody asked anything for this long closes itself (ms). */
const IDLE_MS = 60_000;
let idle: ReturnType<typeof setTimeout> | undefined;
const rest = () => {
  if (idle !== undefined) clearTimeout(idle);
  idle = setTimeout(() => window.close(), IDLE_MS);
};

// ---- E2E ONLY: the stand-in model (see caption/frame/Translate.tsx) -------------------------------------------------
// `vite build --mode e2e` keeps this; in every other build the MODE comparison is replaced at build time and the branch,
// with its import of the fake, is dead code.
async function fake(ask: Omit<OffscreenAsk, "id">): Promise<RunResult<unknown>> {
  if (import.meta.env.MODE !== "e2e" || !ask.fake) throw new Error("No stand-in model in this build.");
  const started = performance.now();
  const { fakeRun } = await import("../../../web/src/dev/fake-ai");
  if (ask.fake.delayMs) await new Promise((r) => setTimeout(r, Math.min(ask.fake?.delayMs ?? 0, 10_000)));
  const data = fakeRun(ask.task, ask.context, ask.fake.fail);
  return { data, source: ask.fake.source ?? "on_device", ms: Math.round(performance.now() - started), reason: "Fake AI (e2e build only), in Distill's offscreen document" };
}
// ------------------------------------------------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((m: unknown, sender, reply: (r: unknown) => void) => {
  // Only Distill's own service worker asks: never a content script (its sender is the page's address and its tab), never
  // another extension.
  if (isOffscreenStateRun(m) && sender.id === chrome.runtime.id && !sender.tab) {
    rest();
    void localModelState().then(reply, () => reply("unavailable"));
    return true;
  }
  if (!isOffscreenRun(m) || sender.id !== chrome.runtime.id || sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  rest();
  void answer(m.ask, {
    run: (task, prompt, schema, context) => run(task, prompt, schema, context),
    fake: import.meta.env.MODE === "e2e" ? fake : undefined,
    kindOf: (e) => toAiError(e).kind,
  }).then((r) => { rest(); reply(r); });
  return true; // the answer comes later
});
rest();
