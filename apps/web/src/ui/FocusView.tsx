import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import type { Block, PageModel, UserSettingsDoc } from "@distill/engine";
import { run } from "../ai";
import { isFirebaseConfigured } from "../firebase";
import { engine } from "./engine";
import { AiProblem, SourceChip, type AiMeta } from "./chips";
import { BlocksSkeleton, enter } from "./loading";

type Simplified = Record<string, string>;

/** Reads schemas.simplify ({blocks:[{id,text}]}) and the shapes a model plausibly returns anyway: [{id,text}] or
 *  {id: text}. Unknown ids and empty texts are ignored. */
export function parseSimplified(data: unknown, blocks: Block[]): Simplified {
  const ids = new Set(blocks.map((b) => b.id));
  const out: Simplified = {};
  const list = Array.isArray(data) ? data : Array.isArray((data as { blocks?: unknown })?.blocks) ? (data as { blocks: unknown[] }).blocks : null;
  if (list) {
    for (const item of list) {
      const { id, text } = (item ?? {}) as { id?: unknown; text?: unknown };
      if (typeof id === "string" && typeof text === "string" && text.trim() && ids.has(id)) out[id] = text;
    }
  } else if (data && typeof data === "object") {
    for (const [id, text] of Object.entries(data)) if (typeof text === "string" && text.trim() && ids.has(id)) out[id] = text;
  }
  return out;
}

/** Whether a page has text the simplify prompt is meant to rewrite (paragraphs and lists). */
export const hasProse = (blocks: Block[]): boolean => blocks.some((b) => b.kind === "paragraph" || b.kind === "list");

/** `locatable`: the original is beside the view, so each block takes keyboard focus to point at its source. */
/** `i`: the block's place on the page, for the staggered entrance. */
export function BlockView({ block, text, locatable, i = 0 }: { block: Block; text: string; locatable?: boolean; i?: number }) {
  const a = { id: `block-${block.id}`, "data-block": block.id, tabIndex: locatable ? 0 : undefined, style: enter(i) };
  switch (block.kind) {
    case "heading": {
      const level = Math.min(Math.max(block.level ?? 2, 1), 6);
      const Tag = `h${Math.min(level + 1, 6)}` as "h2";
      return <Tag {...a}>{text}</Tag>;
    }
    case "list":
      return <ul {...a}>{text.split("\n").map((t, i) => <li key={i}>{t}</li>)}</ul>;
    case "quote":
      return <blockquote {...a}>{text}</blockquote>;
    case "code":
      return <pre {...a}><code>{text}</code></pre>;
    case "image":
      // The renderer never fetches an image: it shows the alt text only.
      return <p {...a} className="image-alt">Picture: {text || "no description"}</p>;
    case "table":
      return (
        <div {...a} className="table-wrap">
          <table>
            <tbody>
              {(block.rows ?? []).map((row, r) => (
                <tr key={r}>{row.map((cell, c) => (r === 0 ? <th key={c} scope="col">{cell}</th> : <td key={c}>{cell}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return <p {...a}>{text}</p>;
  }
}

interface Props {
  page: PageModel;
  settings: UserSettingsDoc;
  onSettings: (s: UserSettingsDoc) => void;
  scrollToBlock?: string | null;
  /** Present only while the original is beside: the block the person points at or focuses, null when they leave. */
  onLocate?: (blockId: string | null) => void;
}

const LEVELS: { value: UserSettingsDoc["readingLevel"]; label: string; hint: string }[] = [
  { value: "plain", label: "Plain", hint: "Shortest and simplest words" },
  { value: "standard", label: "Standard", hint: "Clear and complete" },
  { value: "original", label: "As written", hint: "The page text with no changes" },
];

export function FocusView({ page, settings, onSettings, scrollToBlock, onLocate }: Props) {
  const [simple, setSimple] = useState<Simplified>({});
  const [meta, setMeta] = useState<AiMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** The model answered, but nothing in the answer could be used. */
  const [nothing, setNothing] = useState(false);
  /** The model answered in shape with an empty list: every block was already plain enough. A success, not a failure. */
  const [alreadyPlain, setAlreadyPlain] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const level = settings.readingLevel;
  const canAi = isFirebaseConfigured() || import.meta.env.DEV;

  // A layout effect, so a new reading level shows its loading state in the same frame instead of the old text first.
  useLayoutEffect(() => {
    setSimple({});
    setMeta(null);
    setError(null);
    setNothing(false);
    setAlreadyPlain(false);
    if (level === "original" || !canAi || page.blocks.length === 0) return;
    let live = true;
    setBusy(true);
    (async () => {
      try {
        const prompt = await engine.prompts.simplifyBlocks(page, level, settings.readerLang);
        const r = await run<unknown>("simplifyBlocks", prompt, engine.schemas.simplify, { page });
        if (!live) return;
        const parsed = parseSimplified(r.data, page.blocks);
        setSimple(parsed);
        // An answer with nothing usable is not shown as a result: no source chip, a plain note instead.
        const answeredEmpty = Array.isArray((r.data as { blocks?: unknown })?.blocks) && (r.data as { blocks: unknown[] }).blocks.length === 0;
        if (Object.keys(parsed).length === 0 && hasProse(page.blocks) && !answeredEmpty) setNothing(true);
        else {
          setMeta({ source: r.source, reason: r.reason, ms: r.ms });
          if (answeredEmpty) setAlreadyPlain(true);
        }
      } catch (e) {
        if (live) setError(e);
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => { live = false; };
  }, [page, level, settings.readerLang, canAi, attempt]);

  useEffect(() => {
    if (scrollToBlock) document.getElementById(`block-${scrollToBlock}`)?.scrollIntoView({ block: "center" });
  }, [scrollToBlock]);

  // Pointing at the source while the original is beside: the block under the pointer or with focus, one call per
  // change, null when the person leaves the text.
  const pointed = useRef<string | null>(null);
  useEffect(() => { pointed.current = null; }, [onLocate]);
  const point = (id: string | null) => {
    if (!onLocate || id === pointed.current) return;
    pointed.current = id;
    onLocate(id);
  };
  const blockOf = (t: EventTarget | null): string | null =>
    t instanceof Element ? t.closest("[data-block]")?.getAttribute("data-block") ?? null : null;
  const locating = onLocate ? {
    onPointerOver: (e: PointerEvent) => point(blockOf(e.target)),
    onPointerLeave: () => point(null),
    onFocus: (e: FocusEvent) => point(blockOf(e.target)),
    onBlur: (e: FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) point(null); },
  } : {};

  const levelLabel = useId();
  const hint = LEVELS.find((l) => l.value === level)?.hint;

  return (
    <section aria-labelledby="focus-h" className="ws-read">
      <h2 id="focus-h" className="visually-hidden">Focus view</h2>
      <div className="ws-toolbar">
        <span className="ws-tool-label" id={levelLabel}>Reading level</span>
        <div className="seg levels" role="radiogroup" aria-labelledby={levelLabel}>
          {LEVELS.map((l) => (
            <label key={l.value} className={level === l.value ? "on" : ""} title={l.hint}>
              <input type="radio" className="visually-hidden" name="level" value={l.value} checked={level === l.value}
                onChange={() => onSettings({ ...settings, readingLevel: l.value })} />
              <span>{l.label}</span>
            </label>
          ))}
        </div>
        <span className="muted ws-hint">{hint}</span>
        <span className="ws-grow" />
        {busy && <span role="status" className="muted">Making this easier to read...</span>}
        {meta && <SourceChip meta={meta} />}
        {level !== "original" && !canAi && <span role="status" className="muted">AI is off, so this is the page text as written.</span>}
      </div>
      <div className="ws-content">
        {error !== null && <AiProblem error={error} after="Showing the page as written." onRetry={() => setAttempt((n) => n + 1)} />}
        {alreadyPlain && (
          <p className="notice" role="status" data-testid="simplify-already-plain">This page is already easy to read, so nothing was changed.</p>
        )}
        {nothing && (
          <p className="notice" role="status" data-testid="simplify-nothing">
            Could not simplify this time. Showing the page as written.{" "}
            <button type="button" className="btn btn-small" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </p>
        )}

        {busy ? (
          <div className="reading">
            <h2 className="page-title">{page.title}</h2>
            <BlocksSkeleton blocks={page.blocks} />
          </div>
        ) : (
          // Keyed by what is shown, so new text (another level, a fresh answer) enters instead of popping in.
          <article key={`${level}:${meta ? "ai" : "page"}`} className={onLocate ? "reading ws-enter locating" : "reading ws-enter"} lang={page.lang} {...locating}>
            <h2 className="page-title">{page.title}</h2>
            {page.blocks.length === 0 && <p>No readable text was found on this page.</p>}
            {page.blocks.map((b, i) => <BlockView key={b.id} block={b} text={simple[b.id] ?? b.text} locatable={!!onLocate} i={i + 1} />)}
          </article>
        )}
      </div>
    </section>
  );
}
