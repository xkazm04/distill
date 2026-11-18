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
// Exit 0: nothing drifted (or only the reader changed); 1: a form changed or cannot be told; 2: a form could not be read.
import { GUIDES_DIR, readGuideFiles } from "./library.mjs";
import { engine, readForm } from "./read-form.mjs";

const only = process.argv.slice(2);
const { matchGuide, parseGuide } = await engine();
let drifted = 0;
let readerOnly = 0;
let unreadable = 0;

for (const f of readGuideFiles(GUIDES_DIR)) {
  if (only.length && !only.includes(f.id)) continue;
  const { guide, problems } = parseGuide(f.json, { id: f.id });
  if (!guide) { console.log(`?  ${f.id}: does not pass check-guides (${problems[0]}); fix that first`); unreadable++; continue; }
  if (guide.demo) { console.log(`-  ${f.id}: demo guide, skipped`); continue; }
  const sources = guide.match.format === "pdf" ? [guide.officialFormUrl] : guide.match.urls;
  for (const source of sources) {
    let r;
    try {
      r = await readForm(source);
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
}
console.log(`guides:drift: ${drifted} drifted or cannot be told, ${readerOnly} read differently by a newer reader only, ${unreadable} could not be read`);
process.exit(unreadable ? 2 : drifted ? 1 : 0);
