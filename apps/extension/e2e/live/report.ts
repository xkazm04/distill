// One HTML page for the owner: every live site, its first sight beside the untouched page, and each number against the
// prototype's bar. A test artifact (e2e/out/live/report.html, git-ignored), not part of the extension, so it uses plain
// neutral colours of its own like the prototype harness does.
import { writeFileSync } from "node:fs";
import type { Site } from "./caption.live";

export interface Check { name: string; value: string; limit: string; verdict: "pass" | "warn" | "fail" }

export interface SiteResult {
  site: Site;
  at: string;
  status: "pass" | "warn" | "fail" | "skipped";
  reason?: string;
  finalUrl?: string;
  firstSight?: string;
  checks: Check[];
  shots: string[];
  video?: string;
  extErrors?: string[];
  metrics?: unknown;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

const LABEL: Record<SiteResult["status"], string> = { pass: "Meets the bar", warn: "Meets the bar, with notes", fail: "Below the bar", skipped: "Not reached" };

function site(r: SiteResult): string {
  const shot = (name: string, caption: string) =>
    r.shots.includes(`${name}.png`) ? `<figure><a href="${r.site.id}/${name}.png"><img src="${r.site.id}/${name}.png" alt="${esc(caption)}" loading="lazy"></a><figcaption>${esc(caption)}</figcaption></figure>` : "";
  const rows = r.checks.map((c) => `<tr class="${c.verdict}"><td>${esc(c.name)}</td><td>${esc(c.value)}</td><td>${esc(c.limit)}</td><td>${c.verdict}</td></tr>`).join("");
  return `<section class="site ${r.status}" id="${r.site.id}">
  <h2><span class="badge">${LABEL[r.status]}</span> ${esc(r.site.useCase)} · ${esc(r.site.id)}</h2>
  <p class="meta"><a href="${esc(r.finalUrl ?? r.site.url)}">${esc(r.finalUrl ?? r.site.url)}</a> · ${esc(r.site.why)}${r.firstSight ? ` · first sight: <b>${esc(r.firstSight)}</b>` : ""}${r.video ? ` · <a href="${r.site.id}/${r.video}">video</a>` : ""}</p>
  ${r.reason ? `<p class="reason">${esc(r.reason)}</p>` : ""}
  <div class="shots">${shot("start", "Untouched")}${shot("first", "First sight, 1440x900")}${shot("more", "More")}${shot("first-390", "First sight, 390x844")}${shot("original", "Original")}${shot("error", "Where it stopped")}</div>
  ${rows ? `<table><thead><tr><th>Check</th><th>Measured</th><th>Bar</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : ""}
  ${r.extErrors?.length ? `<pre>${esc(r.extErrors.join("\n"))}</pre>` : ""}
</section>`;
}

export function writeReport(file: string, results: SiteResult[]): void {
  const count = (s: SiteResult["status"]) => results.filter((r) => r.status === s).length;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Caption on live sites</title>
<style>
  body { font: 15px/1.5 system-ui, "Segoe UI", sans-serif; margin: 0; background: #f6f6f7; color: #1f1f23; }
  main { max-width: 1280px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 22px; margin: 8px 0; }
  .lead { color: #55555c; max-width: 80ch; }
  .site { background: #fff; border: 1px solid #d9d9de; border-radius: 10px; padding: 12px 16px; margin: 16px 0; }
  .site h2 { font-size: 17px; margin: 0 0 4px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .badge { font-size: 13px; padding: 2px 8px; border-radius: 999px; background: #e6e6ea; }
  .pass .badge { background: #d7f0e2; color: #0f5132; } .warn .badge { background: #fff1c2; color: #5c4400; }
  .fail .badge { background: #fbd9dc; color: #7a1020; } .skipped .badge { background: #e6e6ea; color: #444; }
  .meta { margin: 0 0 8px; color: #55555c; overflow-wrap: anywhere; } .reason { color: #7a1020; }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  figure { margin: 0; } img { width: 100%; border: 1px solid #d9d9de; border-radius: 6px; display: block; }
  figcaption { font-size: 13px; color: #55555c; }
  table { border-collapse: collapse; width: 100%; margin-top: 10px; font-size: 14px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #ececef; vertical-align: top; overflow-wrap: anywhere; }
  tr.fail td { background: #fdecee; } tr.warn td { background: #fff8de; }
  pre { white-space: pre-wrap; background: #fdecee; padding: 8px; border-radius: 6px; font-size: 13px; }
</style></head>
<body><main>
<h1>The caption on live sites</h1>
<p class="lead">Each site opened in Chromium with the e2e build of Distill; the caption started as the toolbar click starts it,
and measured against the bar the R2-B prototype met (docs/caption.md, "Quality bar"; the prototype took 5.9% of a 1440x900
window and 14.1% at 390x844). ${results.length} sites: ${count("pass")} meet the bar, ${count("warn")} with notes, ${count("fail")} below it, ${count("skipped")} not reached.
Generated ${esc(new Date().toISOString())}.</p>
${results.map(site).join("\n")}
</main></body></html>`;
  writeFileSync(file, html);
}
