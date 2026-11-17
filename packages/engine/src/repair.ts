import type { RecastNode, RecastNodeKind, RepairResult } from "./types.js";
import { MAX_ITEMS, capReasons, cleanText, hasScriptUrl, isObj } from "./sanitize.js";

export const NODE_KINDS: readonly RecastNodeKind[] = ["summary", "keyFacts", "steps", "checklist", "comparison", "timeline", "callout"];
export const MAX_NODES = 12;
const TONES = ["info", "warning", "deadline"] as const;

/** Non-empty cleaned strings from an array, capped; non-strings are skipped. */
function strings(v: unknown, max = MAX_ITEMS): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = cleanText(x);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function pairs<K extends string>(v: unknown, a: K, b: K): Record<K, string>[] {
  if (!Array.isArray(v)) return [];
  const out: Record<K, string>[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const l = cleanText(x[a]);
    const r = cleanText(x[b]);
    if (l && r) out.push({ [a]: l, [b]: r } as Record<K, string>);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function build(raw: unknown, enabled: ReadonlySet<string>): { node: RecastNode } | { reason: string } {
  if (!isObj(raw)) return { reason: "it was not a section" };
  const kind = raw.kind;
  if (typeof kind !== "string" || !(NODE_KINDS as readonly string[]).includes(kind)) {
    return { reason: `"${typeof kind === "string" ? cleanText(kind, 40) : "?"}" is not a section type we can show` };
  }
  if (!enabled.has(kind)) return { reason: `"${kind}" sections are turned off` };
  if (hasScriptUrl(raw)) return { reason: "it contained a script link" };

  const ids = Array.isArray(raw.sourceBlockIds)
    ? [...new Set(raw.sourceBlockIds.filter((x): x is string => typeof x === "string" && /^b\d{1,6}$/.test(x)))].slice(0, MAX_ITEMS)
    : [];
  const node: RecastNode = { kind: kind as RecastNodeKind, sourceBlockIds: ids };
  const title = cleanText(raw.title);
  if (title) node.title = title;

  switch (kind as RecastNodeKind) {
    case "summary":
    case "callout": {
      const text = cleanText(raw.text);
      if (!text) return { reason: `"${kind}" had no text` };
      node.text = text;
      if (kind === "callout" && typeof raw.tone === "string" && (TONES as readonly string[]).includes(raw.tone)) node.tone = raw.tone as RecastNode["tone"];
      break;
    }
    case "keyFacts": {
      const facts = pairs(raw.facts, "label", "value");
      if (!facts.length) return { reason: "key facts had no usable facts" };
      node.facts = facts;
      break;
    }
    case "steps":
    case "checklist": {
      const items = strings(raw.items);
      if (!items.length) return { reason: `"${kind}" had no items` };
      node.items = items;
      break;
    }
    case "comparison": {
      const columns = strings(raw.columns);
      if (columns.length < 2) return { reason: "a comparison needs at least two columns" };
      const rows: string[][] = [];
      if (Array.isArray(raw.rows)) {
        for (const r of raw.rows) {
          if (!Array.isArray(r) || r.length === 0 || r.some((c) => typeof c !== "string")) continue;
          const cells = r.map((c) => cleanText(c) ?? "");
          while (cells.length < columns.length) cells.push("");
          rows.push(cells.slice(0, columns.length));
          if (rows.length >= MAX_ITEMS) break;
        }
      }
      if (!rows.length) return { reason: "a comparison had no usable rows" };
      node.columns = columns;
      node.rows = rows;
      break;
    }
    case "timeline": {
      const events = pairs(raw.events, "when", "what");
      if (!events.length) return { reason: "a timeline had no usable events" };
      node.events = events;
      break;
    }
  }
  if (hasScriptUrl(node)) return { reason: "it contained a script link" };
  return { node };
}

/** The one door for Recast specs. Keeps what validates, drops and counts the rest; never throws. */
export function validateAndRepair(candidate: unknown, enabledKinds?: readonly string[]): RepairResult {
  const enabled = new Set<string>(enabledKinds ?? NODE_KINDS);
  let list: unknown[];
  if (Array.isArray(candidate)) list = candidate;
  else if (isObj(candidate) && Array.isArray(candidate.nodes)) list = candidate.nodes;
  else return { nodes: [], dropped: 1, reasons: ["The result was not a layout we could read"] };

  const nodes: RecastNode[] = [];
  const reasons: string[] = [];
  let dropped = 0;
  list.forEach((raw, i) => {
    const r = build(raw, enabled);
    if ("reason" in r) {
      dropped++;
      reasons.push(`Section ${i + 1}: ${r.reason}`);
    } else if (nodes.length >= MAX_NODES) {
      dropped++;
      reasons.push(`Section ${i + 1}: more than ${MAX_NODES} sections, so the rest were left out`);
    } else nodes.push(r.node);
  });
  return { nodes, dropped, reasons: capReasons(reasons) };
}
