// `npm run guides:drift [-- <id>...]`: re-reads each guide's official form and reports every guide whose fingerprint no
// longer matches, with the fields that are new, changed or gone. A web guide is read at each of its addresses, a PDF
// guide from its officialFormUrl. The demo guide is skipped (its form is in this repository). Uses the network, so it
// is not part of `npm run check`.
//
// A fingerprint is made of the labels the reader produces, so it changes when the form changes and also when the
// reader's rules change. Each guide records the reader's version (match.reader) and a digest of the source it read
// (match.source), so drift says which it is:
// - "the reader changed, the form did not": the source is the same file; refresh the field list with
//   `npm run guide:new -- --refresh <id>`, which keeps the steps and the status;
// - "the form changed": the source differs; follow the drift steps in guides/README.md;
// - "cannot tell": the guide recorded no source; a refresh records it (and returns a reviewed guide to draft).
//
// It also re-reads the official instructions each guide quotes (its instructionsUrl and every step's official.url) and
// looks for every official quote word for word (the engine's verifyQuotes, as `npm run guides:review` does). An
// authority can rewrite its instructions while the form stays the same: a quote no longer found prints a line naming
// the guide and the step, and the guide's steps must be checked against the new text (a reviewed guide goes back to
// draft until a person has). Drift never edits a guide.
//
// Exit 0: nothing drifted (or only the reader changed); 1: a form changed or cannot be told, or a quote is no longer in
// the instructions; 2: a form or the instructions could not be read.
// `--dir <folder>` checks another folder laid out like guides/, and `--source <address>=<file>` (repeatable) reads a
// local copy in place of an address: for trying drift without the network, and for its tests.
import { GUIDES_DIR, readGuideFiles } from "./library.mjs";
import { engine, readForm } from "./read-form.mjs";
import { checkQuotes, stepsOf, takeSourceMap } from "./quotes.mjs";

const args = process.argv.slice(2);
const sourceMap = takeSourceMap(args);
const dirAt = args.indexOf("--dir");
const guidesDir = dirAt >= 0 ? args.splice(dirAt, 2)[1] : GUIDES_DIR;
const only = args;
const { matchGuide, parseGuide } = await engine();
let drifted = 0;
let readerOnly = 0;
let unreadable = 0;
let quotesGone = 0;

for (const f of readGuideFiles(guidesDir)) {
  if (only.length && !only.includes(f.id)) continue;
  const { guide, problems } = parseGuide(f.json, { id: f.id });
  if (!guide) { console.log(`?  ${f.id}: does not pass check-guides (${problems[0]}); fix that first`); unreadable++; continue; }
  if (guide.demo) { console.log(`-  ${f.id}: demo guide, skipped`); continue; }
  const sources = guide.match.format === "pdf" ? [guide.officialFormUrl] : guide.match.urls;
  for (const source of sources) {
    let r;
    try {
      const local = sourceMap.get(source);
      r = await readForm(local ?? source, { as: local && guide.match.format === "html" ? source : undefined });
    } catch (e) {
      console.log(`?  ${f.id}: ${source} could not be read: ${e.message}`);
      unreadable++;
      continue;
    }
    const sameFile = typeof guide.match.source === "string" && guide.match.source === r.source;
    const readers = `reader ${guide.match.reader ?? "(not recorded)"} then, ${r.reader} now`;
    if (!r.structure) {
      console.log(`!  ${f.id}: ${source} can no longer be filled: ${r.problem?.title ?? "no form found"} (${sameFile ? "the same file: the reader changed" : readers})`);
      drifted++;
      continue;
    }
    const s = r.structure;
    if (guide.match.fingerprints.includes(s.fingerprint)) {
      console.log(`ok ${f.id}: ${source} matches${guide.match.source === undefined ? " (no source recorded: npm run guide:new -- --refresh " + f.id + " records it)" : ""}`);
      continue;
    }
    // Compare field by field, as the app does, with drafts on so every guide is compared.
    const m = matchGuide(s, [guide], { drafts: true });
    const theirs = new Set(guide.match.fields.map((x) => x.fieldId));
    const same = new Set(m?.same ?? []);
    const gone = [...theirs].filter((id) => !same.has(id) && !s.fields.some((x) => x.fieldId === id));
    const changed = s.fields.filter((x) => !same.has(x.fieldId));
    if (m?.exact) { console.log(`ok ${f.id}: ${source} has the same fields (labels differ only in spacing or case); add fingerprint ${s.fingerprint}`); continue; }
    if (sameFile) {
      readerOnly++;
      console.log(`~  ${f.id}: ${source} is the same file the guide was read from; the reader changed, the form did not (${readers}).`);
      console.log(`   refresh the field list with: npm run guide:new -- --refresh ${f.id}   (keeps the steps and the status)`);
    } else {
      drifted++;
      const why = typeof guide.match.source === "string"
        ? "the form changed (the file differs from the one the guide was read from)"
        : "it cannot be told whether the form or the reader changed: the guide recorded no source";
      console.log(`!  ${f.id}: ${source}: ${why}; ${readers} (fingerprint ${s.fingerprint.slice(0, 12)}...)`);
      console.log(`   ${m ? `the app still uses the guide for ${m.same.length} unchanged fields (overlap ${m.overlap.toFixed(2)})` : "the app no longer uses this guide for it (overlap below 0.5, or the title or address changed)"}`);
    }
    for (const x of changed) console.log(`   ${theirs.has(x.fieldId) ? "changed" : "new    "} ${x.fieldId} [${x.kind}] ${JSON.stringify(x.label)}`);
    for (const id of gone) console.log(`   gone    ${id}`);
    if (r.format === "pdf" && s.title && !(guide.match.titles ?? []).includes(s.title)) console.log(`   title now reads ${JSON.stringify(s.title)}`);
  }
  // The instructions the guide quotes, and every quote in them.
  const { sources: read, quotes } = await checkQuotes(guide, sourceMap);
  for (const src of read) {
    if (!src.read) { console.log(`?  ${f.id}: instructions ${src.url} could not be read: ${src.error}`); unreadable++; }
  }
  const gone = quotes.filter((q) => q.verdict.verdict === "not_found");
  for (const q of gone) {
    console.log(`!  ${f.id}: ${stepsOf(q)}: the quoted sentence is no longer in ${q.url}: ${JSON.stringify(q.text)}`);
  }
  if (gone.length) {
    quotesGone += gone.length;
    console.log(`   check those steps against the instructions as published now; ${guide.status === "reviewed" ? "the guide goes back to draft until a person has (see guides/README.md, Drift)" : "the guide is a draft"}`);
  }
  const found = quotes.filter((q) => q.verdict.verdict === "found").length;
  if (quotes.length && found === quotes.length) console.log(`ok ${f.id}: instructions hold all ${quotes.length} quote(s) word for word`);
}
console.log(`guides:drift: ${drifted} drifted or cannot be told, ${readerOnly} read differently by a newer reader only, ${quotesGone} quote(s) no longer in the instructions, ${unreadable} could not be read`);
process.exit(unreadable ? 2 : drifted || quotesGone ? 1 : 0);
