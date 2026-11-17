#!/usr/bin/env node
// npm run agent:setup | agent:doctor | agent:remove (root package.json) land here. Builds Handrail when its output is
// missing or older than its sources, then runs dist/bin/handrail-setup.js with the same arguments.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function newest(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(f) : statSync(f).mtimeMs);
  }
  return t;
}

const outputs = ["handrail-setup.js", "handrail-host.js", "handrail-mcp.js"].map((f) => join(here, "dist", "bin", f));
const sourceTime = Math.max(newest(join(here, "src")), statSync(join(here, "tsconfig.build.json")).mtimeMs);
const stale = outputs.some((f) => !existsSync(f) || statSync(f).mtimeMs < sourceTime);

if (stale) {
  console.log("Building Handrail ...");
  let tsc;
  try {
    tsc = createRequire(join(here, "package.json")).resolve("typescript/bin/tsc");
  } catch {
    console.error("TypeScript is not installed. Run npm install in the Distill folder, then try again.");
    process.exit(1);
  }
  const r = spawnSync(process.execPath, [tsc, "-p", join(here, "tsconfig.build.json")], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error("Handrail did not build. Run npm install in the Distill folder, then try again.");
    process.exit(1);
  }
}
process.env.HANDRAIL_JUST_BUILT = stale ? "1" : "";
await import(pathToFileURL(join(here, "dist", "bin", "handrail-setup.js")).href);
