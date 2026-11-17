import { useEffect, useState, type ReactNode } from "react";
import type { PageModel, RecastNode, RepairResult } from "@distill/engine";
import { run } from "../ai";
import { isFirebaseConfigured } from "../firebase";
import { enabledRecastKinds } from "./config";
import { engine } from "./engine";
import { AiProblem, SourceChip, type AiMeta } from "./chips";

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

// ---- the built layout, kept per page ------------------------------------------------------------------------------
// Switching tabs unmounts Recast. The last layout for the same page is kept here, so coming back shows it again with no
// second AI call; only "Rebuild the layout" asks the model again. Model output only (it passed validateAndRepair), never
// a person's values.

interface Built { repair: RepairResult; meta: AiMeta }

const CACHE_SIZE = 20;
const built = new Map<string, Built>();

/** FNV-1a over the blocks, so the same URL with changed content is a different page. */
function contentHash(page: PageModel): string {
  let h = 0x811c9dc5;
  for (const b of page.blocks) {
    const s = JSON.stringify([b.id, b.kind, b.level ?? 0, b.text, b.rows ?? []]);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export const layoutKey = (page: PageModel): string => `${page.url}#${contentHash(page)}`;

function remember(key: string, entry: Built): void {
  built.delete(key);
  built.set(key, entry);
  while (built.size > CACHE_SIZE) built.delete(built.keys().next().value as string);
}

/** Tests only: forget every kept layout. */
export function forgetLayouts(): void {
  built.clear();
}

interface Props {
  page: PageModel;
  enabled: boolean;
  /** The focus view, shown when no node survives or the AI is off. */
  fallback: ReactNode;
  onSource: (blockId: string) => void;
}

export function Recast({ page, enabled, fallback, onSource }: Props) {
  const key = layoutKey(page);
  const [repair, setRepair] = useState<RepairResult | null>(() => built.get(key)?.repair ?? null);
  const [meta, setMeta] = useState<AiMeta | null>(() => built.get(key)?.meta ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Bumped by "Try again" and by "Rebuild the layout" (which first forgets the kept layout), to build again. */
  const [attempt, setAttempt] = useState(0);
  const canAi = isFirebaseConfigured() || import.meta.env.DEV;

  useEffect(() => {
    setError(null);
    const kept = built.get(key);
    if (kept) {
      setRepair(kept.repair); setMeta(kept.meta);
      return;
    }
    setRepair(null); setMeta(null);
    if (!enabled || !canAi || page.blocks.length === 0) return;
    let live = true;
    setBusy(true);
    (async () => {
      try {
        const kinds = await enabledRecastKinds();
        const prompt = await engine.prompts.recast(page, kinds);
        const r = await run<unknown>("recast", prompt, engine.schemas.recast, { page });
        const fixed = await engine.validateAndRepair(r.data, kinds); // the ONE door
        const m: AiMeta = { source: r.source, reason: r.reason, ms: r.ms };
        remember(key, { repair: fixed, meta: m });
        if (!live) return;
        setRepair(fixed);
        setMeta(m);
      } catch (e) {
        if (live) setError(e);
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => { live = false; };
    // `page` is covered by `key` (its url and content); a new object for the same page reuses the kept layout.
  }, [key, enabled, canAi, attempt]);

  const rebuild = () => { built.delete(key); setAttempt((n) => n + 1); };
  const rebuildButton = (
    <button type="button" className="btn btn-small" onClick={rebuild} data-testid="recast-rebuild">Rebuild the layout</button>
  );

  if (!enabled) return <><p className="notice" role="status">The new layout is switched off in your settings. Here is the focus view.</p>{fallback}</>;
  if (!canAi) return <><p className="notice" role="status" data-testid="recast-off">A new layout needs AI, which is off here. Here is the focus view.</p>{fallback}</>;
  if (busy) return <p role="status">Building a clearer layout...</p>;
  if (error !== null) return <><AiProblem error={error} after="Here is the focus view instead." onRetry={() => setAttempt((n) => n + 1)} />{fallback}</>;
  if (!repair) return null;
  if (repair.nodes.length === 0) {
    return (
      <>
        <p className="notice" role="status" data-testid="recast-fallback">
          Nothing could be shown in the new layout ({repair.dropped} could not be displayed), so here is the focus view.{" "}
          {rebuildButton}
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
        {rebuildButton}
      </div>
      {repair.dropped > 0 && repair.reasons.length > 0 && (
        <details><summary>Why some sections were left out</summary><ul>{repair.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>
      )}
      {repair.nodes.map((node, i) => <NodeView key={i} node={node} onSource={onSource} />)}
    </section>
  );
}
