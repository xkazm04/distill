// `npm run check-guides` (part of `npm run check`): every file in the guide library (guides/<country>/<slug>.json)
// is checked the way the apps will load it, and more strictly.
// - It is JSON and fits packages/engine/schemas/guide.json.
// - It passes the engine's door, parseGuide: closed vocabulary, no HTML, https addresses, real dates, both reader
//   languages over the same steps, field ids that exist, every step unchanged through parseWizard, and a reviewed
//   guide names its reviewer and review date (and has no open review notes), and its text still gives its
//   reviewedText (the text lock: no checked step, note, quote or field changed since the review) and lists the
//   languages its reviewer signed off (reviewedLangs).
// - No date is in the future, and every fingerprint is the fingerprint of its field list at one of its addresses (a
//   PDF's is at pdf://local/; the demo guide's at the hosted app), so a hand edit to a label cannot pass unnoticed.
// Offline and deterministic: it never fetches a form (that is `npm run guides:drift`).
import { runnerImport } from "vite";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { GUIDES_DIR, REPO_ROOT, readGuideFiles } from "./guides/library.mjs";

/** Where the demo guide's form is served by the hosted web app; its fingerprint is taken there. */
export const DEMO_ORIGIN = "https://distill-hybrid-ai.web.app";
const PDF_URL = "pdf://local/";

const engine = async (file) => (await runnerImport(join(REPO_ROOT, "packages/engine/src", file), { configFile: false, logLevel: "error" })).module;
const { parseGuide } = await engine("guides.ts");
const { fingerprint } = await engine("fingerprint.ts");
const { fileSchemas } = await engine("schemas.ts");
const { FORM_READER } = await engine("form.ts");
const { PDF_READER } = (await runnerImport(join(REPO_ROOT, "packages/pdf/src/read.ts"), { configFile: false, logLevel: "error" })).module;
/** Guides whose fields an older reader read (or that do not say which): told, not failed. Only `guides:drift` can
 *  tell whether today's reader reads their form differently, because that needs the form itself. */
const stale = [];

/** The schema subset every Distill schema uses: type, properties, required, items, enum. */
function fits(schema, v, path, out) {
  const t = schema.type;
  const okType =
    t === "object" ? v !== null && typeof v === "object" && !Array.isArray(v)
    : t === "array" ? Array.isArray(v)
    : t === "integer" ? Number.isInteger(v)
    : typeof v === t;
  if (!okType) { out.push(`${path}: expected ${t}`); return; }
  if (schema.enum && !schema.enum.includes(v)) out.push(`${path}: ${JSON.stringify(v)} is not one of ${schema.enum.join(", ")}`);
  if (t === "object") {
    for (const k of schema.required ?? []) if (!(k in v)) out.push(`${path}.${k}: required`);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (k in v) fits(sub, v[k], `${path}.${k}`, out);
    for (const [k, x] of Object.entries(v)) if (x === null) out.push(`${path}.${k}: null (leave an absent field out instead)`);
  }
  if (t === "array") v.forEach((x, i) => fits(schema.items, x, `${path}[${i}]`, out));
}

const today = new Date().toISOString().slice(0, 10);
// `node scripts/check-guides.mjs <dir>` checks another folder laid out the same way (used to try the check itself).
const dir = process.argv[2] ?? GUIDES_DIR;
const files = readGuideFiles(dir);
let bad = 0;
const counts = { reviewed: 0, draft: 0, demo: 0 };
if (dir === GUIDES_DIR && !existsSync(join(GUIDES_DIR, "README.md"))) { console.error("check-guides: guides/README.md is missing"); bad++; }

for (const f of files) {
  const problems = [];
  if (f.error) problems.push(f.error);
  else {
    fits(fileSchemas.guide, f.json, "guide", problems);
    const r = parseGuide(f.json, { id: f.id });
    problems.push(...r.problems);
    const g = f.json;
    const todo = f.text.split("\n").map((l, i) => [l, i + 1]).filter(([l]) => l.includes("TODO"));
    for (const [, n] of todo.slice(0, 5)) problems.push(`line ${n}: a TODO from guide:new is still there`);
    if (todo.length > 5) problems.push(`and ${todo.length - 5} more TODO lines`);
    for (const k of ["draftedOn", "reviewedOn"]) if (typeof g[k] === "string" && g[k] > today) problems.push(`${k} ${g[k]} is in the future`);
    if (r.guide) {
      const addresses = g.match.format === "pdf" ? [PDF_URL] : g.demo ? g.match.urls.map((p) => DEMO_ORIGIN + p) : g.match.urls;
      const fields = g.match.fields.map((x) => ({ ...x, required: false }));
      const expected = new Set(await Promise.all(addresses.map((a) => fingerprint(a, fields))));
      for (const fp of g.match.fingerprints) {
        if (!expected.has(fp)) problems.push(`match.fingerprints: ${fp.slice(0, 12)}... is not the fingerprint of match.fields at any of the guide's addresses (a label or field was edited by hand? re-read the form with npm run guide:new)`);
      }
      counts[g.demo ? "demo" : g.status]++;
      const now = g.match.format === "pdf" ? PDF_READER : FORM_READER;
      if (!g.demo && g.match.reader !== now) stale.push(`${f.id} (${g.match.reader ?? "no reader recorded"}; the reader is ${now})`);
    }
  }
  if (problems.length) {
    bad += problems.length;
    console.error(`check-guides: guides/${f.id}.json`);
    for (const p of problems) console.error(`  - ${p}`);
  }
}
if (bad) { console.error(`check-guides: ${bad} problem(s)`); process.exit(1); }
console.log(`check-guides: clean (${files.length} guide(s): ${counts.reviewed} reviewed, ${counts.draft} draft, ${counts.demo} demo)`);
if (stale.length) console.log(`check-guides: note - read by another version of the reader: ${stale.join(", ")}. Run npm run guides:drift; a guide whose form is the same file is refreshed with npm run guide:new -- --refresh <id>.`);
