// `npm run guides:drift [-- <id>...]`: re-reads each guide's official form and reports every guide whose fingerprint no
// longer matches, with the fields that are new, changed or gone. A web guide is read at each of its addresses, a PDF
// guide from its officialFormUrl. The demo guide is skipped (its form is in this repository). Uses the network, so it
// is not part of `npm run check`. Exit 0: nothing drifted; 1: a guide drifted; 2: a form could not be read.
import { GUIDES_DIR, readGuideFiles } from "./library.mjs";
import { engine, readForm } from "./read-form.mjs";

const only = process.argv.slice(2);
const { matchGuide, parseGuide } = await engine();
let drifted = 0;
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
    if (!r.structure) {
      console.log(`!  ${f.id}: ${source} can no longer be filled: ${r.problem?.title ?? "no form found"}`);
      drifted++;
      continue;
    }
    const s = r.structure;
    if (guide.match.fingerprints.includes(s.fingerprint)) { console.log(`ok ${f.id}: ${source} matches`); continue; }
    // Compare field by field, as the app does, with drafts on so every guide is compared.
    const m = matchGuide(s, [guide], { drafts: true });
    const theirs = new Set(guide.match.fields.map((x) => x.fieldId));
    const same = new Set(m?.same ?? []);
    const gone = [...theirs].filter((id) => !same.has(id) && !s.fields.some((x) => x.fieldId === id));
    const changed = s.fields.filter((x) => !same.has(x.fieldId));
    if (m?.exact) { console.log(`ok ${f.id}: ${source} has the same fields (labels differ only in spacing or case); add fingerprint ${s.fingerprint}`); continue; }
    drifted++;
    console.log(`!  ${f.id}: ${source} changed since the guide was written (fingerprint ${s.fingerprint.slice(0, 12)}...)`);
    console.log(`   ${m ? `the app still uses the guide for ${m.same.length} unchanged fields (overlap ${m.overlap.toFixed(2)})` : "the app no longer uses this guide for it (overlap below 0.5, or the title or address changed)"}`);
    for (const x of changed) console.log(`   ${theirs.has(x.fieldId) ? "changed" : "new    "} ${x.fieldId} [${x.kind}] ${JSON.stringify(x.label)}`);
    for (const id of gone) console.log(`   gone    ${id}`);
    if (r.format === "pdf" && s.title && !(guide.match.titles ?? []).includes(s.title)) console.log(`   title now reads ${JSON.stringify(s.title)}`);
  }
}
console.log(`guides:drift: ${drifted} drifted, ${unreadable} could not be read`);
process.exit(unreadable ? 2 : drifted ? 1 : 0);
