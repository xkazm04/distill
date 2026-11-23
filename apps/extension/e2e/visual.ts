// r5-01: the gallery of approved pictures, e2e/out/visual/index.html. Every picture the picture tests guard
// (caption-visual.spec.ts, and live/visual.live.ts when it has run), and for a picture that failed its last run the
// approved, the actual and the diff side by side, from Playwright's own failure output. Written after each picture run
// (test.afterAll of either spec).
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const GALLERY = join(here, "out", "visual");

/** The approved picture folders (Playwright's `<spec>-snapshots`) and where each spec's failures land. */
const SETS = [
  { title: "The strip and the cleaned demo pages", hint: "caption-visual.spec.ts, part of npm run e2e (tight threshold)",
    approved: join(here, "caption-visual.spec.ts-snapshots"), results: join(here, "out", "test-results") },
  { title: "The 9 live sites", hint: "live/visual.live.ts, opt-in (loose threshold, the status line masked)",
    approved: join(here, "live", "visual.live.ts-snapshots"), results: join(here, "out", "live", "test-results") },
];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
}

const url = (file: string) => relative(GALLERY, file).split(sep).join("/");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c] as string);
const kb = (file: string) => `${Math.round(statSync(file).size / 1024)} KB`;

export function writeGallery(): string {
  mkdirSync(GALLERY, { recursive: true });
  let failed = 0;
  let total = 0;
  const sections = SETS.map((set) => {
    const approved = walk(set.approved).filter((f) => f.endsWith(".png")).sort();
    if (!approved.length) return "";
    // Playwright names a failure's files after the picture without the platform suffix: <name>-actual.png, -diff.png.
    const outputs = walk(set.results).filter((f) => /-(actual|diff)\.png$/.test(f));
    const cards = approved.map((file): [boolean, string] => {
      total++;
      const name = file.split(sep).pop()!.replace(/\.png$/, "");
      const base = name.replace(/-(win32|linux|darwin)$/, "");
      const actual = outputs.find((f) => f.endsWith(`${sep}${base}-actual.png`));
      const diff = outputs.find((f) => f.endsWith(`${sep}${base}-diff.png`));
      const fresh = (f: string | undefined): boolean => !!f && statSync(f).mtimeMs >= statSync(file).mtimeMs;
      const bad = !!actual && fresh(actual);
      if (bad) failed++;
      const img = (f: string, label: string) => `<figure><a href="${esc(url(f))}"><img src="${esc(url(f))}" alt="${esc(`${base}, ${label}`)}" loading="lazy"></a><figcaption>${label}</figcaption></figure>`;
      return [bad, `<article class="${bad ? "bad" : ""}" id="${esc(base)}"><h3>${esc(base)}${bad ? " <em>differs</em>" : ""}</h3>`
        + `<div class="row">${img(file, `approved · ${kb(file)}`)}${bad && actual ? img(actual, "actual (last run)") : ""}${bad && diff ? img(diff, "diff (red: what moved)") : ""}</div></article>`];
    }).sort((a, b) => Number(b[0]) - Number(a[0])).map((c) => c[1]).join("\n"); // what differs first
    return `<section><h2>${esc(set.title)}</h2><p class="hint">${esc(set.hint)}</p><div class="cards">${cards}</div></section>`;
  }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Distill pictures</title>
<style>
:root{color-scheme:light dark;--bg:#f6f5f2;--fg:#1d1c1a;--muted:#5d5a55;--card:#fff;--line:#dedbd4;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#161514;--fg:#ecebe8;--muted:#a8a49d;--card:#22211f;--line:#3a3835;--bad:#f2b8b5}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1500px;margin:0 auto}
h1{margin:0 0 4px;font-size:24px}h2{margin:32px 0 2px;font-size:19px}h3{margin:0 0 8px;font-size:14px;font-weight:600;word-break:break-all}
.hint,.lead{color:var(--muted);margin:0 0 12px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,440px),1fr));gap:12px;align-items:start}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;min-width:0}
article.bad{grid-column:1/-1}
article:not(.bad) figure img{max-height:340px;width:auto}
article.bad{border-color:var(--bad);border-width:2px}em{color:var(--bad);font-style:normal}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
figure{margin:0;flex:1 1 300px;max-width:100%}
.bad .row{flex-direction:column}.bad figure{flex:none;width:100%}figure img{display:block;max-width:100%;height:auto;border:1px solid var(--line)}
figcaption{color:var(--muted);font-size:13px;margin-top:4px}
</style></head><body><main>
<h1>Distill pictures</h1>
<p class="lead">${total} approved pictures${failed ? `, <em>${failed} ${failed === 1 ? "differs" : "differ"} in the last run</em>` : ", all matching in the last run"}. Approve a change: <code>npx playwright test -c e2e/playwright.config.ts --update-snapshots caption-visual</code>, then review the pictures in git (e2e/README.md, "Pictures"). Written ${new Date().toISOString().slice(0, 16).replace("T", " ")}.</p>
${sections}
</main></body></html>`;
  const file = join(GALLERY, "index.html");
  writeFileSync(file, html);
  return file;
}
