// `npm run guide:new -- <https address or PDF path or PDF address> [--id cz/slug] [--form 0] [--as <address>] [--force]`
// Reads a real form with the engine (a web page) or @distill/pdf (a PDF) and writes a guide skeleton to
// guides/<id>.json: the real field list and fingerprint, the reader's version and the source's digest, one step per
// field in English and Ukrainian, and TODO in every place only a person who has read the official instructions can
// fill. The skeleton is a draft and fails `npm run check-guides` until every TODO is gone. See guides/README.md.
//
// `npm run guide:new -- --refresh <id> [<address or PDF path>] [--form 0]` re-reads an existing guide's form (its
// officialFormUrl for a PDF, its first address for a web form, or the address or file given) with today's reader and
// refreshes only what the reader produces: match.fields' labels, the fingerprint, the title, match.reader and
// match.source. The steps, notes and quotes are never touched. It refuses when a field was added, removed or changed
// kind (the guide's steps no longer fit: follow the drift steps in guides/README.md). The status stays as it is only
// when the form is known to be the same (match.source recorded and equal: only the reader changed); otherwise a
// reviewed guide goes back to draft, with a review note saying why.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GUIDES_DIR } from "./library.mjs";
import { readForm } from "./read-form.mjs";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const force = args.includes("--force") ? (args.splice(args.indexOf("--force"), 1), true) : false;
const refresh = flag("--refresh");
const id = flag("--id");
const formIndex = Number(flag("--form") ?? 0);
const as = flag("--as");
const today = new Date().toISOString().slice(0, 10);

if (refresh) await refreshGuide(refresh, args[0]);
else await newGuide(args[0]);

async function newGuide(source) {
  if (!source) {
    console.error("usage: npm run guide:new -- <https address | file.pdf | https address of a PDF> [--id cz/slug] [--form 0] [--as <address>] [--force]\n" +
      "       npm run guide:new -- --refresh <id> [<address | file.pdf>] [--form 0]");
    process.exit(2);
  }
  const r = await readForm(source, { formIndex, as });
  if (!r.structure) {
    console.error(`guide:new: ${source} cannot be filled, so there is nothing to write a guide for: ${r.problem?.title ?? "no form"}. ${r.problem?.detail ?? ""}`);
    process.exit(1);
  }
  const s = r.structure;
  if (!s.fields.length) {
    console.error(`guide:new: no fillable field found in form ${formIndex} of ${source}${r.forms !== undefined ? ` (the page has ${r.forms} form(s))` : ""}.`);
    process.exit(1);
  }

  const slug = id ?? `cz/${(s.title || "form").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "form"}`;
  const out = join(GUIDES_DIR, `${slug}.json`);
  if (existsSync(out) && !force) {
    console.error(`guide:new: ${out} exists. Pass --force to write over it (the steps you wrote there will be lost), or --refresh ${slug} to refresh only its field list.`);
    process.exit(1);
  }

  const isUrl = /^https:\/\//i.test(source);
  const TODO = (what) => `TODO: ${what}`;
  const step = (f, lang) => ({
    stepId: f.fieldId.replace(/[^\w-]+/g, "_").slice(0, 60) || "step",
    fieldIds: [f.fieldId],
    question: TODO(lang === "en" ? `the question for "${f.label || f.fieldId}", in English` : `the question for "${f.label || f.fieldId}", in Ukrainian`),
    explanation: TODO("what the official instructions say about this field, in plain words"),
  });
  // Step ids must be unique; a field id that sanitises to one already used gets a number.
  const steps = (lang) => {
    const used = new Set();
    return s.fields.map((f) => {
      const st = step(f, lang);
      let base = st.stepId;
      for (let n = 2; used.has(st.stepId); n++) st.stepId = `${base}_${n}`;
      used.add(st.stepId);
      return st;
    });
  };

  const notes = [`Skeleton written by guide:new from ${isUrl ? source : "a local file"} on ${today}. Group fields into steps where the instructions treat them together.`];
  if (r.printOnly) notes.push("This PDF has no form fields: Distill found the places to write on from the printed page, and the app tells the person so. Check every field in match.fields against the printed form, and that no place a person writes on is missing.");
  const guide = {
    guideVersion: 1,
    id: slug,
    status: "draft",
    authority: { name: TODO("the authority, as it names itself"), nameEn: TODO('in English, as it reads mid-sentence: "the Ministry of the Interior"') },
    formName: { cs: s.title || TODO("the form's own name"), en: TODO("the form's name in English"), uk: TODO("the form's name in Ukrainian") },
    formLang: (s.lang || "cs").split("-")[0],
    officialFormUrl: isUrl ? source : TODO("the https address the form is published at"),
    instructionsUrl: TODO("the https address of the official instructions you wrote the steps from"),
    draftedOn: today,
    match: matchOf(r),
    wizards: {
      en: { notes: [], steps: steps("en") },
      uk: { notes: [], steps: steps("uk") },
    },
    reviewNotes: notes,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(guide, null, 2) + "\n");
  console.log(`guide:new: wrote guides/${slug}.json (${r.format}${r.printOnly ? ", print-only" : ""}, ${s.fields.length} fields, fingerprint ${s.fingerprint.slice(0, 12)}..., reader ${r.reader})`);
  console.log(`  title: ${s.title}   language: ${s.lang}${r.forms !== undefined ? `   forms on the page: ${r.forms} (this is form ${formIndex})` : ""}`);
  for (const f of s.fields) console.log(`  - ${f.fieldId} [${f.kind}${f.required ? ", required" : ""}] ${JSON.stringify(f.label)}${f.options ? ` (${f.options.length} options)` : ""}`);
  console.log("Next: read the official instructions, replace every TODO, then npm run check-guides.");
}

/** The guide's `match` for a reading: what the reader produced, which reader, and the source it read. */
function matchOf(r, keep = {}) {
  const s = r.structure;
  const titles = r.format === "pdf" ? [s.title, ...(keep.titles ?? [])].filter((t, i, a) => t && a.indexOf(t) === i) : undefined;
  return {
    format: r.format,
    fingerprints: [s.fingerprint],
    ...(r.format === "html" ? { urls: keep.urls ?? [r.address] } : { titles }),
    fields: s.fields.map((f) => ({ fieldId: f.fieldId, kind: f.kind, label: f.label })),
    reader: r.reader,
    source: r.source,
  };
}

async function refreshGuide(guideId, given) {
  const file = join(GUIDES_DIR, `${guideId}.json`);
  if (!existsSync(file)) { console.error(`guide:new --refresh: there is no guides/${guideId}.json`); process.exit(1); }
  const text = readFileSync(file, "utf8");
  const g = JSON.parse(text);
  if (g.demo) { console.error("guide:new --refresh: the demo guide's form is in this repository; edit it with the form."); process.exit(1); }
  const source = given ?? (g.match.format === "pdf" ? g.officialFormUrl : g.match.urls?.[0]);
  const r = await readForm(source, { formIndex, as: g.match.format === "html" && !/^https?:/i.test(source) ? g.match.urls?.[0] : undefined });
  if (!r.structure) { console.error(`guide:new --refresh: ${source} cannot be filled any more: ${r.problem?.title ?? "no form"}. Follow the drift steps in guides/README.md.`); process.exit(1); }
  if (r.format !== g.match.format) { console.error(`guide:new --refresh: ${source} is a ${r.format} form, the guide is for a ${g.match.format} one.`); process.exit(1); }
  const s = r.structure;
  const was = g.match.fields;
  // Only labels may differ: the same fields, in the same order, of the same kinds. Anything else changes what the
  // steps cover, which is the author's to rewrite, not this script's.
  const sameShape = was.length === s.fields.length && was.every((f, i) => f.fieldId === s.fields[i].fieldId && f.kind === s.fields[i].kind);
  if (!sameShape) {
    const ids = new Set(s.fields.map((f) => f.fieldId));
    const old = new Set(was.map((f) => f.fieldId));
    console.error(`guide:new --refresh: the fields of ${source} are not the guide's (fields added, removed, reordered or of another kind), so its steps may no longer fit:`);
    for (const f of s.fields) if (!old.has(f.fieldId)) console.error(`  new     ${f.fieldId} [${f.kind}] ${JSON.stringify(f.label)}`);
    for (const f of was) if (!ids.has(f.fieldId)) console.error(`  gone    ${f.fieldId}`);
    for (const f of s.fields) { const o = was.find((x) => x.fieldId === f.fieldId); if (o && o.kind !== f.kind) console.error(`  kind    ${f.fieldId}: ${o.kind} -> ${f.kind}`); }
    console.error("Follow the drift steps in guides/README.md: read the new version with guide:new --id <scratch id>, rewrite the affected steps, set the guide to draft.");
    process.exit(1);
  }
  const relabelled = s.fields.filter((f, i) => f.label !== was[i].label);
  // The same file, or a reading that is exactly what the guide holds (its fingerprint): the form is the guide's form.
  const sameForm = (typeof g.match.source === "string" && g.match.source === r.source) || g.match.fingerprints.includes(s.fingerprint);
  const keepTitles = sameForm ? (g.match.titles ?? []) : [];
  const match = matchOf(r, { urls: g.match.urls, titles: keepTitles });
  // Only today's fingerprint: check-guides requires each one to be the fingerprint of match.fields, and the old one was
  // made of the old reader's labels.
  const out = { ...g, match };
  const notes = [];
  if (!sameForm) {
    // The form may have changed too (its bytes differ, or were never recorded): a person checks it again.
    const why = typeof g.match.source === "string"
      ? `the form at ${source} is not the file the guide was read from (its digest differs)`
      : "the guide did not record which file it was read from";
    if (g.status === "reviewed") {
      out.status = "draft";
      delete out.reviewer;
      delete out.reviewedOn;
    }
    notes.push(`guide:new --refresh on ${today}: match.fields re-read with reader ${r.reader}; ${why}, so the form may have changed as well as the reader. Check match.fields against the form as published${g.status === "reviewed" ? "; the guide is back to draft until a person has" : ""}.`);
  }
  if (notes.length) out.reviewNotes = [...(g.reviewNotes ?? []), ...notes];
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`guide:new --refresh: guides/${guideId}.json - reader ${g.match.reader ?? "(not recorded)"} -> ${r.reader}; ${relabelled.length} label(s) changed; status ${out.status}${sameForm ? ` (the same form${relabelled.length ? ", read by a newer reader" : ", read the same way"}: the checked text and the status are kept)` : ""}.`);
  for (const f of relabelled) console.log(`  ${f.fieldId}: ${JSON.stringify(was.find((x) => x.fieldId === f.fieldId).label)} -> ${JSON.stringify(f.label)}`);
  console.log("The steps, notes and quotes were not touched. Run npm run check-guides.");
}
