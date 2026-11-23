// One way for the strip to run an on-device-first page task (round 2: findClaims, gist, plain words): the frame's own
// run(), the offscreen document when the site forbids the model in frames (docs/caption.md, risk 1), or the e2e
// build's stand-in model. The same paths Translate.tsx's runTranslate takes, for any task. The one values task here is
// askPage (Ask.tsx): run() pins it to the device, and Ask never calls this in a blocked frame (the offscreen door refuses
// values); the web check (checkClaim) is cloud and grounded and has its own run (ClaimCheck.tsx).
import type { Task } from "@distill/engine";
import { aiAvailable, run, toAiError, type RunContext, type RunResult } from "@distill/web/ai";
import { deviceModelBlocked, runOffscreen } from "../../offscreen/client";
import { E2E_FAKE_AI_KEY } from "./Translate";

export type TaskCall<T> = RunResult<T> & { via?: "offscreen" };

/** `entry`: which stand-in Search Suggestions the grounded run returns (fake-ai.ts FakeEntry; r3-02). */
interface E2eFake { fail?: string; source?: "on_device" | "in_cloud"; delayMs?: number; entry?: "sample" | "hostile" | "huge" | "none" }

/** E2E ONLY: the stand-in model's switch (chrome.storage.session). Null in every other build (dead code there). */
export async function e2eFake(): Promise<E2eFake | null> {
  if (import.meta.env.MODE !== "e2e") return null;
  try {
    return ((await chrome.storage.session.get(E2E_FAKE_AI_KEY))[E2E_FAKE_AI_KEY] as E2eFake | undefined) ?? null;
  } catch { return null; }
}

/** r5-09: whether trying the same run again can help (the service was busy, the answer was garbled), so a section
 *  offers Try again; a missing model or an AI switched off is not helped by trying again. */
export function retryHelps(e: unknown): boolean {
  return toAiError(e).retry;
}

/** Whether a model can answer here at all. */
export async function canRunTask(): Promise<boolean> {
  if (import.meta.env.MODE === "e2e" && (await e2eFake())) return true;
  return aiAvailable();
}

/** Runs `task` with `prompt` and `schema`; `ctx` is what the stand-in model answers from (and what a door checks). */
export async function runTask<T = unknown>(task: Task, prompt: string, schema: object | null, ctx: RunContext): Promise<TaskCall<T>> {
  if (deviceModelBlocked()) {
    const fake = import.meta.env.MODE === "e2e" ? await e2eFake() : null;
    const r = await runOffscreen<T>(task, prompt, schema, ctx, fake ?? undefined);
    return { ...r, via: "offscreen" };
  }
  if (import.meta.env.MODE === "e2e") {
    const fake = await e2eFake();
    if (fake) {
      const started = performance.now();
      const { fakeRun } = await import("../../../../web/src/dev/fake-ai");
      if (fake.delayMs) await new Promise((r) => setTimeout(r, Math.min(fake.delayMs ?? 0, 10_000)));
      try {
        const data = fakeRun(task, ctx, fake.fail) as T;
        return { data, source: fake.source ?? "on_device", ms: Math.round(performance.now() - started), reason: "Fake AI (e2e build only)" };
      } catch (e) { throw toAiError(e); }
    }
  }
  return run<T>(task, prompt, schema, ctx);
}
