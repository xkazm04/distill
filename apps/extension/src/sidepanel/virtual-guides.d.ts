// The guide library, bundled at build time by scripts/guides/library.mjs (guideLibrary({ as: "module" })). Raw JSON:
// every guide still passes the engine's door (parseLibrary) before the panel uses it.
declare module "virtual:distill-guides" {
  const library: { version: 1; guides: unknown[] };
  export default library;
}
