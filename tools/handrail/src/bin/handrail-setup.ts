#!/usr/bin/env node
// handrail-setup setup [--extension-id <id>]... | doctor | remove
// Normally run through the root scripts: npm run agent:setup | agent:doctor | agent:remove (they build Handrail first).
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { doctor, hasProblem, parseSetupArgs, remove, render, setup, type Line, type SetupEnv } from "../agent-setup.js";
import { channelDir, channelFilePath } from "../channel.js";
import { loadExtensionIdFromKey } from "../extension-id.js";
import { pidAlive, realFs, realRegistry, realRun } from "../system.js";

async function main(): Promise<number> {
  const { command, extensionIds } = parseSetupArgs(process.argv.slice(2));
  const handrailDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const repoRoot = resolve(handrailDir, "..", "..");
  const env: SetupEnv = {
    platform: process.platform,
    home: homedir(),
    dataDir: channelDir(),
    channelFile: channelFilePath(),
    repoRoot,
    handrailDir,
    nodePath: process.execPath,
    fs: realFs,
    registry: realRegistry,
    run: realRun,
    idFromKey: await loadExtensionIdFromKey(repoRoot),
    pidAlive,
  };

  if (command === "setup") {
    const built: Line = process.env["HANDRAIL_JUST_BUILT"] === "1"
      ? { status: "done", what: "Handrail program", detail: "built" }
      : { status: "unchanged", what: "Handrail program", detail: "built" };
    const lines = [built, ...setup(env, { extensionIds })];
    console.log(render("Distill agent setup", lines));
    if (hasProblem(lines)) {
      console.log("\nSome steps did not work. Each one above says how to fix it. Then run npm run agent:setup again.");
      return 1;
    }
    console.log([
      "",
      "Next: open the Distill panel on a page, then ask your agent: read this page with Distill.",
      "If Claude Code or agy was already running, start it again so it sees Handrail.",
      "To check everything later: npm run agent:doctor",
    ].join("\n"));
    return 0;
  }
  if (command === "doctor") {
    const lines = doctor(env);
    console.log(render("Distill agent check", lines));
    console.log(hasProblem(lines) ? "\nSomething is missing. Run the fix shown under it." : "\nEverything is in place.");
    return hasProblem(lines) ? 1 : 0;
  }
  if (command === "remove") {
    console.log(render("Distill agent removal", remove(env)));
    console.log("\nHandrail is removed from this computer's browsers and agents. Your other agent servers were not touched.");
    return 0;
  }
  throw new Error(`Unknown command "${command}". Use setup, doctor or remove.`);
}

main().then((code) => process.exit(code), (e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
