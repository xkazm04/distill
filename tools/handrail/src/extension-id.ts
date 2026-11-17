// The extension id that Chrome gives an extension whose manifest carries `key`. The rule lives in one place,
// scripts/extension-id.mjs (shared with the release packer); it sits outside this package's rootDir, so it is loaded
// at run time from the checkout this Handrail was built in.
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type ExtensionIdFromKey = (base64Key: string) => string;

export async function loadExtensionIdFromKey(repoRoot: string): Promise<ExtensionIdFromKey> {
  const script = path.join(repoRoot, "scripts", "extension-id.mjs");
  if (!existsSync(script)) throw new Error(`${script} is missing. Run this from a full Distill checkout.`);
  const mod = (await import(pathToFileURL(script).href)) as { extensionIdFromKey?: unknown };
  if (typeof mod.extensionIdFromKey !== "function") throw new Error(`${script} has no extensionIdFromKey.`);
  return mod.extensionIdFromKey as ExtensionIdFromKey;
}
