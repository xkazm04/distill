import { useEffect, useState } from "react";
import type { Block, PageModel, UserSettingsDoc } from "@distill/engine";
import { run } from "../ai";
import { isFirebaseConfigured } from "../firebase";
import { engine } from "./engine";
import { SourceChip, type AiMeta } from "./chips";

type Simplified = Record<string, string>;

/** Accepts the shapes a model plausibly returns: [{id,text}], {blocks:[{id,text}]} or {id: text}. Unknown ids are ignored. */
export function parseSimplified(data: unknown, blocks: Block[]): Simplified {
  const ids = new Set(blocks.map((b) => b.id));
  const out: Simplified = {};
  const list = Array.isArray(data) ? data : Array.isArray((data as { blocks?: unknown })?.blocks) ? (data as { blocks: unknown[] }).blocks : null;
  if (list) {
    for (const item of list) {
      const { id, text } = (item ?? {}) as { id?: unknown; text?: unknown };
      if (typeof id === "string" && typeof text === "string" && ids.has(id)) out[id] = text;
    }
  } else if (data && typeof data === "object") {
    for (const [id, text] of Object.entries(data)) if (typeof text === "string" && ids.has(id)) out[id] = text;
  }
  return out;
}

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
  const [error, setError] = useState<string | null>(null);

  const level = settings.readingLevel;
  const canAi = isFirebaseConfigured() || import.meta.env.DEV;

  useEffect(() => {
    setSimple({});
    setMeta(null);
    setError(null);
    if (level === "original" || !canAi || page.blocks.length === 0) return;
    let live = true;
    setBusy(true);
    (async () => {
      try {
        const prompt = await engine.prompts.simplifyBlocks(page, level, settings.readerLang);
        const r = await run<unknown>("simplifyBlocks", prompt, null, { page });
        if (!live) return;
        let data: unknown = r.data;
        if (typeof data === "string") {
          try { data = JSON.parse(data.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { data = {}; }
        }
        setSimple(parseSimplified(data, page.blocks));
        setMeta({ source: r.source, reason: r.reason, ms: r.ms });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => { live = false; };
  }, [page, level, settings.readerLang, canAi]);

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
      {error && <p className="notice notice-warn" role="alert">{error} Showing the page as written.</p>}

      <article className="reading" lang={page.lang}>
        <h2 className="page-title">{page.title}</h2>
        {page.blocks.length === 0 && <p>No readable text was found on this page.</p>}
        {page.blocks.map((b) => <BlockView key={b.id} block={b} text={simple[b.id] ?? b.text} />)}
      </article>
    </section>
  );
}
