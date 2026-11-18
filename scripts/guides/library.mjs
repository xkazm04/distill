// The guide library on disk: guides/<country>/<slug>.json (see guides/README.md). Read by the apps' builds (the Vite
// plugin below), by `npm run check-guides`, and by the authoring scripts. Plain Node, no TypeScript, so a Vite config
// can import it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const GUIDES_DIR = join(REPO_ROOT, "guides");
/** Where the web app serves the library, relative to its base. One constant address: the request says nothing about
 *  the page the person is on. */
export const LIBRARY_PATH = "guides/library.json";
export const VIRTUAL_ID = "virtual:distill-guides";

/** Every guide file: { file (absolute), id ("cz/slug", from its place), text, json (or null), error }. Sorted by id. */
export function readGuideFiles(dir = GUIDES_DIR) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const country of readdirSync(dir).sort()) {
    const sub = join(dir, country);
    if (!statSync(sub).isDirectory()) continue;
    for (const name of readdirSync(sub).sort()) {
      if (!name.endsWith(".json")) continue;
      const file = join(sub, name);
      const id = relative(dir, file).replaceAll("\\", "/").replace(/\.json$/, "");
      const text = readFileSync(file, "utf8");
      let json = null;
      let error = null;
      try { json = JSON.parse(text); } catch (e) { error = `not valid JSON: ${e.message}`; }
      out.push({ file, id, text, json, error });
    }
  }
  return out;
}

/** True for a guide a person may be shown in this build: reviewed, the demo guide, or any guide when drafts are on. */
export const shippable = (g, drafts) => !!g && (g.status === "reviewed" || g.demo === true || drafts === true);

/** The library as the apps get it. Drafts are left out unless `drafts` (a developer's switch): nothing unreviewed is
 *  even in a build a person uses. Each app still passes every guide through the engine's door when it loads. */
export function libraryJson(drafts = false, dir = GUIDES_DIR) {
  const guides = readGuideFiles(dir).map((f) => f.json).filter((g) => shippable(g, drafts));
  return { version: 1, guides };
}

/**
 * Vite plugin. `as: "asset"` (the web app): the library is a file of the app, `guides/library.json`, fetched from the
 * app's own origin and matched on the device. `as: "module"` (the extension): the library is part of the bundle,
 * imported as `virtual:distill-guides`, so looking a guide up needs no network at all.
 */
export function guideLibrary({ as, drafts = false, dir = GUIDES_DIR }) {
  const RESOLVED = "\0" + VIRTUAL_ID;
  const watch = (ctx) => { for (const f of readGuideFiles(dir)) ctx.addWatchFile(f.file); };
  return {
    name: "distill-guide-library",
    resolveId: (id) => (as === "module" && id === VIRTUAL_ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      watch(this);
      return `export default ${JSON.stringify(libraryJson(drafts, dir))};`;
    },
    configureServer(server) {
      if (as !== "asset") return;
      server.middlewares.use(`/${LIBRARY_PATH}`, (_req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(libraryJson(drafts, dir)));
      });
    },
    generateBundle() {
      if (as !== "asset") return;
      watch(this);
      this.emitFile({ type: "asset", fileName: LIBRARY_PATH, source: JSON.stringify(libraryJson(drafts, dir)) });
    },
  };
}
