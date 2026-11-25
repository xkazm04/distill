// `npm run guides:review -- <id>... [--source <address>=<file>]...`: prepares a person's review of a guide
// (guides/README.md, "Reviewing a guide"). It reads the official instructions the guide cites (instructionsUrl and
// every step's official.url: a PDF through @distill/pdf, a web page through the engine's page reader in happy-dom with
// the page's scripts off) and looks for every official quote word for word (the engine's verifyQuotes). It prints one
// verdict per quote and a count, and writes a review sheet, guides/.review/<id>.html (git-ignored): each step with its
// Czech field labels, the English and Ukrainian text side by side, its quote with the verdict and the paragraph around
// it; the steps that make claims with no quote first; every review note as a tick box; and the commit template.
//
// It reviews nothing. A found quote proves only that the words exist in the source. The tool never writes a guide:
// status, reviewer and reviewedOn are set only by the person's review commit. Uses the network, so it is not part of
// `npm run check`. With no id it prepares every guide except the demo guide.
// Exit 0: every quote found; 1: a quote was not found; 2: a source or a guide could not be read.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { GUIDES_DIR, REPO_ROOT, readGuideFiles } from "./library.mjs";
import { engine } from "./read-form.mjs";
import { checkQuotes, stepsOf, takeSourceMap } from "./quotes.mjs";

export const REVIEW_DIR = join(GUIDES_DIR, ".review");

const args = process.argv.slice(2);
const sourceMap = takeSourceMap(args);
const outFlag = args.indexOf("--out");
const outDir = outFlag >= 0 ? args.splice(outFlag, 2)[1] : REVIEW_DIR;
const dirFlag = args.indexOf("--dir");
const guidesDir = dirFlag >= 0 ? args.splice(dirFlag, 2)[1] : GUIDES_DIR;
const only = args;
const { parseGuide } = await engine();

let notFound = 0;
let unreadable = 0;
const files = readGuideFiles(guidesDir);
for (const id of only) if (!files.some((f) => f.id === id)) { console.log(`?  ${id}: there is no guides/${id}.json`); unreadable++; }

for (const f of files) {
  if (only.length ? !only.includes(f.id) : f.json?.demo === true) continue;
  const { guide, problems } = f.json ? parseGuide(f.json, { id: f.id }) : { guide: null, problems: [f.error] };
  if (!guide) { console.log(`?  ${f.id}: does not pass check-guides (${problems[0]}); fix that first`); unreadable++; continue; }
  console.log(`guides:review: ${f.id} (${guide.status}${guide.demo ? ", demo" : ""})`);
  const { sources, quotes } = await checkQuotes(guide, sourceMap);
  for (const s of sources) {
    if (!s.read) { console.log(`?  could not read ${s.url}: ${s.error}`); unreadable++; }
  }
  for (const q of quotes) {
    const v = q.verdict;
    const where = v.verdict === "found" ? ` [${v.blockId}${v.nextBlockId ? `+${v.nextBlockId}` : ""}]` : "";
    const word = v.verdict === "found" ? "found     " : v.verdict === "not_found" ? "NOT FOUND " : "UNREADABLE";
    console.log(`   ${word} ${stepsOf(q)}: ${JSON.stringify(q.text.length > 90 ? `${q.text.slice(0, 87)}...` : q.text)} in ${q.url}${where}`);
    if (v.verdict === "not_found") notFound++;
    if (v.verdict === "unreadable") unreadable++;
  }
  const found = quotes.filter((q) => q.verdict.verdict === "found").length;
  const missing = quotes.filter((q) => q.verdict.verdict === "not_found").length;
  const cannot = quotes.length - found - missing;
  const bare = guide.wizards.en.steps.filter((st, i) => !st.official && !guide.wizards.uk.steps[i]?.official).map((st) => st.stepId);
  console.log(`   ${found}/${quotes.length} quotes found word for word (${missing} not found, ${cannot} could not be read); ${bare.length} step(s) make claims with no quote${bare.length ? `: ${bare.join(", ")}` : ""}`);
  const out = join(outDir, `${f.id}.html`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, sheet(guide, sources, quotes, bare));
  console.log(`   review sheet: ${relative(REPO_ROOT, out).replaceAll("\\", "/")} (not committed; it reviews nothing, a person decides)`);
}
process.exit(unreadable ? 2 : notFound ? 1 : 0);

/** Everything that goes into the sheet is escaped: the guide and the instructions are untrusted text. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** An address as a link only when it is https (parseGuide already requires that); otherwise as text. */
function link(url) {
  return /^https:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noreferrer noopener">${esc(url)}</a>` : esc(url);
}

/** The paragraph with the quote marked; both parts escaped. */
function marked(context, sentence) {
  const at = context.indexOf(sentence);
  if (at < 0) return esc(context);
  return `${esc(context.slice(0, at))}<mark>${esc(sentence)}</mark>${esc(context.slice(at + sentence.length))}`;
}

function verdictHtml(q) {
  const v = q.verdict;
  if (v.verdict === "found") {
    return `<p class="v found">Found word for word in ${link(q.url)} (block ${esc(v.blockId)}${v.nextBlockId ? ` and ${esc(v.nextBlockId)}, split across two blocks` : ""}). Does the step say what this paragraph says, and nothing more?</p>` +
      `<blockquote class="ctx">${marked(v.context, v.sentence)}</blockquote>`;
  }
  if (v.verdict === "not_found") return `<p class="v miss">NOT FOUND in ${link(q.url)}: the words are not in the source as published (a paraphrase, a change by the authority, or a sentence the reader splits differently). Find it by hand or fix the quote.</p>`;
  return `<p class="v unread">COULD NOT READ ${link(q.url)}: check this quote by hand. It is not counted as found.</p>`;
}

function side(st) {
  if (!st) return "<td></td>";
  const extra = [
    st.expectedFormat ? `<p><b>Format:</b> ${esc(st.expectedFormat)}</p>` : "",
    st.example ? `<p><b>Example:</b> ${esc(st.example)}</p>` : "",
  ].join("");
  return `<td><p class="q">${esc(st.question)}</p><p>${esc(st.explanation)}</p>${extra}</td>`;
}

function stepHtml(guide, i, quotes) {
  const en = guide.wizards.en.steps[i];
  const uk = guide.wizards.uk.steps[i];
  const labels = en.fieldIds.map((id) => {
    const f = guide.match.fields.find((x) => x.fieldId === id);
    return `<li><span lang="${esc(guide.formLang)}">${esc(f?.label || "(no label)")}</span> <code>${esc(id)}</code> <small>${esc(f?.kind ?? "")}</small></li>`;
  }).join("");
  const mine = quotes.filter((q) => q.steps.some((s) => s.stepId === en.stepId));
  const quoteHtml = mine.length
    ? mine.map((q) => `<div class="quote"><p><b>Quote</b> (${esc(q.lang)}; in ${esc(q.steps.find((s) => s.stepId === en.stepId).langs.join(" and "))}):</p><blockquote lang="${esc(q.lang)}">${esc(q.text)}</blockquote>${verdictHtml(q)}</div>`).join("")
    : `<p class="v bare">No quote: every claim in this step rests on the reviewer's reading of the instructions.</p>`;
  return `<section class="step" id="step-${esc(en.stepId)}"><h3>Step ${esc(en.stepId)}</h3>` +
    `<p><b>Fields on the form (Czech labels as read):</b></p><ul>${labels}</ul>` +
    `<table><thead><tr><th>English</th><th>Ukrainian</th></tr></thead><tbody><tr>${side(en)}${side(uk)}</tr></tbody></table>` +
    `${quoteHtml}<p><label><input type="checkbox"> This step agrees with the instructions, in both languages</label></p></section>`;
}

function sheet(guide, sources, quotes, bare) {
  const order = guide.wizards.en.steps.map((_, i) => i);
  const bareIdx = order.filter((i) => bare.includes(guide.wizards.en.steps[i].stepId));
  const quotedIdx = order.filter((i) => !bare.includes(guide.wizards.en.steps[i].stepId));
  const found = quotes.filter((q) => q.verdict.verdict === "found").length;
  const host = (() => { try { return new URL(guide.instructionsUrl).hostname.replace(/^www\./, ""); } catch { return "the official"; } })();
  const notes = (l) => (guide.wizards[l].notes.length ? `<ul>${guide.wizards[l].notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "<p>(none)</p>");
  const reviewNotes = (guide.reviewNotes ?? []).map((n) => `<li><label><input type="checkbox"> ${esc(n)}</label></li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review sheet ${esc(guide.id)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:72rem;margin:0 auto;padding:1rem;color:#111;background:#fff}
.warn{border:2px solid #b00;padding:.6rem .8rem;font-weight:600}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.4rem;vertical-align:top;text-align:left;width:50%}
.q{font-weight:600}blockquote{margin:.4rem 0;padding:.4rem .8rem;border-left:4px solid #999;background:#f6f6f6}
.ctx{font-size:13px;white-space:pre-wrap}mark{background:#ffe066}
.v{font-weight:600}.found{color:#065f2b}.miss{color:#b00}.unread{color:#8a4b00}.bare{color:#8a4b00}
.step{border-top:1px solid #ccc;margin-top:1.2rem}code{font-size:12px}pre{white-space:pre-wrap;background:#f6f6f6;padding:.6rem}
</style></head><body>
<p class="warn">This sheet does not review anything: a person decides. A found quote only proves the words exist.</p>
<h1>Review sheet: ${esc(guide.id)}</h1>
<p>${esc(guide.formName.cs)} (${esc(guide.formName.en)}), ${esc(guide.authority.name)}. Status now: <b>${esc(guide.status)}</b>. Drafted on ${esc(guide.draftedOn)}.</p>
<p>Form: ${link(guide.officialFormUrl)}<br>Instructions: ${link(guide.instructionsUrl)}</p>
<h2>Sources read</h2><ul>${sources.map((s) => `<li>${link(s.url)}: ${s.read ? `read (${s.blocks.length} blocks${s.title ? `, "${esc(s.title)}"` : ""})` : `<b>could not be read</b>: ${esc(s.error)}`}</li>`).join("")}</ul>
<p><b>${found}/${quotes.length}</b> quotes found word for word. ${bare.length} step(s) make claims with no quote; they are listed first.</p>
<h2>Notes for the whole form</h2>
<table><thead><tr><th>English</th><th>Ukrainian</th></tr></thead><tbody><tr><td>${notes("en")}</td><td>${notes("uk")}</td></tr></tbody></table>
<h2>Review notes (each must be resolved and removed before the guide is reviewed)</h2>
${reviewNotes ? `<ul>${reviewNotes}</ul>` : "<p>(none)</p>"}
<h2>Steps with no quote (${bareIdx.length})</h2>
${bareIdx.map((i) => stepHtml(guide, i, quotes)).join("")}
<h2>Steps with a quote (${quotedIdx.length})</h2>
${quotedIdx.map((i) => stepHtml(guide, i, quotes)).join("")}
<h2>When you have checked everything</h2>
<p>The review is one commit, made by you (or by a maintainer quoting your written confirmation). In guides/${esc(guide.id)}.json set <code>"status": "reviewed"</code>, add <code>"reviewer"</code> (your name, and the languages you checked when more than one person reviews) and <code>"reviewedOn"</code> (the date of your check, YYYY-MM-DD), and remove <code>reviewNotes</code>. Then run <code>npm run check-guides</code>. The commit message names you and the instructions you checked:</p>
<pre>review(guides): ${esc(guide.id)} checked against ${esc(host)} instructions by &lt;your name&gt;</pre>
</body></html>
`;
}
