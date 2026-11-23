// r3-03: runs the strip's page tasks on saved copies of real pages, through the strip's own code paths, and records
// what happened. Nothing here is a second implementation: Clean's reading is page.ts readForClean, the main text is
// claims.ts readMainText and translate.ts textBlocks/plainBlocks, the calls are Translate.tsx runTranslate, runTask
// (claims, gist, plain words) and ClaimCheck.tsx checkClaim (runGrounded), with the real prompts and the real doors
// (parseTranslation, parseClaims, parseGist, parsePlain, parseCheck, entryPointOf). The fixture document stands in for
// the page: it sits in a same-origin, script-free frame of the proof page, where the page-side modules read and change
// it as they would a tab's page.
import { topClaims, type InferenceSource } from "@distill/engine";
import { toAiError } from "@distill/web/ai";
import type { CleanContext } from "../caption/context";
import { hideRemoved, readForClean } from "../caption/page";
import { applyPlain, applyTranslation, plainBlocks, textBlocks } from "../caption/translate";
import { readMainText } from "../caption/claims";
import type { CleanReport, TextBlock } from "../messages";
import { addressOnly, AUTO_TOP, checkClaim } from "../caption/frame/ClaimCheck";
import { claimCandidates, pickClaims } from "../caption/frame/Claims";
import { gistOf } from "../caption/frame/Gist";
import { articleLike, firstPart } from "../caption/frame/mainText";
import { plainRun, runPlain } from "../caption/frame/Plain";
import { overallSource, readerLang, runTranslate, shortReason, translateBlocks, wantsTranslation } from "../caption/frame/Translate";
import type { FixtureResult, ProofTask, TaskError, TaskResult } from "./report";

export interface Fixture { id: string; url: string; title: string; lang: string; savedOn: string; html: string }

/** Puts a fixture's HTML into a document the page-side modules can read (the proof page's frame). */
export type Mount = (f: Fixture) => Promise<{ doc: Document; win: Window }>;

/** How many sample items of an answer the report keeps (the counts are always whole). */
const SAMPLE = 3;

export function errorOf(e: unknown): TaskError {
  const err = toAiError(e);
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return { kind: err.kind, words: shortReason(e), raw: raw.slice(0, 400) };
}

/** Times one task; an exception becomes a failed result with the error in plain words and raw. */
async function timed(task: ProofTask, body: () => Promise<Omit<TaskResult, "task" | "ms">>): Promise<TaskResult> {
  const t0 = performance.now();
  try {
    const r = await body();
    return { task, ...r, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { task, status: "failed", calls: 1, dropped: 0, error: errorOf(e), ms: Math.round(performance.now() - t0) };
  }
}

const skipped = (task: ProofTask, note: string): TaskResult => ({ task, status: "skipped", note, ms: 0, calls: 0, dropped: 0 });

/** Every task on one fixture, in the strip's order: Clean, Translate, then claims and the gist on the main text as the
 *  page shows it, plain words, and the web check of the top claims (AUTO_TOP, as the strip checks them by itself). */
export async function runFixture(f: Fixture, mount: Mount, opts: { canRun: boolean; onTask?: (r: TaskResult) => void; onSuggestions?: (html: string) => void }): Promise<FixtureResult> {
  const tasks: TaskResult[] = [];
  const done = (r: TaskResult) => { tasks.push(r); opts.onTask?.(r); return r; };
  const { doc, win } = await mount(f);

  const c0 = performance.now();
  const read = readForClean(doc, win);
  hideRemoved(read.removed);
  const visible = (el: Element) => !el.closest("[data-distill-hide]");
  const ctx: CleanContext = {
    doc, win, keep: read.keep.filter(visible), body: read.body.filter(visible), main: read.main, protect: read.protect, removed: read.removed,
  };
  const report: Pick<CleanReport, "kind" | "lang"> = { kind: read.page.kind, lang: read.lang };
  const cleanMs = Math.round(performance.now() - c0);
  const noModel = "no model can answer in this copy of Distill";

  // 1. Translate, when the page is not in the reader's language (the strip starts it by itself then).
  let translatedTo: string | undefined;
  if (!wantsTranslation(report)) done(skipped("translate", `the page is in the reader's language (${readerLang()})`));
  else if (!opts.canRun) done(skipped("translate", noModel));
  else {
    done(await timed("translate", async () => {
      const blocks = textBlocks(ctx);
      if (!blocks.length) return { status: "skipped", note: "no main text to translate", calls: 0, dropped: 0 };
      const from = (report.lang.split("-")[0] ?? "und").toLowerCase();
      const to = readerLang();
      const sample: { id: string; source: string; text: string }[] = [];
      let calls = 0;
      const r = await translateBlocks(blocks, from, to, (p, b) => { calls++; return runTranslate(p, b); }, async (b: TextBlock[]) => {
        for (const x of b) if (sample.length < SAMPLE) sample.push({ id: x.id, source: blocks.find((s) => s.id === x.id)?.text ?? "", text: x.text });
        return applyTranslation(b);
      });
      if (r.translated) translatedTo = to;
      return {
        status: r.translated ? "ok" : "failed", source: r.source, ...(r.via ? { via: r.via } : {}), calls, dropped: r.dropped,
        answer: { from, to, translated: r.translated, total: r.total, sample },
        ...(r.translated ? {} : { error: { kind: "door", words: "the AI's answer could not be used", raw: "" } }),
        ...(r.error ? { error: errorOf(r.error) } : {}),
      };
    }));
  }

  // 2-3. Claims and the gist read the main text as the page shows it now (translated where Translate ran).
  const blocks = readMainText(ctx);
  const article = articleLike(report, blocks);
  const notArticle = `not an article (a ${report.kind} page, ${blocks.length} blocks of main text)`;
  let claims: Awaited<ReturnType<typeof pickClaims>>["pick"]["claims"] = [];
  if (!article) done(skipped("claims", notArticle));
  else {
    const candidates = claimCandidates(blocks);
    if (!candidates.length) done(skipped("claims", "the engine found no sentence worth checking"));
    else if (!opts.canRun) done(skipped("claims", noModel));
    else {
      done(await timed("claims", async () => {
        const { pick, r } = await pickClaims(candidates);
        claims = pick.claims;
        return {
          status: "ok", source: r.source, ...(r.via ? { via: r.via } : {}), calls: 1, dropped: pick.dropped,
          answer: { candidates: candidates.length, claims: pick.claims.map((c) => ({ text: c.text, why: c.why })) },
        };
      }));
    }
  }
  if (!article) done(skipped("gist", notArticle));
  else if (!opts.canRun) done(skipped("gist", noModel));
  else {
    done(await timed("gist", async () => {
      const { g, r } = await gistOf(firstPart(blocks));
      return {
        status: g.points.length ? "ok" : "failed", source: r.source, ...(r.via ? { via: r.via } : {}), calls: 1, dropped: g.dropped,
        answer: { points: g.points.map((p) => p.text), from: g.points.map((p) => p.sentence) },
        ...(g.points.length ? {} : { error: { kind: "door", words: "the AI's answer could not be used", raw: "" } }),
      };
    }));
  }

  // 4. Plain words (the strip offers it on a press): the blocks as the page shows them, in their language.
  if (!opts.canRun) done(skipped("plain", noModel));
  else {
    done(await timed("plain", async () => {
      const todo = plainBlocks(ctx);
      if (!todo.length) return { status: "skipped", note: "no block long enough for plain words", calls: 0, dropped: 0 };
      const lang = translatedTo ?? (report.lang.split("-")[0] ?? "und").toLowerCase();
      const sample: { id: string; text: string }[] = [];
      let calls = 0;
      const r = await plainRun(todo, lang, (p, b) => { calls++; return runPlain(p, b); }, async (b: TextBlock[]) => {
        for (const x of b) if (sample.length < SAMPLE) sample.push({ id: x.id, text: x.text });
        return applyPlain(b);
      });
      return {
        status: r.applied ? "ok" : "failed", source: r.source, ...(r.via ? { via: r.via } : {}), calls, dropped: r.dropped + r.lostFacts,
        answer: { lang, applied: r.applied, total: r.total, lostFacts: r.lostFacts, lostKinds: r.lostKinds, sample },
        ...(r.applied ? {} : { error: { kind: "door", words: "no rewrite kept every fact", raw: "" } }),
        ...(r.error ? { error: errorOf(r.error) } : {}),
      };
    }));
  }

  // 5. The web check of the top claims, one after the other (cloud, Google Search grounding).
  if (!claims.length) done(skipped("check", "no claims to check on this page"));
  else if (!opts.canRun) done(skipped("check", noModel));
  else {
    done(await timed("check", async () => {
      const page = { title: doc.title, url: addressOnly(f.url) };
      const checks: unknown[] = [];
      const sources: InferenceSource[] = [];
      let dropped = 0;
      let failed = 0;
      let lastError: TaskError | undefined;
      for (const claim of topClaims(claims, AUTO_TOP)) {
        try {
          const r = await checkClaim(claim, page);
          sources.push(r.source);
          if (r.entry !== undefined) opts.onSuggestions?.(r.entry); // r4-03: shown on the proof page in the strip's sealed frame
          dropped += r.dropped;
          checks.push({
            claim: claim.text, ms: r.ms, source: r.source, dropped: r.dropped,
            ...(r.check ? { verdict: r.check.verdict, reason: r.check.reason, sources: r.check.sources } : { verdict: undefined, note: "the AI's answer could not be used" }),
            suggestions: r.entry !== undefined, ...(r.entry !== undefined ? { suggestionsChars: r.entry.length } : {}),
          });
          if (!r.check) failed++;
        } catch (e) {
          failed++;
          lastError = errorOf(e);
          checks.push({ claim: claim.text, error: lastError });
        }
      }
      const n = Math.min(claims.length, AUTO_TOP);
      const src = overallSource(sources);
      return {
        status: failed === n ? "failed" : "ok", ...(src ? { source: src } : {}), calls: n, dropped,
        answer: { checks }, ...(lastError ? { error: lastError } : {}),
      };
    }));
  }

  return {
    id: f.id, url: f.url, title: f.title, savedOn: f.savedOn,
    clean: { kind: report.kind, lang: report.lang, removed: read.removed.size, blocks: blocks.length, ms: cleanMs },
    tasks,
  };
}
