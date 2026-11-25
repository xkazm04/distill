// `npm run guides:digest -- <id> [--langs en,uk] [--dir <folder>]`: prints the text lock of a guide, the `reviewedText`
// its review commit adds (guides/README.md, "Reviewing a guide"). It is the engine's guideTextDigest: sha-256 over the
// field ids and kinds and, for each signed-off language, the steps, notes and quotes as they are in the file now. The
// languages are `--langs`, else the guide's own reviewedLangs, else every language (en and uk). Run it after the last change to the text, just before
// the review commit. It only prints: it never writes a guide, and it never sets status, reviewer or reviewedOn.
// Offline. Exit 0: printed; 1: the guide cannot be read or is not a complete guide.
import { GUIDES_DIR, readGuideFiles } from "./library.mjs";
import { engine } from "./read-form.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--dir");
const dir = at >= 0 ? args.splice(at, 2)[1] : GUIDES_DIR;
const langsAt = args.indexOf("--langs");
const langsFlag = langsAt >= 0 ? args.splice(langsAt, 2)[1] : undefined;
const [id] = args;
if (!id) { console.error("usage: npm run guides:digest -- <id>   (for example cz/oznameni-zmen)"); process.exit(1); }
const f = readGuideFiles(dir).find((x) => x.id === id);
if (!f || !f.json) { console.error(`guides:digest: ${f ? f.error : `there is no guides/${id}.json`}`); process.exit(1); }
const { guideTextDigest, parseGuide, GUIDE_LANGS } = await engine();
const langs = langsFlag ? langsFlag.split(",").map((l) => l.trim()).filter(Boolean) : f.json.reviewedLangs ?? [...GUIDE_LANGS];
const unknown = langs.filter((l) => !GUIDE_LANGS.includes(l));
if (!langs.length || unknown.length) { console.error(`guides:digest: --langs takes ${GUIDE_LANGS.join(", ")}, comma separated${unknown.length ? ` (not ${unknown.join(", ")})` : ""}`); process.exit(1); }
// Every problem but the lock itself must be fixed first: a digest of a guide the door refuses would lock a broken text.
const problems = parseGuide(f.json, { id }).problems.filter((p) => !/reviewedText|reviewedLangs|checked text changed/.test(p));
if (problems.length) { console.error(`guides:digest: ${id} does not pass check-guides yet:\n  - ${problems.join("\n  - ")}`); process.exit(1); }
const ordered = GUIDE_LANGS.filter((l) => langs.includes(l));
console.log(`"reviewedLangs": ${JSON.stringify(ordered)},`);
console.log(`"reviewedText": "${guideTextDigest(f.json, ordered)}"`);
console.log(`guides:digest: the text lock of ${id} for ${ordered.join(" and ")} as it is now. The review commit adds these two lines with status, reviewer and reviewedOn; any later change to the checked text (the fields, or the ${ordered.join(" or ")} steps, notes and quotes) makes check-guides refuse the guide until it is reviewed again.`);
