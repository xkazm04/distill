// Spark universal-core round 2, card 2: a claim checked on the web (task checkClaim, cloud, Google Search grounding).
// The strip's first cloud call. Rendered by Claims.tsx inside each claim row (ClaimCheck); the consent question, Check
// all and the "by themselves" switch are ChecksControls, in More (main.tsx).
//
// What is sent: the claim's sentence, the page's title and its address without query or fragment (a form sent by GET
// puts what was typed in the query). Never a form's content, never other text of the page. Before the first check the
// person is asked once; the answer stays on this device (chrome.storage.local). After yes, the first three claims of
// an article are checked by themselves (once per page) unless the switch in More is off; every other claim on a click.
import { useEffect, useSyncExternalStore } from "react";
import { parseCheck, prompts, route, type Claim, type ClaimCheck as Check, type ClaimVerdict, type InferenceSource } from "@distill/engine";
import { isOnDeviceOnlyBuild, runGrounded, toAiError, AI_WORDS, type AiFailure, type GroundedResult } from "@distill/web/ai";
import { send } from "./send";
import { readerLang } from "./Translate";
import { canRunTask, e2eFake } from "./runTask";

/** The verdicts so far, by claim id, and the switch "check the top claims by themselves". */
export interface ChecksState {
  checks: Record<string, Check | "checking" | "failed">;
  /** The person agreed to checks that send sentences to Google (asked once). */
  consent: boolean;
  auto: boolean;
}

/** Where a check ran and what its door refused, by claim id. */
export interface CheckMeta { source: InferenceSource; why: string; dropped: number }
/** Why a check failed, in plain words, and whether trying again can help. */
export interface CheckProblem { words: string; retry: boolean }

export interface ChecksStore extends ChecksState {
  meta: Record<string, CheckMeta>;
  problems: Record<string, CheckProblem>;
  /** The consent question is up: for one claim's Check (its id), for Check all ("all"), or by itself ("lead"). */
  asking: string | null;
  /** The person said "Not now" once: the question is not shown by itself again, only on a Check. */
  declined: boolean;
  /** The stored answer has been read. */
  loaded: boolean;
  /** A model can answer here at all (Firebase set up, or a stand-in model). */
  available: boolean;
}

export type Checks = ChecksState & ChecksStore & {
  check(claim: Claim): void;
  checkAll(): void;
  setAuto(on: boolean): void;
  agree(): void;
  notNow(): void;
};

/** How many claims of an article are checked by themselves after consent. */
export const AUTO_TOP = 3;
/** chrome.storage.local: {consent?: "yes" | "no", auto?: boolean}. Device only. */
export const CHECKS_KEY = "distill:checks";
export const CONSENT_QUESTION = "Checking facts sends sentences of this page to Google. Check facts?";

export const VERDICT_WORDS: Record<ClaimVerdict, string> = {
  supported: "Supported",
  disputed: "Disputed",
  mixed: "Mixed",
  notFound: "Not found",
};
/** A shape for each verdict beside its word, so colour is never the only sign. */
const VERDICT_MARK: Record<ClaimVerdict, string> = { supported: "✓", disputed: "✗", mixed: "±", notFound: "?" };

// ---- the store: one per strip (one page), so the hook can be used in more than one place ------------------------

let state: ChecksStore = { checks: {}, meta: {}, problems: {}, consent: false, auto: true, asking: null, declined: false, loaded: false, available: false };
const listeners = new Set<() => void>();
let claimsNow: readonly Claim[] = [];
let autoDone = false;
let started = false;
/** Claims waiting for the consent answer (a Check or Check all pressed before it). */
let pending: Claim[] = [];
/** One check at a time: kinder to the service's rate limits, and the verdicts arrive in order. */
let queue: Promise<void> = Promise.resolve();
let pageInfo: Promise<{ title: string; url: string }> | null = null;

function set(patch: Partial<ChecksStore> | ((s: ChecksStore) => Partial<ChecksStore>)): void {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;

async function save(): Promise<void> {
  try {
    await chrome.storage.local.set({ [CHECKS_KEY]: { consent: state.consent ? "yes" : state.declined ? "no" : undefined, auto: state.auto } });
  } catch { /* the answer then holds for this page only */ }
}

async function load(): Promise<void> {
  let stored: { consent?: string; auto?: boolean } | undefined;
  try { stored = (await chrome.storage.local.get(CHECKS_KEY))[CHECKS_KEY] as typeof stored; } catch { stored = undefined; }
  const available = !isOnDeviceOnlyBuild() && (await canRunTask().catch(() => false));
  set({ consent: stored?.consent === "yes", declined: stored?.consent === "no", auto: stored?.auto !== false, loaded: true, available });
  maybeAuto();
}

/** The address sent with a claim: no query, no fragment (what was typed into a GET form lands in the query). */
export function addressOnly(url: string): string {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return ""; }
}

function info(): Promise<{ title: string; url: string }> {
  pageInfo ??= send<"distill:caption:pageInfo">({ type: "distill:caption:pageInfo" })
    .then((p) => ({ title: p.title, url: addressOnly(p.url) }))
    .catch(() => ({ title: "", url: "" }));
  return pageInfo;
}

/** A failed check in plain words (AI_WORDS speaks of forms where the device model is missing). */
const WORDS: Partial<Record<AiFailure, string>> = {
  busy: "The AI is busy right now.",
  "not-genuine": "Distill could not prove it is genuine to the AI service.",
  "not-configured": "AI is off in this copy of Distill.",
  other: "Something went wrong with the AI.",
  "needs-cloud": AI_WORDS["needs-cloud"],
};
export function problemOf(e: unknown): CheckProblem {
  const err = toAiError(e);
  return { words: WORDS[err.kind] ?? err.message, retry: err.retry };
}

/** The grounded run: the real one, or (e2e build only) the stand-in model with its stand-in search results. */
async function grounded(prompt: string, claim: Claim): Promise<GroundedResult<unknown>> {
  if (import.meta.env.MODE === "e2e") {
    const fake = await e2eFake();
    if (fake) {
      // What would have been sent, for the e2e spec to read (the session store of the extension, never the page).
      try {
        const got = ((await chrome.storage.session.get("distill:e2e:sent"))["distill:e2e:sent"] as string[] | undefined) ?? [];
        await chrome.storage.session.set({ "distill:e2e:sent": [...got, prompt] });
      } catch { /* not needed for the check itself */ }
      const { fakeRun, fakeGrounding } = await import("../../../../web/src/dev/fake-ai");
      if (fake.delayMs) await new Promise((r) => setTimeout(r, Math.min(fake.delayMs ?? 0, 10_000)));
      try {
        const data = fakeRun("checkClaim", { claim: claim.text }, fake.fail);
        return { data, ...fakeGrounding(), source: fake.source ?? "in_cloud", ms: 0, reason: `${route("checkClaim").reason} (Fake AI, e2e build only)` };
      } catch (e) { throw toAiError(e); }
    }
  }
  return runGrounded("checkClaim", prompt, { claim: claim.text });
}

async function runCheck(claim: Claim): Promise<void> {
  try {
    const page = await info();
    const r = await grounded(prompts.checkClaim(claim.text, page.title, page.url, readerLang()), claim);
    const out = parseCheck(r.data, r.grounding, claim.id);
    if (!out.check) {
      set((s) => ({
        checks: { ...s.checks, [claim.id]: "failed" },
        problems: { ...s.problems, [claim.id]: { words: "The AI's answer could not be used.", retry: true } },
        meta: { ...s.meta, [claim.id]: { source: r.source, why: r.reason, dropped: out.dropped } },
      }));
      return;
    }
    const check = out.check;
    set((s) => ({ checks: { ...s.checks, [claim.id]: check }, meta: { ...s.meta, [claim.id]: { source: r.source, why: r.reason, dropped: out.dropped } } }));
  } catch (e) {
    set((s) => ({ checks: { ...s.checks, [claim.id]: "failed" }, problems: { ...s.problems, [claim.id]: problemOf(e) } }));
  }
}

function enqueue(claims: readonly Claim[]): void {
  const todo = claims.filter((c) => { const v = state.checks[c.id]; return v === undefined || v === "failed"; });
  if (!todo.length) return;
  set((s) => {
    const checks = { ...s.checks };
    const problems = { ...s.problems };
    for (const c of todo) { checks[c.id] = "checking"; delete problems[c.id]; }
    return { checks, problems };
  });
  for (const c of todo) queue = queue.then(() => runCheck(c));
}

/** Checks `claims` now, or asks first when the person has not agreed yet. `ask`: where the question shows. */
function request(claims: readonly Claim[], ask: string): void {
  if (isOnDeviceOnlyBuild()) {
    set((s) => {
      const problems = { ...s.problems };
      const checks = { ...s.checks };
      for (const c of claims) { problems[c.id] = { words: AI_WORDS["needs-cloud"], retry: false }; checks[c.id] = "failed"; }
      return { problems, checks };
    });
    return;
  }
  if (!state.consent) {
    pending = [...claims];
    set({ asking: ask });
    return;
  }
  enqueue(claims);
}

function maybeAuto(): void {
  if (autoDone || !state.loaded || !state.consent || !state.auto || !state.available || !claimsNow.length) return;
  autoDone = true;
  enqueue(claimsNow.slice(0, AUTO_TOP));
}

const actions = {
  check: (claim: Claim) => request([claim], claim.id),
  checkAll: () => request(claimsNow, "all"),
  setAuto: (on: boolean) => { set({ auto: on }); void save(); if (on) maybeAuto(); },
  agree: () => {
    const waiting = pending;
    pending = [];
    set({ consent: true, declined: false, asking: null });
    void save();
    if (waiting.length) enqueue(waiting);
    maybeAuto();
  },
  notNow: () => {
    pending = [];
    set({ declined: true, asking: null });
    void save();
  },
};

/** Runs the automatic checks of the top claims (after consent) and offers check(claim) for a click. */
export function useChecks(claims: readonly Claim[]): Checks {
  const s = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (!started) { started = true; void load(); }
  }, []);
  useEffect(() => {
    if (claims.length) { claimsNow = claims; maybeAuto(); }
  }, [claims]);
  return { ...s, ...actions };
}

/** E2E/unit tests only: a fresh store, as a new page would have. */
export function resetChecksForTest(): void {
  state = { checks: {}, meta: {}, problems: {}, consent: false, auto: true, asking: null, declined: false, loaded: false, available: false };
  claimsNow = []; autoDone = false; started = false; pending = []; queue = Promise.resolve(); pageInfo = null;
}

// ---- the UI ------------------------------------------------------------------------------------------------------

function Consent(props: { checks: Checks }) {
  return (
    <div className="ck-ask" role="group" aria-label="Check facts on the web" data-testid="cap-check-consent">
      <p>{CONSENT_QUESTION}</p>
      <div className="ck-acts">
        <button type="button" className="btn sm primary" onClick={props.checks.agree} data-testid="cap-check-agree">Check facts</button>
        <button type="button" className="btn sm quiet" onClick={props.checks.notNow} data-testid="cap-check-notnow">Not now</button>
      </div>
    </div>
  );
}

const where = (src: InferenceSource) => (src === "in_cloud" ? "In the cloud" : src === "on_device" ? "On this device" : "Your agent");

/** One claim's Check button, then its verdict, reason and sources. */
export function ClaimCheck(props: { claim: Claim; checks: Checks }) {
  const { claim, checks } = props;
  if (isOnDeviceOnlyBuild()) return null; // ChecksControls says why there is no web check in this build
  const v = checks.checks[claim.id];
  const meta = checks.meta[claim.id];
  const problem = checks.problems[claim.id];
  if (checks.asking === claim.id) return <div className="ck" data-testid="cap-check" data-claim={claim.id} data-state="asking"><Consent checks={checks} /></div>;
  if (v === undefined) {
    return (
      <div className="ck" data-testid="cap-check" data-claim={claim.id} data-state="none">
        <button type="button" className="btn sm" onClick={() => checks.check(claim)} disabled={!checks.loaded} data-testid="cap-check-btn"
          aria-label={`Check on the web: ${claim.text}`}>Check</button>
      </div>
    );
  }
  if (v === "checking") {
    return <div className="ck" data-testid="cap-check" data-claim={claim.id} data-state="checking"><span className="ck-wait" role="status">Checking...</span></div>;
  }
  if (v === "failed") {
    return (
      <div className="ck" data-testid="cap-check" data-claim={claim.id} data-state="failed">
        <span className="ck-fail" role="status">Not checked: {problem?.words ?? "something went wrong."}</span>
        {(problem?.retry ?? true) && <button type="button" className="btn sm quiet" onClick={() => checks.check(claim)} data-testid="cap-check-retry">Try again</button>}
        {!!meta?.dropped && <span className="ck-dropped" data-testid="cap-check-dropped">{refused(meta.dropped)}</span>}
      </div>
    );
  }
  return (
    <div className="ck" data-testid="cap-check" data-claim={claim.id} data-state="done" data-verdict={v.verdict}>
      <div className="ck-head">
        <span className="verdict" data-verdict={v.verdict} data-testid="cap-check-verdict">
          <span aria-hidden="true">{VERDICT_MARK[v.verdict]}</span> {VERDICT_WORDS[v.verdict]}
        </span>
        {meta && (
          <span className="chip sm" data-src={meta.source} tabIndex={0} data-testid="cap-check-where"
            title={`Checked ${meta.source === "in_cloud" ? "in the cloud, with Google Search" : where(meta.source).toLowerCase()}. ${meta.why}`}>{where(meta.source)}</span>
        )}
      </div>
      {v.reason && <p className="ck-reason" data-testid="cap-check-reason">{v.reason}</p>}
      {v.sources.length > 0 && (
        <ul className="ck-sources" aria-label="Sources">
          {v.sources.map((s) => (
            <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" data-testid="cap-check-source">{s.title}</a></li>
          ))}
        </ul>
      )}
      {!!meta?.dropped && <span className="ck-dropped" data-testid="cap-check-dropped">{refused(meta.dropped)}</span>}
    </div>
  );
}

const refused = (n: number) => `Distill left out ${n} part${n === 1 ? "" : "s"} of the answer it could not trust.`;

/** In More, beside the claims: the consent question, Check all, and the "by themselves" switch. */
export function ChecksControls(props: { checks: Checks; claims: readonly Claim[] }) {
  const { checks, claims } = props;
  if (isOnDeviceOnlyBuild()) {
    return claims.length ? <section data-testid="cap-checks"><h2>Check on the web</h2><p className="note">{AI_WORDS["needs-cloud"]}</p></section> : null;
  }
  if (!claims.length || !checks.loaded) return null;
  const done = claims.filter((c) => typeof checks.checks[c.id] === "object").length;
  const busy = claims.some((c) => checks.checks[c.id] === "checking");
  const asking = checks.asking === "all" || (!checks.consent && !checks.declined && checks.asking === null);
  return (
    <section className="checks" data-testid="cap-checks">
      <h2>Check on the web</h2>
      {asking ? <Consent checks={checks} /> : checks.consent ? (
        <>
          <p className="note" data-testid="cap-checks-count">{done ? `Checked ${done} of ${claims.length} claims in the cloud.` : "Only the sentence, the page's title and its address are sent."}</p>
          <div className="ck-acts">
            <button type="button" className="btn sm" onClick={checks.checkAll} disabled={busy || done === claims.length} data-testid="cap-check-all">Check all</button>
          </div>
          <label className="switch">
            <input type="checkbox" checked={checks.auto} onChange={(e) => checks.setAuto(e.target.checked)} data-testid="cap-check-auto" />
            Check the top claims by themselves
          </label>
        </>
      ) : (
        <p className="note">Nothing is checked on the web unless you press Check.</p>
      )}
      {!checks.available && <p className="note">{AI_WORDS["not-configured"]}</p>}
    </section>
  );
}
