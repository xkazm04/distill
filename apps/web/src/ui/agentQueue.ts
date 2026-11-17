// "Your agent is the AI": the work queue between Distill's views and the person's own CLI agent (Claude Code or agy)
// over Handrail. When the person chose "My agent" and the helper program is connected, `run()` (../ai.ts) posts a page
// or structure task here instead of calling Firebase; the agent takes it with distill_tasks and answers with
// distill_answer; the answer passes the task's door (engine `agentDoor`, the same door as a model's answer) before the
// view gets it. A values task is NEVER posted: `post` refuses it, and `run()` never asks.
import { useSyncExternalStore } from "react";
import { engine, type AgentVerdict, type DoorContext, type Task } from "./engine";

export type AiProvider = "distill" | "agent";

/** Per viewer, on this device only. */
export const PROVIDER_KEY = "distill.aiProvider";
/** How long a view waits for the agent before it says so. */
export const AGENT_TIMEOUT_MS = 180_000;

export function readProvider(): AiProvider {
  try {
    return globalThis.localStorage?.getItem(PROVIDER_KEY) === "agent" ? "agent" : "distill";
  } catch {
    return "distill";
  }
}

function writeProvider(p: AiProvider): void {
  try {
    if (p === "agent") globalThis.localStorage?.setItem(PROVIDER_KEY, p);
    else globalThis.localStorage?.removeItem(PROVIDER_KEY);
  } catch { /* storage blocked: the choice lasts for this session */ }
}

/** One task as the agent sees it (distill_tasks). */
export interface QueuedTask {
  taskId: string;
  task: Task;
  prompt: string;
  schema: object | null;
  pageToken: string;
  postedAt: string;
}

/** What a posted task comes back as: the agent's answer, or the person chose Distill's own AI for it. */
export type AgentOutcome = { kind: "answer"; data: unknown; ms: number } | { kind: "distill" };

/** Why a posted task ended without an answer. ../ai.ts turns each into plain words. */
export type AgentStopKind = "timeout" | "cancelled" | "stale" | "gone";
export class AgentStop extends Error {
  constructor(readonly kind: AgentStopKind) {
    super(`agent task ended: ${kind}`);
    this.name = "AgentStop";
  }
}

/** A refusal the agent gets back from distill_answer as a tool error (`<code>: <message>`). */
export class AnswerRefused extends Error {
  constructor(readonly code: "unknown_task" | "stale_page", message: string) {
    super(message);
    this.name = "AnswerRefused";
  }
}

/** What each task is, in the trail's words and the waiting card's. */
export const TASK_WORDS: Partial<Record<Task, string>> = {
  simplifyBlocks: "make this page easier to read",
  buildWizard: "build the form guide",
  recast: "make a new layout",
};
export const taskWords = (t: Task): string => TASK_WORDS[t] ?? "do some AI work";

interface Entry {
  item: QueuedTask;
  ctx: DoorContext;
  started: number;
  delivered: boolean;
  settle: (o: AgentOutcome) => void;
  fail: (e: AgentStop) => void;
  timer: ReturnType<typeof setTimeout>;
}

let seq = 0;
const newTaskId = (): string => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export class AgentQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly subs = new Set<() => void>();
  private readonly pollers = new Set<() => void>();
  private snap: { connected: boolean; provider: AiProvider; tasks: QueuedTask[] };
  private connected = false;
  private provider: AiProvider;
  /** Reads the page now and names it (engine pageToken). Set by the panel (useHandrail) while it has a page. */
  currentToken: (() => Promise<string>) | null = null;

  constructor(private readonly timeoutMs = AGENT_TIMEOUT_MS) {
    this.provider = readProvider();
    this.snap = { connected: false, provider: this.provider, tasks: [] };
  }

  /** The agent does the AI work: the person chose it AND the helper program is connected. */
  active(): boolean { return this.connected && this.provider === "agent"; }
  isConnected(): boolean { return this.connected; }
  getProvider(): AiProvider { return this.provider; }

  setConnected(on: boolean): void {
    if (on === this.connected) return;
    this.connected = on;
    if (!on) this.failAll("gone");
    this.changed();
  }

  setProvider(p: AiProvider): void {
    if (p === this.provider) return;
    this.provider = p;
    writeProvider(p);
    this.changed();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  };
  snapshot = () => this.snap;

  private changed(): void {
    this.snap = { connected: this.connected, provider: this.provider, tasks: [...this.entries.values()].map((e) => e.item) };
    this.subs.forEach((cb) => cb());
  }

  /**
   * Post one task and wait for the agent. Refuses a task with no door and, whatever happens, a values task: those
   * carry a person's own details and never leave the device.
   */
  async post(task: Task, prompt: string, schema: object | null, ctx: DoorContext): Promise<AgentOutcome> {
    if (engine.route(task).promptClass === "values" || !engine.agentCanDo(task)) {
      throw new Error(`"${task}" is never given to an agent`);
    }
    const pageToken = ctx.page ? await engine.pageToken(ctx.page) : await (this.currentToken?.() ?? Promise.resolve(""));
    return new Promise<AgentOutcome>((resolve, reject) => {
      const item: QueuedTask = { taskId: newTaskId(), task, prompt, schema, pageToken, postedAt: new Date().toISOString() };
      const done = () => { clearTimeout(entry.timer); this.entries.delete(item.taskId); this.changed(); };
      const entry: Entry = {
        item, ctx, started: Date.now(), delivered: false,
        settle: (o) => { done(); resolve(o); },
        fail: (e) => { done(); reject(e); },
        timer: setTimeout(() => entry.fail(new AgentStop("timeout")), this.timeoutMs),
      };
      this.entries.set(item.taskId, entry);
      this.changed();
      for (const p of [...this.pollers]) p();
    });
  }

  /** Every task still waiting for an answer. */
  open(): QueuedTask[] { return [...this.entries.values()].map((e) => e.item); }

  /**
   * distill_tasks: the waiting tasks at once, else the first ones posted within `waitMs`, else none. `onNew` hears the
   * tasks handed out for the first time (the trail's "Your agent took ...").
   */
  take(waitMs: number, onNew?: (t: QueuedTask[]) => void): Promise<QueuedTask[]> {
    const hand = (): QueuedTask[] => {
      const all = [...this.entries.values()];
      const fresh = all.filter((e) => !e.delivered);
      fresh.forEach((e) => { e.delivered = true; });
      if (fresh.length) onNew?.(fresh.map((e) => e.item));
      return all.map((e) => e.item);
    };
    if (this.entries.size || waitMs <= 0) return Promise.resolve(hand());
    return new Promise((resolve) => {
      const wake = () => { clearTimeout(timer); this.pollers.delete(wake); resolve(hand()); };
      const timer = setTimeout(wake, waitMs);
      this.pollers.add(wake);
    });
  }

  /**
   * distill_answer: the agent's JSON through the task's door. A page that changed since the task refuses the answer
   * and withdraws the task (the view says so). An accepted answer goes to the view that asked, unchanged: the view
   * runs the same door again on it, so what it shows and counts is exactly what a model's answer would give.
   */
  async answer(taskId: string, json: string): Promise<AgentVerdict> {
    const entry = this.entries.get(taskId);
    if (!entry) throw new AnswerRefused("unknown_task", "No such task is waiting. It was answered, cancelled or timed out; call distill_tasks again.");
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch (e) {
      return { accepted: false, dropped: 0, errors: [`The answer is not valid JSON: ${e instanceof Error ? e.message.slice(0, 120) : "parse error"}`] };
    }
    const now = await (this.currentToken?.() ?? Promise.resolve(entry.item.pageToken)).catch(() => "");
    if (!this.entries.has(taskId)) throw new AnswerRefused("unknown_task", "The task ended while your answer was checked.");
    if (now !== entry.item.pageToken) {
      entry.fail(new AgentStop("stale"));
      throw new AnswerRefused("stale_page", "The page changed since this task was posted, so the answer was not used. Distill posts a new task when the person asks again.");
    }
    const verdict = engine.agentDoor(entry.item.task, data, entry.ctx);
    if (verdict.accepted) entry.settle({ kind: "answer", data, ms: Date.now() - entry.started });
    return verdict;
  }

  /** The person stopped waiting. */
  cancel(taskId: string): void { this.entries.get(taskId)?.fail(new AgentStop("cancelled")); }
  /** "Use Distill's AI instead": the view runs the task the usual way. */
  useDistill(taskId: string): void { this.entries.get(taskId)?.settle({ kind: "distill" }); }
  failAll(kind: AgentStopKind): void { for (const e of [...this.entries.values()]) e.fail(new AgentStop(kind)); }
}

/** The one queue of this page (the side panel or the web app). */
export const agentQueue = new AgentQueue();

/** The queue's state for a view: connected, the person's choice, the tasks waiting. */
export function useAgentQueue(q: AgentQueue = agentQueue) {
  return useSyncExternalStore(q.subscribe, q.snapshot, q.snapshot);
}

/** True while the agent does the AI work (chosen and connected). */
export function useAgentActive(q: AgentQueue = agentQueue): boolean {
  const s = useAgentQueue(q);
  return s.connected && s.provider === "agent";
}
