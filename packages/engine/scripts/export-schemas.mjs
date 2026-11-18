// Writes packages/engine/schemas/*.json from src/schemas.ts, for the Android app and the guide library check.
// Run: npm run export-schemas -w @distill/engine
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileSchemas, schemas } from "../src/schemas.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
mkdirSync(out, { recursive: true });
for (const [name, schema] of Object.entries({ ...schemas, ...fileSchemas })) {
  writeFileSync(join(out, `${name}.json`), JSON.stringify(schema, null, 2) + "\n");
  console.log(`wrote schemas/${name}.json`);
}
