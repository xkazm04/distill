// Fails when something that must never ship is in a build. Run after a build and before every deploy or package:
// `npm run deploy:web` and `npm run pack:extension` both run it.
//
// `node scripts/check-dist.mjs` scans every build that exists: apps/web/dist, apps/extension/dist (own) and
// apps/extension/dist-public. `node scripts/check-dist.mjs <dir>...` scans only those folders (each must exist); a
// folder named dist-public gets the public rules, so a copy can be checked the same way.
//
// - Every build: no private key, service-account key or API secret.
// - The web app and the public extension: no never-ship credential from .env (the App Check debug token).
// - The public extension, in addition: no reCAPTCHA, no FIREBASE_APPCHECK_DEBUG_TOKEN, no App Check or Firestore
//   endpoint. That build runs AI only on the device and must carry nothing that proves identity or stores remotely.
// - The own extension (build it yourself) holds its builder's debug token by design, so it is not checked for it:
//   that folder is private and is never packaged.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const NEVER_SHIP = ["VITE_APPCHECK_DEBUG_TOKEN"];
const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const credentials = NEVER_SHIP.map((k) => new RegExp(`^${k}=(.*)$`, "m").exec(env)?.[1]?.trim()).filter((v) => v && v.length >= 8);

const EVERY_BUILD = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/"private_key"\s*:/, "a service-account key"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic key"],
];
const PUBLIC_ONLY = [
  [/recaptcha/i, "reCAPTCHA code"],
  [/FIREBASE_APPCHECK_DEBUG_TOKEN/, "the App Check debug-token hook"],
  [/firebaseappcheck/i, "an App Check endpoint"],
  [/firestore\.googleapis/i, "a Firestore endpoint"],
];

const KNOWN = ["apps/web/dist", "apps/extension/dist", "apps/extension/dist-public"];
const args = process.argv.slice(2);
for (const d of args) if (!existsSync(d)) { console.error(`check-dist: ${d} missing - build first`); process.exit(1); }
const dists = args.length ? args : KNOWN.filter((d) => existsSync(d));
if (!dists.length) { console.error("check-dist: no build found - build first"); process.exit(1); }

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let bad = 0;
for (const dist of dists) {
  const kind = basename(dist) === "dist-public" ? "public" : dist.replaceAll("\\", "/").endsWith("apps/extension/dist") ? "own" : "web";
  const files = walk(dist);
  for (const f of files) {
    const text = readFileSync(f, "latin1");
    const found = [];
    for (const [re, what] of EVERY_BUILD) if (re.test(text)) found.push(what);
    if (kind !== "own") for (const s of credentials) if (text.includes(s)) found.push("a never-ship credential from .env");
    if (kind === "public") for (const [re, what] of PUBLIC_ONLY) if (re.test(text)) found.push(what);
    for (const what of found) { console.error(`check-dist: ${what} is in ${f}`); bad++; }
  }
  const note = kind === "own" ? " (own build: holds your debug token by design; never share it)" : "";
  console.log(`check-dist: ${dist} [${kind}] ${files.length} files scanned${note}`);
}
if (bad) { console.error(`check-dist: ${bad} finding(s)`); process.exit(1); }
console.log(`check-dist: clean (${dists.length} build(s), ${credentials.length} credential(s) checked)`);
