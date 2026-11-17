// Fails when a credential from .env that must never ship appears in the hosted web build. Run after `npm run build`
// and before every `firebase deploy --only hosting` (npm run deploy:web does both).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const NEVER_SHIP = ["VITE_APPCHECK_DEBUG_TOKEN"];
const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const secrets = NEVER_SHIP.map((k) => new RegExp(`^${k}=(.*)$`, "m").exec(env)?.[1]?.trim()).filter((v) => v && v.length >= 8);
const dist = "apps/web/dist";
if (!existsSync(dist)) { console.error("check-dist: apps/web/dist missing - build first"); process.exit(1); }
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let bad = 0;
for (const f of walk(dist)) {
  const text = readFileSync(f, "latin1");
  for (const s of secrets) if (text.includes(s)) { console.error(`check-dist: a never-ship credential is in ${f}`); bad++; }
}
if (bad) process.exit(1);
console.log(`check-dist: clean (${secrets.length} credential(s) checked)`);
