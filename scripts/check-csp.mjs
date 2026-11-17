// Fails when an inline <script> in the web app's index.html is not allowed by the Content-Security-Policy in
// firebase.json (a sha256 hash per inline script), or when the policy lost a directive the app relies on.
// `node scripts/check-csp.mjs` reads apps/web/index.html (in npm run check); `--dist` reads the built
// apps/web/dist/index.html (in npm run deploy:web), because the bytes that ship are what the browser hashes - a CRLF
// checkout changes the hash, and this catches it before the pre-paint theme stamp is blocked in production.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const file = process.argv.includes("--dist") ? "apps/web/dist/index.html" : "apps/web/index.html";
if (!existsSync(file)) { console.error(`check-csp: ${file} missing - build first`); process.exit(1); }

const headers = JSON.parse(readFileSync("firebase.json", "utf8")).hosting.headers.flatMap((h) => h.headers);
const csp = headers.find((h) => h.key === "Content-Security-Policy")?.value;
if (!csp) { console.error("check-csp: firebase.json hosting headers carry no Content-Security-Policy"); process.exit(1); }
const directives = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));

let bad = 0;
const fail = (m) => { console.error(`check-csp: ${m}`); bad++; };
for (const d of ["default-src", "script-src", "object-src", "base-uri", "frame-ancestors"]) if (!directives[d]) fail(`no ${d}`);
if (directives["script-src"]?.some((v) => v === "'unsafe-inline'" || v === "'unsafe-eval'" || v === "*")) fail("script-src allows inline, eval or any origin");

const html = readFileSync(file, "utf8");
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (!inline.length) fail(`no inline script found in ${file} - if the pre-paint stamp moved, update this gate`);
for (const body of inline) {
  const hash = `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
  if (!directives["script-src"]?.includes(hash)) fail(`${file}: inline script ${hash} is not in script-src (edit the hash in firebase.json)`);
}
if (bad) process.exit(1);
console.log(`check-csp: clean (${inline.length} inline script(s) hashed in ${file})`);
