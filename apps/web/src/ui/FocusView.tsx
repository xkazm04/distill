import { useEffect, useState } from "react";
import type { Block, PageModel, UserSettingsDoc } from "@distill/engine";
import { run } from "../ai";
import { isFirebaseConfigured } from "../firebase";
import { engine } from "./engine";
import { AiProblem, SourceChip, type AiMeta } from "./chips";

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

export function BlockView({ block, text }: { block: Block; text: string }) {
  const id = `block-${block.id}`;
  switch (block.kind) {
    case "heading": {
      const level = Math.min(Math.max(block.level ?? 2, 1), 6);
      const Tag = `h${Math.min(level + 1, 6)}` as "h2";
      return <Tag id={id}>{text}</Tag>;
    }
    case "list":
      return <ul id={id}>{text.split("\n").map((t, i) => <li key={i}>{t}</li>)}</ul>;
    case "quote":
      return <blockquote id={id}>{text}</blockquote>;
    case "code":
      return <pre id={id}><code>{text}</code></pre>;
    case "image":
      // The renderer never fetches an image: it shows the alt text only.
      return <p id={id} className="image-alt">Picture: {text || "no description"}</p>;
    case "table":
      return (
        <div id={id} className="table-wrap">
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
      return <p id={id}>{text}</p>;
  }
}

interface Props {
  page: PageModel;
  settings: UserSettingsDoc;
  onSettings: (s: UserSettingsDoc) => void;
  scrollToBlock?: string | null;
}

const LEVELS: { value: UserSettingsDoc["readingLevel"]; label: string; hint: string }[] = [
  { value: "plain", label: "Plain", hint: "Shortest and simplest words" },
  { value: "standard", label: "Standard", hint: "Clear and complete" },
  { value: "original", label: "As written", hint: "The page text with no changes" },
];

export function FocusView({ page, settings, onSettings, scrollToBlock }: Props) {
  const [simple, setSimple] = useState<Simplified>({});
  const [meta, setMeta] = useState<AiMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** The model answered, but nothing in the answer could be used. */
  const [nothing, setNothing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const level = settings.readingLevel;
  const canAi = isFirebaseConfigured() || import.meta.env.DEV;

  useEffect(() => {
    setSimple({});
    setMeta(null);
    setError(null);
    setNothing(false);
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
        if (Object.keys(parsed).length === 0 && hasProse(page.blocks)) setNothing(true);
        else setMeta({ source: r.source, reason: r.reason, ms: r.ms });
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

  return (
    <section aria-labelledby="focus-h">
      <h2 id="focus-h" className="visually-hidden">Focus view</h2>
      <fieldset className="levels">
        <legend>Reading level</legend>
        {LEVELS.map((l) => (
          <label key={l.value} className={settings.readingLevel === l.value ? "on" : ""}>
            <input type="radio" name="level" value={l.value} checked={settings.readingLevel === l.value}
              onChange={() => onSettings({ ...settings, readingLevel: l.value })} />
            <span>{l.label}</span><small>{l.hint}</small>
          </label>
        ))}
      </fieldset>

      <div className="result-meta">
        {busy && <span role="status">Making this easier to read...</span>}
        {meta && <SourceChip meta={meta} />}
        {level !== "original" && !canAi && <span role="status">AI is off, so this is the page text as written.</span>}
      </div>
      {error !== null && <AiProblem error={error} after="Showing the page as written." onRetry={() => setAttempt((n) => n + 1)} />}
      {nothing && (
        <p className="notice" role="status" data-testid="simplify-nothing">
          Could not simplify this time. Showing the page as written.{" "}
          <button type="button" className="btn btn-small" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </p>
      )}

      <article className="reading" lang={page.lang}>
        <h2 className="page-title">{page.title}</h2>
        {page.blocks.length === 0 && <p>No readable text was found on this page.</p>}
        {page.blocks.map((b) => <BlockView key={b.id} block={b} text={simple[b.id] ?? b.text} />)}
      </article>
    </section>
  );
}
