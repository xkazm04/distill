import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldStructure, FormStructure, FormValues, UserSettingsDoc, Wizard, WizardStep } from "@distill/engine";
import { AI_WORDS, aiAvailable, aiWords, run } from "../ai";
import { isFirebaseConfigured } from "../firebase";
import { getFormGuide, saveFormGuide } from "./data";
import { engine } from "./engine";
import { accentColor } from "./dom";
import { setGuide } from "./guide";
import { labelsKey, normLabel, type GuideStore } from "./guideStore";
import { clearProfile, loadProfile, rememberAnswers } from "./profile";
import { SourceChip, type AiMeta } from "./chips";
import { WizardSkeleton } from "./loading";
import type { PageHost } from "./host";
import type { LocalModel } from "./useLocalModel";

const CHECK_SCHEMA = { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" } }, required: ["ok", "message"] };

const KIND_FORMAT: Partial<Record<FieldStructure["kind"], string>> = {
  date: "A date",
  email: "An email address, like name@example.com",
  tel: "A phone number",
  number: "A number",
};

/** The format a field expects, in plain words, from what the page itself says: placeholder, pattern, then kind. */
export function basicFormat(f: FieldStructure): string | undefined {
  if (f.placeholder) return f.placeholder;
  const digits = /^(?:\\d|\[0-9\])\{(\d+)(?:,(\d+))?\}$/.exec(f.pattern ?? "");
  if (digits) return digits[2] ? `${digits[1]} to ${digits[2]} digits` : `${digits[1]} digits`;
  return KIND_FORMAT[f.kind];
}

/** Steps with no AI: one per field, quoting the page's own label as written. Used when no model can build a wizard. */
export function basicWizard(s: FormStructure, readerLang: string): Wizard {
  return {
    fingerprint: s.fingerprint,
    readerLang,
    steps: s.fields.map((f): WizardStep => {
      const format = basicFormat(f);
      return {
        stepId: f.fieldId,
        fieldIds: [f.fieldId],
        question: `Fill in: "${f.label}"`,
        explanation: "This is the form's own label, as written on the page. Type what the form asks for.",
        ...(f.placeholder ? { example: f.placeholder } : {}),
        ...(format ? { expectedFormat: format } : {}),
      };
    }),
  };
}

type Origin = { kind: "ai"; meta: AiMeta } | { kind: "cache" } | { kind: "basic"; why: string };

/** The chip that says where the steps came from, when no AI ran for them. */
export function originChip(o: Exclude<Origin, { kind: "ai" }>): { text: string; title: string } {
  return o.kind === "cache"
    ? { text: "Saved guide (no AI used)", title: "Steps saved earlier for this same form. No AI ran now." }
    : { text: "No AI used", title: `${o.why} These steps use the form's own labels.` };
}

function modelNote(state: LocalModel["state"]): string {
  switch (state) {
    case "downloadable": return "Suggestions need the model on this device. Download it from the menu, or type your answers.";
    case "downloading": return "The model on this device is still downloading. Suggestions will work when it is ready.";
    case "checking": return "Checking whether suggestions can run on this device.";
    default: return AI_WORDS["device-only"];
  }
}

interface Props {
  host: PageHost;
  settings: UserSettingsDoc;
  model: LocalModel;
  onShowOriginal: () => void;
  /** Told how many steps the guide has once it is built (0 when the page has no form): the sidebar's count. */
  onSteps?: (n: number) => void;
  /** Told the fields of the step on screen on every step change (empty when no step is on screen). */
  onStep?: (fieldIds: string[]) => void;
  /** Device-only storage for the guide's place and answers (sessionStorage on the web, chrome.storage.session in the
   *  extension). Without it the guide starts at step 1 every time it is built. */
  guideStore?: GuideStore;
  /** Bumped when the page was loaded again (a reload or a navigation): the guide is built again and restored. */
  reloadKey?: number;
  /** Bumped when the page changed in place: the guide keeps its place while the form is still the same one. */
  changeKey?: number;
}

/** Field kinds whose answer can sensibly move to the next page of a form. Ticks and choices are never carried. */
const CARRY_KINDS = new Set<FieldStructure["kind"]>(["text", "textarea", "email", "tel", "number", "date", "select"]);

/** The answers worth keeping by label for the next page of this form: typed answers to text-like fields. */
export function answersByLabel(fields: readonly FieldStructure[], values: FormValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.fieldId] ?? "").trim();
    const key = normLabel(f.label);
    if (v && key && CARRY_KINDS.has(f.kind)) out[key] = v;
  }
  return out;
}

/**
 * Answers from an earlier page of the same site for the fields of this form that have the same label and are still
 * empty. A select takes the answer only when it is one of its options.
 */
export function carryOver(fields: readonly FieldStructure[], byLabel: Record<string, string>, present: FormValues): FormValues {
  const out: FormValues = {};
  for (const f of fields) {
    if (!CARRY_KINDS.has(f.kind) || (present[f.fieldId] ?? "").trim()) continue;
    const v = byLabel[normLabel(f.label)];
    if (!v) continue;
    if (f.kind === "select" && !f.options?.some((o) => o.value === v)) continue;
    out[f.fieldId] = v;
  }
  return out;
}

const nonEmpty = (v: FormValues): FormValues => Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim() !== ""));

/** Why Next could not write a step's answers into the original form. */
export interface WriteProblem {
  fieldIds: string[];
  /** The page itself could not be reached (the tab moved on or closed), so nothing was written. */
  unreachable: boolean;
}

/** The words for a WriteProblem, naming each field by the label the page gives it. */
export function writeProblemText(p: WriteProblem, labelOf: (id: string) => string): string {
  const one = p.fieldIds.length === 1;
  const names = p.fieldIds.map((id) => `"${labelOf(id)}"`).join(", ");
  return p.unreachable
    ? `The original page could not be reached, so ${names} ${one ? "was" : "were"} not filled in. Please type ${one ? "it" : "them"} in the original form yourself.`
    : `Could not fill in ${names} on the original form: the page did not take ${one ? "the answer" : "these answers"}, or Distill could not confirm it did. Please fill ${one ? "it" : "them"} in there yourself.`;
}

/** Why there is no guide: the page has no fillable field, or the page could not be read at all. */
type NoForm = "none" | "unreadable";

/** The answer to a step as the person sees it on the stepper: option labels, "Yes" for a ticked box. Screen only. */
function shownAnswer(ids: string[], fields: Map<string, FieldStructure>, values: FormValues): string {
  return ids.map((id) => {
    const v = (values[id] ?? "").trim();
    const f = fields.get(id);
    if (!v || !f) return "";
    if (f.kind === "checkbox") return v === "false" ? "" : "Yes";
    return f.options?.find((o) => o.value === v)?.label ?? v;
  }).filter(Boolean).join(", ");
}

export function Wayfill({ host, settings, model, onShowOriginal, onSteps, onStep, guideStore, reloadKey = 0, changeKey = 0 }: Props) {
  const [phase, setPhase] = useState<"loading" | "noform" | "ready">("loading");
  const [noForm, setNoForm] = useState<NoForm>("none");
  const [structure, setStructure] = useState<FormStructure | null>(null);
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [idx, setIdx] = useState(0);
  const [values, setValues] = useState<FormValues>({});
  const [filled, setFilled] = useState<string[]>([]);
  const [problem, setProblem] = useState<WriteProblem | null>(null);
  const [remember, setRemember] = useState(false);
  const [profile, setProfile] = useState<FormValues>(() => loadProfile());
  const [aid, setAid] = useState<Record<string, { text: string; meta: AiMeta }>>({});
  /** fieldId -> the answer carried over from the previous page of this form (noted on screen until it is changed). */
  const [carried, setCarried] = useState<FormValues>({});
  /** The guide picked up where it was before a reload. */
  const [restored, setRestored] = useState(false);
  /** The form on the page is no longer the one this guide was built for. */
  const [changed, setChanged] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  /** Bumped by "Start again" (and by a change while there is nothing to keep) to build the guide afresh. */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setPhase("loading");
    (async () => {
      let s: FormStructure;
      try {
        s = await host.getForm(0);
      } catch (e) {
        if (!live) return;
        console.warn("[distill] no form:", e);
        setNoForm("unreadable");
        setPhase("noform");
        return;
      }
      // A page with no fillable field has nothing to guide: say so before any AI call, never an empty wizard.
      if (s.fields.length === 0) {
        if (!live) return;
        setNoForm("none");
        setPhase("noform");
        return;
      }
      const present = await host.readValues(s).catch(() => ({}) as FormValues);
      let w: Wizard | null = null;
      let o: Origin | null = null;
      let failure: unknown = null;
      try {
        const cached = isFirebaseConfigured() ? await getFormGuide(s.fingerprint).catch(() => null) : null;
        if (cached) {
          // The saved guide is earlier model output (and may be shared later), so it passes the same door as a fresh answer.
          const parsed = await engine.parseWizard(cached.wizard, s, settings.readerLang);
          if (parsed.steps.length) { w = parsed; o = { kind: "cache" }; }
        }
        if (!w && aiAvailable()) {
          const prompt = await engine.prompts.buildWizard(s, settings.readerLang);
          const r = await run<unknown>("buildWizard", prompt, engine.schemas.wizard, { structure: s, readerLang: settings.readerLang });
          const parsed = await engine.parseWizard(r.data, s, settings.readerLang);
          if (parsed.steps.length) {
            w = parsed;
            o = { kind: "ai", meta: { source: r.source, reason: r.reason, ms: r.ms } };
            void saveFormGuide(s, parsed).catch(() => undefined); // structure + wizard only, never values
          }
        }
      } catch (e) {
        failure = e; // fall through to the basic steps; run() already turned it into plain words
      }
      if (!w) {
        w = basicWizard(s, settings.readerLang);
        const aiOn = aiAvailable();
        o = { kind: "basic", why: failure !== null ? aiWords(failure) : aiOn ? "The AI could not build the steps this time." : "AI is off." };
      }
      // The place and answers kept for this same form (a reload); else answers carried over by label from the previous
      // page of this site's form. Both come from this device's own storage only.
      const kept = guideStore ? await guideStore.load(s.fingerprint).catch(() => null) : null;
      let carry: FormValues = {};
      if (guideStore && !kept) {
        const byLabel = await guideStore.load(labelsKey(s.url)).catch(() => null);
        if (byLabel) carry = carryOver(s.fields, byLabel.answers, present);
      }
      if (!live) return;
      const at = kept ? Math.min(kept.stepIndex, w.steps.length) : 0;
      // After a reload the page's fields are empty again: the answers of the steps already passed (the person pressed
      // Next for them) go back into the form, never over something the page holds now.
      const refilled: string[] = [];
      if (kept && at > 0) {
        const passed = new Set(w.steps.slice(0, at).flatMap((st) => st.fieldIds));
        const again: FormValues = {};
        for (const f of s.fields) {
          const v = kept.answers[f.fieldId] ?? "";
          if (!passed.has(f.fieldId) || f.kind === "file" || !v.trim() || v === "false") continue;
          const now = present[f.fieldId] ?? "";
          if (now === v) refilled.push(f.fieldId);
          else if (!now.trim()) again[f.fieldId] = v;
        }
        if (Object.keys(again).length) {
          const r = await host.writeValues(s, again).catch(() => null);
          if (r) refilled.push(...r.written);
        }
        if (!live) return;
        if (refilled.length) await host.highlight(refilled, accentColor()).catch(() => undefined);
        if (!live) return;
      }
      setStructure(s); setWizard(w); setOrigin(o); setFilled(refilled); setProblem(null);
      setValues(kept ? { ...present, ...nonEmpty(kept.answers) } : { ...present, ...carry });
      setIdx(at);
      setCarried(carry);
      setRestored(!!kept && (kept.stepIndex > 0 || Object.keys(nonEmpty(kept.answers)).length > 0));
      setChanged(false); setForgotten(false);
      setPhase("ready");
    })();
    return () => { live = false; };
    // The shell's guideStore is fixed for its life; a new store object must not rebuild the guide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, settings.readerLang, reloadKey, nonce]);

  // The page changed in place: the same form keeps the guide's place; another form (or none) offers to start again.
  const now = useRef({ phase, structure });
  now.current = { phase, structure };
  const seenChange = useRef(changeKey);
  useEffect(() => {
    if (seenChange.current === changeKey) return;
    seenChange.current = changeKey;
    const { phase: ph, structure: cur } = now.current;
    if (ph !== "ready" || !cur) { setNonce((n) => n + 1); return; } // nothing to keep: just read it again
    let on = true;
    host.getForm(0).then(
      (s) => { if (on) setChanged(s.fingerprint !== cur.fingerprint || s.fields.length === 0); },
      () => { if (on) setChanged(true); },
    );
    return () => { on = false; };
  }, [changeKey, host]);

  // Every step change (and every answer) is kept on this device, so a reload picks up here.
  useEffect(() => {
    if (phase !== "ready" || !structure || !guideStore) return;
    void guideStore.save(structure.fingerprint, { stepIndex: idx, answers: values }).catch(() => undefined);
  }, [phase, structure, idx, values, guideStore]);
  // On every step change, the answers by label, for the next page of this site's form.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  useEffect(() => {
    if (phase !== "ready" || !structure || !guideStore) return;
    const mine = answersByLabel(structure.fields, valuesRef.current);
    if (!Object.keys(mine).length) return;
    const key = labelsKey(structure.url);
    void guideStore.load(key)
      .then((kept) => guideStore.save(key, { stepIndex: 0, answers: { ...(kept?.answers ?? {}), ...mine } }))
      .catch(() => undefined);
  }, [phase, structure, idx, guideStore]);

  const steps = wizard?.steps ?? [];
  const step = steps[idx];
  // The parent's callbacks are read through refs, so a new callback identity never re-runs these effects.
  const report = useRef({ onSteps, onStep });
  report.current = { onSteps, onStep };
  useEffect(() => {
    if (phase === "noform") report.current.onSteps?.(0);
    else if (phase === "ready" && wizard) report.current.onSteps?.(wizard.steps.length);
  }, [phase, wizard]);
  const stepKey = phase === "ready" && step ? step.fieldIds.join("\u0000") : "";
  useEffect(() => { report.current.onStep?.(stepKey ? stepKey.split("\u0000") : []); }, [stepKey]);
  useEffect(() => {
    if (!structure || !wizard) return;
    setGuide({
      structure,
      wizard,
      advance: () => { const n = Math.min(idx + 1, wizard.steps.length - 1); setIdx(n); return wizard.steps[n] ?? null; },
    });
    return () => setGuide(null);
  }, [structure, wizard, idx]);
  const fields = useMemo(() => {
    const map = new Map<string, FieldStructure>();
    structure?.fields.forEach((f) => map.set(f.fieldId, f));
    return map;
  }, [structure]);

  if (phase === "loading") {
    return (
      <section aria-labelledby="wf-h" className="wayfill">
        <div className="ws-toolbar">
          <h2 id="wf-h" className="ws-tool-label">Fill a form</h2>
          <span role="status" className="muted">Reading the form and making the steps...</span>
        </div>
        <div className="ws-content"><WizardSkeleton /></div>
      </section>
    );
  }
  if (phase === "noform" || !structure || !wizard) {
    return (
      <div className="ws-content">
        <div className="ws-empty" role="status" data-testid="no-form" data-reason={noForm}>
          <h3>{noForm === "none" ? "There is no form to fill on this page" : "Distill could not read a form on this page"}</h3>
          <p>Open a page with a form to use the step-by-step guide. You can still read this page in the other views.</p>
        </div>
      </div>
    );
  }

  const finished = idx >= steps.length;
  const stepFields = (step?.fieldIds ?? []).map((id) => fields.get(id)).filter((f): f is FieldStructure => !!f);
  const missing = stepFields.filter((f) => f.required && f.kind !== "file" && !(values[f.fieldId] ?? "").trim());

  const go = (n: number) => { setProblem(null); setRestored(false); setIdx(n); };

  /** Writes the step's answers into the original form, and moves on only when every answer was written. */
  async function commit(skip: boolean) {
    if (!step || !structure) return;
    if (skip) { go(idx + 1); return; }
    const mine: FormValues = {};
    step.fieldIds.forEach((id) => { mine[id] = values[id] ?? ""; });
    if (remember) setProfile(rememberAnswers(mine));
    let res: { written: string[]; failed: string[] };
    try {
      res = await host.writeValues(structure, mine);
    } catch (e) {
      console.warn("[distill] could not write to the page:", e);
      setProblem({ fieldIds: step.fieldIds, unreachable: true }); // the typed answers stay in the step
      return;
    }
    const nextFilled = [...new Set([...filled, ...res.written.filter((id) => mine[id])])];
    setFilled(nextFilled);
    await host.highlight(nextFilled, accentColor()).catch(() => undefined);
    if (res.failed.length > 0) { setProblem({ fieldIds: res.failed, unreachable: false }); return; }
    go(idx + 1);
  }

  const setAidFor = (id: string, text: string, meta: AiMeta) => setAid((a) => ({ ...a, [id]: { text, meta } }));
  const NOT_RUN: AiMeta = { source: "on_device", reason: "Did not run", ms: 0 };

  async function suggest(f: FieldStructure) {
    if (!structure) return;
    try {
      const prompt = await engine.prompts.suggestValue(structure, f.fieldId, profile);
      const r = await run<string>("suggestValue", prompt, null, { structure, fieldId: f.fieldId });
      const raw = String(r.data).trim();
      const v = /^none.?$/i.test(raw) ? "" : raw;
      setAidFor(f.fieldId, v ? "Suggested from your saved answers. Please check it." : "No suggestion for this one.", { source: r.source, reason: r.reason, ms: r.ms });
      if (v) setValues((x) => ({ ...x, [f.fieldId]: v }));
    } catch (e) {
      setAidFor(f.fieldId, aiWords(e), NOT_RUN);
    }
  }

  async function check(f: FieldStructure) {
    if (!structure) return;
    try {
      const prompt = await engine.prompts.checkValue(structure, f.fieldId, values[f.fieldId] ?? "");
      const r = await run<{ ok?: boolean; message?: string }>("checkValue", prompt, CHECK_SCHEMA, { value: values[f.fieldId] ?? "" });
      setAidFor(f.fieldId, r.data.message ?? (r.data.ok ? "Looks right." : "Please check this."), { source: r.source, reason: r.reason, ms: r.ms });
    } catch (e) {
      setAidFor(f.fieldId, aiWords(e), NOT_RUN);
    }
  }

  /** "Forget my answers": the guide's kept answers for this form and this site go from this device. */
  async function forget() {
    if (!guideStore || !structure) return;
    await Promise.all([guideStore.clear(structure.fingerprint), guideStore.clear(labelsKey(structure.url))]).catch(() => undefined);
    setValues({}); setCarried({}); setRestored(false); setForgotten(true);
  }

  const localReady = model.state === "available";
  const hasProfile = Object.keys(profile).length > 0;
  const showOriginal = () => { void host.highlight(filled, accentColor()).then(onShowOriginal); };

  const answered = steps.filter((st) => st.fieldIds.some((id) => filled.includes(id))).length;
  const chip = (
    <>
      {origin?.kind === "ai" && <SourceChip meta={origin.meta} />}
      {origin && origin.kind !== "ai" && (
        <span className={origin.kind === "basic" ? "chip chip-basic" : "chip"} title={originChip(origin).title} data-testid="origin-chip">
          {originChip(origin).text}
        </span>
      )}
    </>
  );

  return (
    <section aria-labelledby="wf-h" className="wayfill">
      <div className="ws-toolbar">
        <h2 id="wf-h" className="ws-tool-label">{structure.title || "Form guide"}</h2>
        <span className="ws-grow" />
        <span className="muted" data-testid="wf-answered">{answered} of {steps.length} answered</span>
        {chip}
      </div>

      {changed && (
        <div className="notice" role="status" data-testid="form-changed">
          <p>This form changed on the page, so these steps may not fit it any more.</p>
          <div className="nav">
            <button type="button" className="btn btn-small btn-primary" onClick={() => { setChanged(false); setNonce((n) => n + 1); }}>Start again</button>
          </div>
        </div>
      )}
      {restored && !changed && (
        <p className="muted wf-saved" role="status" data-testid="wf-restored">
          Picked up where you left off. Your answers were kept on this device{filled.length ? ", and the ones you had filled in are back in the form" : ""}.
        </p>
      )}

      <div className="ws-content wf-grid ws-enter">
        <ol className="wf-steps" aria-label="Steps">
          {steps.map((st, i) => {
            const done = st.fieldIds.some((id) => filled.includes(id));
            const shown = done ? shownAnswer(st.fieldIds, fields, values) : "";
            const state = i === idx ? "current" : done ? "done" : i < idx ? "skipped" : "todo";
            return (
              <li key={st.stepId}>
                <button type="button" className={`wf-stepbtn ${state}`} aria-current={i === idx ? "step" : undefined} onClick={() => go(i)}>
                  <span className="wf-dot" aria-hidden="true">{done && i !== idx ? "" : i + 1}</span>
                  <span className="wf-q">
                    {st.question}
                    {state === "done" && <span className="visually-hidden"> (answered)</span>}
                    {state === "skipped" && <span className="visually-hidden"> (skipped)</span>}
                  </span>
                  {shown && <span className="wf-v">{shown}</span>}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="wf-main">
          {!finished && step && (
            <>
              <div className="wf-bar">
                <p className="progress-label" id="wf-progress-l">Step {idx + 1} of {steps.length}</p>
                <progress aria-labelledby="wf-progress-l" max={steps.length} value={idx + 1} />
              </div>
              <div className="card wf-card" data-testid="wf-step">
                <p className="wf-kick" aria-hidden="true">Step {idx + 1} of {steps.length}</p>
                <h3>{step.question}</h3>
                <p className="wf-expl">{step.explanation}</p>
                {(step.expectedFormat || step.example) && (
                  <p className="wf-fmt">
                    {step.expectedFormat && <span className="format"><strong>Format</strong> {step.expectedFormat}</span>}
                    {step.example && <span className="example"><strong>Example</strong> {step.example}</span>}
                  </p>
                )}

                <div className={stepFields.length > 1 ? "wf-fields cols" : "wf-fields"}>
                  {stepFields.map((f) => (
                    <div key={f.fieldId} className={f.kind === "textarea" || f.kind === "radio" || f.kind === "checkbox" ? "field wide" : "field"}>
                      <label htmlFor={`wf-${f.fieldId}`}>
                        {f.label}{f.required && <span className="req"> (required)</span>}
                        <span className="wf-orig"> label on the form</span>
                      </label>
                      {carried[f.fieldId] !== undefined && carried[f.fieldId] === values[f.fieldId] && (
                        <small className="muted" data-testid="carried-over">Carried over from the previous page. Check it, then press Next.</small>
                      )}
                      <FieldInput f={f} value={values[f.fieldId] ?? ""} onChange={(v) => setValues((x) => ({ ...x, [f.fieldId]: v }))} format={step.expectedFormat} />
                      {f.kind !== "file" && f.kind !== "checkbox" && (
                        <div className="field-tools">
                          {localReady ? (
                            <>
                              {hasProfile && <button type="button" className="btn btn-small" onClick={() => void suggest(f)}>Suggest from my saved answers</button>}
                              {(values[f.fieldId] ?? "").trim() && <button type="button" className="btn btn-small" onClick={() => void check(f)}>Check this answer</button>}
                            </>
                          ) : (
                            <small className="muted" data-testid="suggest-note">{modelNote(model.state)}</small>
                          )}
                          {aid[f.fieldId] && <span role="status">{aid[f.fieldId]?.text} <SourceChip meta={aid[f.fieldId]!.meta} /></span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {problem && (
                  <div className="notice notice-warn" role="alert" data-testid="write-problem">
                    <p>{writeProblemText(problem, (id) => fields.get(id)?.label || id)}</p>
                    <div className="nav">
                      <button type="button" className="btn btn-small" onClick={showOriginal}>Show original form</button>
                      {problem.unreachable && <button type="button" className="btn btn-small" onClick={() => void commit(false)}>Try again</button>}
                      <button type="button" className="btn btn-small btn-link" onClick={() => go(idx + 1)}>Go to the next step</button>
                    </div>
                  </div>
                )}
                {missing.length > 0 && <p className="muted wf-need">Fill in the required answer to continue, or skip this step.</p>}

                <label className="remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Remember my answers on this device only, to suggest them next time
                </label>

                <div className="nav">
                  <button type="button" className="btn" disabled={idx === 0} onClick={() => go(idx - 1)}>Back</button>
                  <span className="ws-grow" />
                  <button type="button" className="btn btn-link" onClick={() => void commit(true)}>Skip</button>
                  <button type="button" className="btn btn-primary" disabled={missing.length > 0} onClick={() => void commit(false)}>
                    {idx === steps.length - 1 ? "Finish" : "Next"}
                  </button>
                </div>
              </div>
            </>
          )}

          {finished && (
            <div className="card wf-card" data-testid="wf-done">
              <h3>All steps done</h3>
              <p>{filled.length} {filled.length === 1 ? "field was" : "fields were"} filled in on the original form. Look it over before you send it.</p>
              <div className="nav">
                <button type="button" className="btn" onClick={() => go(Math.max(steps.length - 1, 0))}>Back</button>
                <button type="button" className="btn btn-primary" onClick={showOriginal}>Show original form</button>
              </div>
            </div>
          )}

          {guideStore && (
            <p className="muted wf-saved" data-testid="wf-kept">
              {forgotten
                ? "Your answers to this form were forgotten on this device. What is already filled in on the page stays there."
                : "Your answers to this form are kept on this device until you close the tab, so a reload does not lose them."}
              {!forgotten && <>{" "}<button type="button" className="btn btn-link" onClick={() => void forget()}>Forget my answers</button></>}
            </p>
          )}
          {hasProfile && (
            <p className="muted wf-saved">
              {Object.keys(profile).length} saved answers are on this device only.{" "}
              <button type="button" className="btn btn-link" onClick={() => { clearProfile(); setProfile({}); }}>Delete them</button>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function FieldInput({ f, value, onChange, format }: { f: FieldStructure; value: string; onChange: (v: string) => void; format?: string }) {
  const id = `wf-${f.fieldId}`;
  const common = { id, "aria-required": f.required || undefined, "aria-describedby": format ? `${id}-fmt` : undefined } as const;
  const fmt = format ? <span id={`${id}-fmt`} className="visually-hidden">Format {format}</span> : null;
  switch (f.kind) {
    case "select":
      // A custom dropdown whose list the page has not shown yet has no options to offer: the answer is typed, and
      // Distill chooses the matching option in the page (or says it could not).
      if (!f.options?.length) break;
      return (
        <>
          <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose...</option>
            {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>{fmt}
        </>
      );
    case "radio":
      if (f.options?.length) {
        return (
          <div role="radiogroup" aria-labelledby={id}>
            {f.options.map((o) => (
              <label key={o.value} className="choice"><input type="radio" name={id} checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}</label>
            ))}
          </div>
        );
      }
      break;
    case "checkbox": {
      const on = f.options?.[0]?.value ?? "true";
      return <label className="choice"><input {...common} type="checkbox" checked={value !== "" && value !== "false"} onChange={(e) => onChange(e.target.checked ? on : "")} /> Yes</label>;
    }
    case "textarea":
      return <><textarea {...common} rows={4} value={value} onChange={(e) => onChange(e.target.value)} />{fmt}</>;
    case "file":
      return <p className="muted" id={id}>This field needs a file. Please choose it in the original form.</p>;
    default:
      break;
  }
  const type = f.kind === "email" ? "email" : f.kind === "tel" ? "tel" : "text";
  const inputMode = f.kind === "number" ? "numeric" : undefined;
  return <><input {...common} type={type} inputMode={inputMode} value={value} placeholder={format ?? f.placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="off" />{fmt}</>;
}
