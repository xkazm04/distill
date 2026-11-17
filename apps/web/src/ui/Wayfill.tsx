import { useEffect, useMemo, useState } from "react";
import type { FieldStructure, FormStructure, FormValues, UserSettingsDoc, Wizard, WizardStep } from "@distill/engine";
import { run } from "../ai";
import { isFirebaseConfigured } from "../firebase";
import { getFormGuide, saveFormGuide } from "./data";
import { engine } from "./engine";
import { setGuide } from "./guide";
import { clearProfile, loadProfile, rememberAnswers } from "./profile";
import { SourceChip, type AiMeta } from "./chips";
import type { PageHost } from "./host";
import type { LocalModel } from "./useLocalModel";

type Origin = { kind: "ai"; meta: AiMeta } | { kind: "cache" } | { kind: "basic"; why: string };

const CHECK_SCHEMA = { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" } }, required: ["ok", "message"] };

/** Steps with no AI: one per field, using the page's own labels. Used when no model can build a real wizard. */
export function basicWizard(s: FormStructure, readerLang: string): Wizard {
  return {
    fingerprint: s.fingerprint,
    readerLang,
    steps: s.fields.map((f): WizardStep => ({
      stepId: f.fieldId,
      fieldIds: [f.fieldId],
      question: f.label,
      explanation: f.hint ?? (f.required ? "The form needs this answer." : "You can leave this empty."),
      ...(f.placeholder ? { example: f.placeholder, expectedFormat: f.placeholder } : {}),
    })),
  };
}

function modelNote(state: LocalModel["state"]): string {
  switch (state) {
    case "downloadable": return "Suggestions need the model on this device. Download it from the top of the page, or type your answers.";
    case "downloading": return "The model on this device is still downloading. Suggestions will work when it is ready.";
    case "checking": return "Checking whether suggestions can run on this device.";
    default: return "Suggestions and checks only run on this device, and this device has no model for them. Type your answers instead.";
  }
}

interface Props {
  host: PageHost;
  settings: UserSettingsDoc;
  model: LocalModel;
  onShowOriginal: () => void;
}

export function Wayfill({ host, settings, model, onShowOriginal }: Props) {
  const [phase, setPhase] = useState<"loading" | "noform" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [structure, setStructure] = useState<FormStructure | null>(null);
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [idx, setIdx] = useState(0);
  const [values, setValues] = useState<FormValues>({});
  const [filled, setFilled] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [remember, setRemember] = useState(false);
  const [profile, setProfile] = useState<FormValues>(() => loadProfile());
  const [aid, setAid] = useState<Record<string, { text: string; meta: AiMeta }>>({});

  useEffect(() => {
    let live = true;
    setPhase("loading");
    setError(null);
    (async () => {
      let s: FormStructure;
      try {
        s = await host.getForm(0);
      } catch (e) {
        if (!live) return;
        setError(e instanceof Error ? e.message : null);
        setPhase("noform");
        return;
      }
      const present = await host.readValues(s).catch(() => ({}) as FormValues);
      let w: Wizard | null = null;
      let o: Origin | null = null;
      try {
        const cached = isFirebaseConfigured() ? await getFormGuide(s.fingerprint).catch(() => null) : null;
        if (cached) {
          // The cache is shared between people, so it passes the same door as a fresh model answer.
          const parsed = await engine.parseWizard(cached.wizard, s, settings.readerLang);
          if (parsed.steps.length) { w = parsed; o = { kind: "cache" }; }
        }
        if (!w && (isFirebaseConfigured() || import.meta.env.DEV)) {
          const prompt = await engine.prompts.buildWizard(s, settings.readerLang);
          const r = await run<unknown>("buildWizard", prompt, engine.schemas.wizard, { structure: s });
          const parsed = await engine.parseWizard(r.data, s, settings.readerLang);
          if (parsed.steps.length) {
            w = parsed;
            o = { kind: "ai", meta: { source: r.source, reason: r.reason, ms: r.ms } };
            void saveFormGuide(s, parsed).catch(() => undefined); // structure + wizard only, never values
          }
        }
      } catch {
        /* fall through to the basic steps */
      }
      if (!w) {
        w = basicWizard(s, settings.readerLang);
        o = { kind: "basic", why: isFirebaseConfigured() ? "The AI could not build the steps this time." : "AI is off." };
      }
      if (!live) return;
      setStructure(s); setWizard(w); setOrigin(o); setValues(present); setIdx(0); setFilled([]); setFailed([]);
      setPhase("ready");
    })();
    return () => { live = false; };
  }, [host, settings.readerLang]);

  const steps = wizard?.steps ?? [];
  const step = steps[idx];
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

  if (phase === "loading") return <p role="status">Reading the form...</p>;
  if (phase === "noform" || !structure || !wizard) {
    return <p className="notice" role="status" data-testid="no-form">{error ?? "This page has no form to fill."} Open a page with a form to use the step-by-step guide.</p>;
  }

  const finished = idx >= steps.length;
  const stepFields = (step?.fieldIds ?? []).map((id) => fields.get(id)).filter((f): f is FieldStructure => !!f);
  const missing = stepFields.filter((f) => f.required && f.kind !== "file" && !(values[f.fieldId] ?? "").trim());

  async function commit(skip: boolean) {
    if (!step || !structure) return;
    if (!skip) {
      const mine: FormValues = {};
      step.fieldIds.forEach((id) => { mine[id] = values[id] ?? ""; });
      const res = await host.writeValues(structure, mine);
      const nextFilled = [...new Set([...filled, ...res.written.filter((id) => mine[id])])];
      setFilled(nextFilled);
      setFailed(res.failed);
      await host.highlight(nextFilled);
      if (remember) setProfile(rememberAnswers(mine));
    }
    setIdx(idx + 1);
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
      setAidFor(f.fieldId, e instanceof Error ? e.message : "No suggestion.", NOT_RUN);
    }
  }

  async function check(f: FieldStructure) {
    if (!structure) return;
    try {
      const prompt = await engine.prompts.checkValue(structure, f.fieldId, values[f.fieldId] ?? "");
      const r = await run<{ ok?: boolean; message?: string }>("checkValue", prompt, CHECK_SCHEMA, { value: values[f.fieldId] ?? "" });
      setAidFor(f.fieldId, r.data.message ?? (r.data.ok ? "Looks right." : "Please check this."), { source: r.source, reason: r.reason, ms: r.ms });
    } catch (e) {
      setAidFor(f.fieldId, e instanceof Error ? e.message : "Could not check.", NOT_RUN);
    }
  }

  const localReady = model.state === "available";
  const hasProfile = Object.keys(profile).length > 0;
  const showOriginal = () => { void host.highlight(filled).then(onShowOriginal); };

  return (
    <section aria-labelledby="wf-h" className="wayfill">
      <div className="wf-head">
        <h2 id="wf-h">{structure.title || "Form guide"}</h2>
        <button type="button" className="btn" onClick={showOriginal} data-testid="show-original-form">Show original form</button>
      </div>
      <div className="result-meta">
        {origin?.kind === "ai" && <SourceChip meta={origin.meta} />}
        {origin?.kind === "cache" && <span className="chip" title="Steps saved earlier for this same form. No AI ran now.">Saved guide (no AI used)</span>}
        {origin?.kind === "basic" && <span className="chip chip-basic" title={origin.why}>Basic steps. {origin.why}</span>}
      </div>

      {!finished && step && (
        <>
          <p className="progress-label" id="wf-progress-l">Step {idx + 1} of {steps.length}</p>
          <progress aria-labelledby="wf-progress-l" max={steps.length} value={idx + 1} />
          <div className="card" data-testid="wf-step">
            <h3>{step.question}</h3>
            <p>{step.explanation}</p>
            {step.example && <p className="example"><strong>Example:</strong> {step.example}</p>}
            {step.expectedFormat && <p className="format"><strong>Format:</strong> {step.expectedFormat}</p>}

            {stepFields.map((f) => (
              <div key={f.fieldId} className="field">
                <label htmlFor={`wf-${f.fieldId}`}>{f.label}{f.required && <span className="req"> (required)</span>}</label>
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
            {failed.length > 0 && (
              <p className="notice notice-warn" role="alert">
                Could not fill: {failed.map((id) => fields.get(id)?.label ?? id).join(", ")}. Please type it in the original form.
              </p>
            )}
            {missing.length > 0 && <p className="muted">Fill in the required answer to continue, or skip this step.</p>}
          </div>

          <label className="remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember my answers on this device only, to suggest them next time
          </label>

          <div className="nav">
            <button type="button" className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Back</button>
            <button type="button" className="btn btn-link" onClick={() => void commit(true)}>Skip</button>
            <button type="button" className="btn btn-primary" disabled={missing.length > 0} onClick={() => void commit(false)}>
              {idx === steps.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </>
      )}

      {finished && (
        <div className="card" data-testid="wf-done">
          <h3>All steps done</h3>
          <p>{filled.length} {filled.length === 1 ? "field was" : "fields were"} filled in on the original form. Look it over before you send it.</p>
          <div className="nav">
            <button type="button" className="btn" onClick={() => setIdx(Math.max(steps.length - 1, 0))}>Back</button>
            <button type="button" className="btn btn-primary" onClick={showOriginal}>Show original form</button>
          </div>
        </div>
      )}

      {hasProfile && (
        <p className="muted">
          {Object.keys(profile).length} saved answers are on this device only.{" "}
          <button type="button" className="btn btn-link" onClick={() => { clearProfile(); setProfile({}); }}>Delete them</button>
        </p>
      )}
    </section>
  );
}

function FieldInput({ f, value, onChange, format }: { f: FieldStructure; value: string; onChange: (v: string) => void; format?: string }) {
  const id = `wf-${f.fieldId}`;
  const common = { id, "aria-required": f.required || undefined, "aria-describedby": format ? `${id}-fmt` : undefined } as const;
  const fmt = format ? <span id={`${id}-fmt`} className="visually-hidden">Format {format}</span> : null;
  switch (f.kind) {
    case "select":
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
