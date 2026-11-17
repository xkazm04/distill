import { useEffect, useState, type ReactNode } from "react";
import type { PageModel, RecastNode, RepairResult } from "@distill/engine";
import { aiAvailable, run } from "../ai";
import { useAgentActive } from "./agentQueue";
import { enabledRecastKinds } from "./config";
import { engine } from "./engine";
import { AiProblem, SourceChip, type AiMeta } from "./chips";
import { enter, LayoutSkeleton } from "./loading";

/** The first words of a block, to name it on a "From the page" link. */
export function blockSnippet(text: string | undefined, words = 6): string {
  const all = (text ?? "").split("\n")[0]?.trim().split(/\s+/).filter(Boolean) ?? [];
  return all.length > words ? `${all.slice(0, words).join(" ")}...` : all.join(" ");
}

/** Kinds that need the full width of the layout grid. */
const WIDE = new Set<RecastNode["kind"]>(["comparison", "keyFacts"]);

/** One component per kind of the closed vocabulary. Text goes in as React text: never HTML. */
export function NodeView({ node, onSource, textOf, i = 0 }: { node: RecastNode; onSource: (blockId: string) => void; textOf?: (blockId: string) => string | undefined; i?: number }) {
  const sources = node.sourceBlockIds.length > 0 && (
    <p className="sources">
      <span>From the page:</span>
      {node.sourceBlockIds.slice(0, 3).map((id) => {
        const words = blockSnippet(textOf?.(id));
        return (
          <button key={id} type="button" className="src" onClick={() => onSource(id)} title="Show where this is in the page">
            {words || "show in page"}
          </button>
        );
      })}
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
  const kindName = node.kind === "callout" ? (node.tone === "deadline" ? "Deadline" : node.tone === "warning" ? "Warning" : "Note") : KIND_NAMES[node.kind];
  return (
    <section className={`node node-${node.kind} ${tone}${WIDE.has(node.kind) ? " node-wide" : ""}`} data-kind={node.kind} style={enter(i)}>
      <p className="tone-label">{kindName}</p>
      {node.title && <h3>{node.title}</h3>}
      {body}
      {sources}
    </section>
  );
}

const KIND_NAMES: Record<RecastNode["kind"], string> = {
  summary: "Summary", keyFacts: "Key facts", steps: "Steps", checklist: "Checklist", comparison: "Comparison",
  timeline: "Timeline", callout: "Note",
};

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

/** How many sections the kept layout of this page has, or null when none was built yet. */
export function keptSections(page: PageModel): number | null {
  return built.get(layoutKey(page))?.repair.nodes.length ?? null;
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
  /** Told how many sections are shown once a layout is built or found kept (the sidebar's count). */
  onSections?: (n: number) => void;
}

export function Recast({ page, enabled, fallback, onSource, onSections }: Props) {
  const key = layoutKey(page);
  const [repair, setRepair] = useState<RepairResult | null>(() => built.get(key)?.repair ?? null);
  const [meta, setMeta] = useState<AiMeta | null>(() => built.get(key)?.meta ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Bumped by "Try again" and by "Rebuild the layout" (which first forgets the kept layout), to build again. */
  const [attempt, setAttempt] = useState(0);
  const canAi = aiAvailable(useAgentActive());

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
        const r = await run<unknown>("recast", prompt, engine.schemas.recast, { page, kinds });
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

  useEffect(() => { if (repair) onSections?.(repair.nodes.length); }, [repair, onSections]);

  const rebuild = () => { built.delete(key); setAttempt((n) => n + 1); };
  const rebuildButton = (
    <button type="button" className="btn btn-small" onClick={rebuild} data-testid="recast-rebuild">Rebuild the layout</button>
  );

  const note = (n: ReactNode) => <div className="ws-content">{n}</div>;
  if (!enabled) return <>{note(<p className="notice" role="status">The new layout is switched off in your settings. Here is the focus view.</p>)}{fallback}</>;
  if (!canAi) return <>{note(<p className="notice" role="status" data-testid="recast-off">A new layout needs AI, which is off here. Here is the focus view.</p>)}{fallback}</>;
  if (busy) {
    return (
      <section aria-labelledby="rc-h" className="recast">
        <div className="ws-toolbar">
          <h2 id="rc-h" className="ws-tool-label">New layout</h2>
          <span role="status" className="muted">Building a clearer layout...</span>
        </div>
        <div className="ws-content"><LayoutSkeleton /></div>
      </section>
    );
  }
  if (error !== null) return <>{note(<AiProblem error={error} after="Here is the focus view instead." onRetry={() => setAttempt((n) => n + 1)} />)}{fallback}</>;
  if (!repair) return null;
  if (repair.nodes.length === 0) {
    return (
      <>
        {note(
          <p className="notice" role="status" data-testid="recast-fallback">
            Nothing could be shown in the new layout ({repair.dropped} could not be displayed), so here is the focus view.{" "}
            {rebuildButton}
          </p>,
        )}
        {fallback}
      </>
    );
  }
  const n = repair.nodes.length;
  const texts = new Map(page.blocks.map((b) => [b.id, b.text]));
  return (
    <section aria-labelledby="rc-h" className="recast">
      <div className="ws-toolbar">
        <h2 id="rc-h" className="ws-tool-label">New layout</h2>
        <span data-testid="recast-count">
          {n} {n === 1 ? "section" : "sections"} built from the page{repair.dropped > 0 ? `, ${repair.dropped} could not be displayed` : ""}
        </span>
        <span className="ws-grow" />
        {rebuildButton}
        {meta && <SourceChip meta={meta} />}
      </div>
      <div className="ws-content">
        {repair.dropped > 0 && repair.reasons.length > 0 && (
          <details className="ws-why"><summary>Why some sections were left out</summary><ul>{repair.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>
        )}
        <div className="layout-grid ws-enter">
          {repair.nodes.map((node, i) => <NodeView key={i} node={node} onSource={onSource} textOf={(id) => texts.get(id)} i={i} />)}
        </div>
      </div>
    </section>
  );
}
