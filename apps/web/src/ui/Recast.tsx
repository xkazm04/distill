import { useEffect, useState, type ReactNode } from "react";
import type { PageModel, RecastNode, RepairResult } from "@distill/engine";
import { run } from "../ai";
import { isFirebaseConfigured } from "../firebase";
import { enabledRecastKinds } from "./config";
import { engine } from "./engine";
import { SourceChip, type AiMeta } from "./chips";

/** One component per kind of the closed vocabulary. Text goes in as React text: never HTML. */
export function NodeView({ node, onSource }: { node: RecastNode; onSource: (blockId: string) => void }) {
  const sources = node.sourceBlockIds.length > 0 && (
    <p className="sources">
      From the page:{" "}
      {node.sourceBlockIds.map((id) => (
        <button key={id} type="button" className="btn btn-link" onClick={() => onSource(id)}>show in page</button>
      )).slice(0, 1)}
    </p>
  );
  let body: ReactNode;
  switch (node.kind) {
    case "summary":
      body = <p>{node.text}</p>;
      break;
    case "keyFacts":
      body = <dl className="facts">{(node.facts ?? []).map((f, i) => <div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>;
      break;
    case "steps":
      body = <ol>{(node.items ?? []).map((t, i) => <li key={i}>{t}</li>)}</ol>;
      break;
    case "checklist":
      body = <ul className="checklist">{(node.items ?? []).map((t, i) => <li key={i}><label><input type="checkbox" /> {t}</label></li>)}</ul>;
      break;
    case "comparison": {
      const cols = node.columns ?? [];
      body = (
        <div className="table-wrap">
          <table>
            <thead><tr>{cols.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
            <tbody>{(node.rows ?? []).map((r, ri) => <tr key={ri}>{r.map((c, ci) => (ci === 0 ? <th key={ci} scope="row">{c}</th> : <td key={ci}>{c}</td>))}</tr>)}</tbody>
          </table>
        </div>
      );
      break;
    }
    case "timeline":
      body = <ol className="timeline">{(node.events ?? []).map((e, i) => <li key={i}><strong>{e.when}</strong> {e.what}</li>)}</ol>;
      break;
    case "callout":
      body = <p>{node.text}</p>;
      break;
  }
  const tone = node.kind === "callout" ? `callout-${node.tone ?? "info"}` : "";
  return (
    <section className={`node node-${node.kind} ${tone}`} data-kind={node.kind}>
      {node.title && <h3>{node.title}</h3>}
      {node.kind === "callout" && <p className="tone-label">{node.tone === "deadline" ? "Deadline" : node.tone === "warning" ? "Warning" : "Note"}</p>}
      {body}
      {sources}
    </section>
  );
}

interface Props {
  page: PageModel;
  enabled: boolean;
  /** The focus view, shown when no node survives or the AI is off. */
  fallback: ReactNode;
  onSource: (blockId: string) => void;
}

export function Recast({ page, enabled, fallback, onSource }: Props) {
  const [repair, setRepair] = useState<RepairResult | null>(null);
  const [meta, setMeta] = useState<AiMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAi = isFirebaseConfigured() || import.meta.env.DEV;

  useEffect(() => {
    setRepair(null); setMeta(null); setError(null);
    if (!enabled || !canAi || page.blocks.length === 0) return;
    let live = true;
    setBusy(true);
    (async () => {
      try {
        const kinds = await enabledRecastKinds();
        const prompt = await engine.prompts.recast(page, kinds);
        const r = await run<unknown>("recast", prompt, engine.schemas.recast, { page });
        const fixed = await engine.validateAndRepair(r.data, kinds); // the ONE door
        if (!live) return;
        setRepair(fixed);
        setMeta({ source: r.source, reason: r.reason, ms: r.ms });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => { live = false; };
  }, [page, enabled, canAi]);

  if (!enabled) return <><p className="notice" role="status">The new layout is switched off in your settings. Here is the focus view.</p>{fallback}</>;
  if (!canAi) return <><p className="notice" role="status" data-testid="recast-off">A new layout needs AI, which is off here. Here is the focus view.</p>{fallback}</>;
  if (busy) return <p role="status">Building a clearer layout...</p>;
  if (error) return <><p className="notice notice-warn" role="alert">{error} Here is the focus view instead.</p>{fallback}</>;
  if (!repair) return null;
  if (repair.nodes.length === 0) {
    return (
      <>
        <p className="notice" role="status" data-testid="recast-fallback">
          Nothing could be shown in the new layout ({repair.dropped} could not be displayed), so here is the focus view.
        </p>
        {fallback}
      </>
    );
  }
  const n = repair.nodes.length;
  return (
    <section aria-labelledby="rc-h" className="recast">
      <h2 id="rc-h" className="visually-hidden">New layout</h2>
      <div className="result-meta">
        {meta && <SourceChip meta={meta} />}
        <span data-testid="recast-count">
          {n} {n === 1 ? "section" : "sections"} shown{repair.dropped > 0 ? `, ${repair.dropped} could not be displayed` : ""}
        </span>
      </div>
      {repair.dropped > 0 && repair.reasons.length > 0 && (
        <details><summary>Why some sections were left out</summary><ul>{repair.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>
      )}
      {repair.nodes.map((node, i) => <NodeView key={i} node={node} onSource={onSource} />)}
    </section>
  );
}
