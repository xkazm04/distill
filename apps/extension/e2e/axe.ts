// Spark round 5, r5-10: the accessibility check, axe-core in real Chromium.
// - The cleaned demo pages through @axe-core/playwright (AxeBuilder), with the strip's host element left out: the page
//   is the site's, read before and after Clean so Distill's changes can be compared with the page's own state.
// - The strip inside its frame: the caption.html extension page sits in a closed shadow root, where AxeBuilder's own
//   frame walk cannot reach, so the same axe-core build is put into that frame and run there (axeFrame).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Frame, Page } from "playwright/test";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export type Impact = "minor" | "moderate" | "serious" | "critical";
export interface Finding { id: string; impact: Impact; help: string; nodes: { target: string; summary: string }[] }

/** The WCAG 2.2 A and AA rules and axe's best practices. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * Rules that judge a whole document and do not apply to the strip's frame: it is one region of the host page, not a
 * page of its own (no h1 of its own, no main landmark; its content is the region). Each is still checked on the pages.
 */
const FRAME_DOCUMENT_RULES = ["landmark-one-main", "page-has-heading-one", "region", "bypass"];

interface AxeNode { target: unknown[]; failureSummary?: string }
interface AxeResult { id: string; impact?: string | null; help: string; nodes: AxeNode[] }

function shape(results: AxeResult[]): Finding[] {
  return results.map((r) => ({
    id: r.id,
    impact: (r.impact ?? "minor") as Impact,
    help: r.help,
    nodes: r.nodes.map((n) => ({ target: n.target.map(String).join(" > "), summary: (n.failureSummary ?? "").split("\n").slice(0, 3).join(" ") })),
  }));
}

/** axe on the strip's own document (the caption frame). */
export async function axeFrame(frame: Frame): Promise<Finding[]> {
  const has = await frame.evaluate(() => typeof (window as { axe?: unknown }).axe === "object");
  if (!has) await frame.evaluate(AXE_SOURCE);
  const res = await frame.evaluate(async ({ tags, off }) => {
    const axe = (window as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: unknown[] }> } }).axe;
    const r = await axe.run(document, {
      runOnly: { type: "tag", values: tags },
      rules: Object.fromEntries(off.map((id) => [id, { enabled: false }])),
      resultTypes: ["violations"],
    });
    return r.violations;
  }, { tags: TAGS, off: FRAME_DOCUMENT_RULES });
  return shape(res as AxeResult[]);
}

/** axe on the page itself, the strip left out. */
export async function axePage(page: Page): Promise<Finding[]> {
  const r = await new AxeBuilder({ page }).withTags(TAGS).exclude("distill-caption").analyze();
  return shape(r.violations as unknown as AxeResult[]);
}

/** Counts by impact: rules and the elements they flag. */
export function tally(findings: Finding[]): Record<Impact, { rules: number; nodes: number }> {
  const out: Record<Impact, { rules: number; nodes: number }> = {
    critical: { rules: 0, nodes: 0 }, serious: { rules: 0, nodes: 0 }, moderate: { rules: 0, nodes: 0 }, minor: { rules: 0, nodes: 0 },
  };
  for (const f of findings) { out[f.impact].rules++; out[f.impact].nodes += f.nodes.length; }
  return out;
}

export const severe = (findings: Finding[]) => findings.filter((f) => f.impact === "serious" || f.impact === "critical");

/** A short readable list for an assertion message. */
export const describe = (findings: Finding[]) =>
  findings.map((f) => `${f.impact} ${f.id} (${f.help}): ${f.nodes.slice(0, 4).map((n) => `${n.target} [${n.summary}]`).join("; ")}`).join("\n");

/** Elements per rule, for comparing a page before and after Clean. */
export const perRule = (findings: Finding[]) => Object.fromEntries(findings.map((f) => [f.id, f.nodes.length]));
