// `npm run guides:digest -- <id> [--dir <folder>]`: prints the text lock of a guide, the `reviewedText` its review
// commit adds (guides/README.md, "Reviewing a guide"). It is the engine's guideTextDigest: sha-256 over the steps,
// notes, quotes, field ids and kinds as they are in the file now. Run it after the last change to the text, just before
// the review commit. It only prints: it never writes a guide, and it never sets status, reviewer or reviewedOn.
// Offline. Exit 0: printed; 1: the guide cannot be read or is not a complete guide.
import { GUIDES_DIR, readGuideFiles } from "./library.mjs";
import { engine } from "./read-form.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--dir");
const dir = at >= 0 ? args.splice(at, 2)[1] : GUIDES_DIR;
const [id] = args;
if (!id) { console.error("usage: npm run guides:digest -- <id>   (for example cz/oznameni-zmen)"); process.exit(1); }
const f = readGuideFiles(dir).find((x) => x.id === id);
if (!f || !f.json) { console.error(`guides:digest: ${f ? f.error : `there is no guides/${id}.json`}`); process.exit(1); }
const { guideTextDigest, parseGuide } = await engine();
// Every problem but the lock itself must be fixed first: a digest of a guide the door refuses would lock a broken text.
const problems = parseGuide(f.json, { id }).problems.filter((p) => !/reviewedText|checked text changed/.test(p));
if (problems.length) { console.error(`guides:digest: ${id} does not pass check-guides yet:\n  - ${problems.join("\n  - ")}`); process.exit(1); }
const digest = guideTextDigest(f.json);
console.log(`"reviewedText": "${digest}"`);
console.log(`guides:digest: the text lock of ${id} as it is now. The review commit adds this line with status, reviewer and reviewedOn; any later change to the checked text makes check-guides refuse the guide until it is reviewed again.`);
