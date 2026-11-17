// Fails when a tracked or staged file holds something that looks like a credential. Run before every push.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execSync("git ls-files -c -o --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const patterns = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/"private_key"\s*:/, "service-account key"],
  [/sk-[A-Za-z0-9_-]{20,}/, "OpenAI-style secret key"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic key"],
  [/ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, "GitHub token"],
  [/xox[abp]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key (Firebase web keys belong in .env, not in git)"],
  [/storePassword|keyPassword\s*=/, "Android signing password"],
];
const banned = [/^\.env(\..*)?$/, /\.(jks|keystore|pem|key)$/, /google-services\.json$/, /^debug-token/];
let bad = 0;
for (const f of files) {
  const base = f.split("/").pop() ?? f;
  if (banned.some((r) => r.test(base))) { console.error(`banned file: ${f}`); bad++; continue; }
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  if (f === "scripts/secret-scan.mjs") continue;
  for (const [re, what] of patterns) if (re.test(text)) { console.error(`${what}: ${f}`); bad++; }
}
if (bad) { console.error(`secret-scan: ${bad} finding(s)`); process.exit(1); }
console.log(`secret-scan: clean (${files.length} files)`);
