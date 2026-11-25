// The quote check shared by `npm run guides:review` and `npm run guides:drift`: every official quote of a guide, looked
// for word for word in the instructions it cites (the engine's verifyQuotes over the source read by readInstructions).
// A found quote proves only that the words are in the source; whether a step agrees with them is a person's judgement.
import { engine, readInstructions } from "./read-form.mjs";

/**
 * `--source <https address>=<local file>` (repeatable) read a local copy in place of an address: for trying the tools
 * without the network, and for their tests. Removes the flags from `args` and returns the map.
 */
export function takeSourceMap(args) {
  const map = new Map();
  for (let i = args.indexOf("--source"); i >= 0; i = args.indexOf("--source")) {
    const [pair] = args.splice(i, 2).slice(1);
    const at = (pair ?? "").indexOf("=");
    if (at <= 0) throw new Error(`--source wants <address>=<file>, got ${JSON.stringify(pair)}`);
    map.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return map;
}

/**
 * The guide's quotes, one entry per distinct (address, text): { url, text, lang, steps: [{ stepId, langs }] }. A quote
 * is at `official.url`, else at the guide's `instructionsUrl`. The same quote in the English and the Ukrainian step is
 * one entry naming both languages.
 */
export function guideQuotes(guide) {
  const out = [];
  for (const lang of Object.keys(guide.wizards)) {
    for (const st of guide.wizards[lang].steps) {
      if (!st.official) continue;
      const url = st.official.url ?? guide.instructionsUrl;
      let q = out.find((x) => x.url === url && x.text === st.official.text);
      if (!q) out.push(q = { url, text: st.official.text, lang: st.official.lang, steps: [] });
      let s = q.steps.find((x) => x.stepId === st.stepId);
      if (!s) q.steps.push(s = { stepId: st.stepId, langs: [] });
      s.langs.push(lang);
    }
  }
  return out;
}

/** "step name (en, uk)" for a quote's steps. */
export const stepsOf = (q) => q.steps.map((s) => `step ${s.stepId} (${s.langs.join(", ")})`).join(", ");

/**
 * Reads every source the guide's quotes cite, and its instructionsUrl even when no quote cites it, and checks each
 * quote. Returns { sources: [{ url, read: boolean, error, title, blocks }], quotes: [{ ...quote, verdict }] }, where a
 * verdict is the engine's QuoteVerdict ("found" with blockId and context, "not_found", or "unreadable").
 */
export async function checkQuotes(guide, sourceMap = new Map()) {
  const { verifyQuotes } = await engine();
  const quotes = guideQuotes(guide);
  const urls = [...new Set([guide.instructionsUrl, ...quotes.map((q) => q.url)])];
  const sources = [];
  for (const url of urls) {
    try {
      const r = await readInstructions(sourceMap.get(url) ?? url);
      const text = r.blocks.some((b) => b.text.trim());
      sources.push({ url, read: text, error: text ? null : "no text could be read from it (a scanned PDF, or a page that needs its scripts)", title: r.title, blocks: r.blocks });
    } catch (e) {
      sources.push({ url, read: false, error: e?.message ?? String(e), title: "", blocks: null });
    }
  }
  const out = quotes.map((q) => {
    const src = sources.find((s) => s.url === q.url);
    const [verdict] = verifyQuotes(src?.read ? src.blocks : null, [q.text]);
    return { ...q, verdict };
  });
  return { sources, quotes: out };
}
