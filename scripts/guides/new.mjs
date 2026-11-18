// `npm run guide:new -- <https address or PDF path or PDF address> [--id cz/slug] [--form 0] [--as <address>] [--force]`
// Reads a real form with the engine (a web page) or @distill/pdf (a PDF) and writes a guide skeleton to
// guides/<id>.json: the real field list and fingerprint, one step per field in English and Ukrainian, and TODO in every
// place only a person who has read the official instructions can fill. The skeleton is a draft and fails
// `npm run check-guides` until every TODO is gone. See guides/README.md.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GUIDES_DIR } from "./library.mjs";
import { readForm } from "./read-form.mjs";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const force = args.includes("--force") ? (args.splice(args.indexOf("--force"), 1), true) : false;
const id = flag("--id");
const formIndex = Number(flag("--form") ?? 0);
const as = flag("--as");
const source = args[0];
if (!source) {
  console.error("usage: npm run guide:new -- <https address | file.pdf | https address of a PDF> [--id cz/slug] [--form 0] [--as <address>] [--force]");
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
  console.error(`guide:new: ${out} exists. Pass --force to write over it (the steps you wrote there will be lost).`);
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

const guide = {
  guideVersion: 1,
  id: slug,
  status: "draft",
  authority: { name: TODO("the authority, as it names itself"), nameEn: TODO('in English, as it reads mid-sentence: "the Ministry of the Interior"') },
  formName: { cs: s.title || TODO("the form's own name"), en: TODO("the form's name in English"), uk: TODO("the form's name in Ukrainian") },
  formLang: (s.lang || "cs").split("-")[0],
  officialFormUrl: isUrl ? source : TODO("the https address the form is published at"),
  instructionsUrl: TODO("the https address of the official instructions you wrote the steps from"),
  draftedOn: new Date().toISOString().slice(0, 10),
  match: {
    format: r.format,
    fingerprints: [s.fingerprint],
    ...(r.format === "html" ? { urls: [r.address] } : { titles: [s.title] }),
    fields: s.fields.map((f) => ({ fieldId: f.fieldId, kind: f.kind, label: f.label })),
  },
  wizards: {
    en: { notes: [], steps: steps("en") },
    uk: { notes: [], steps: steps("uk") },
  },
  reviewNotes: [`Skeleton written by guide:new from ${isUrl ? source : "a local file"} on ${new Date().toISOString().slice(0, 10)}. Group fields into steps where the instructions treat them together.`],
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(guide, null, 2) + "\n");
console.log(`guide:new: wrote guides/${slug}.json (${r.format}, ${s.fields.length} fields, fingerprint ${s.fingerprint.slice(0, 12)}...)`);
console.log(`  title: ${s.title}   language: ${s.lang}${r.forms !== undefined ? `   forms on the page: ${r.forms} (this is form ${formIndex})` : ""}`);
for (const f of s.fields) console.log(`  - ${f.fieldId} [${f.kind}${f.required ? ", required" : ""}] ${JSON.stringify(f.label)}${f.options ? ` (${f.options.length} options)` : ""}`);
console.log("Next: read the official instructions, replace every TODO, then npm run check-guides.");
