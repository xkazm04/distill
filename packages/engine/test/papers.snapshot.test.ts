// Papers by label (L1): conceptOf over every field of the Czech guides and the form corpus, against a person-checkable
// expectation file (test/fixtures/papers-concepts.json: fieldId -> concept or "none"). A change to the label table that
// moves any field shows here, field by field, for a person to read.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { conceptsOf, extractForm, guideStructure, type FormGuide, type FormStructure } from "../src/index.js";
import { loadCorpus, openFixture } from "./bench/forms.js";

const here = dirname(fileURLToPath(import.meta.url));
const GUIDES = resolve(here, "../../../guides/cz");
const EXPECT = join(here, "fixtures/papers-concepts.json");

type Table = Record<string, Record<string, string>>;

async function actual(): Promise<Table> {
  const out: Table = {};
  const add = (key: string, s: Pick<FormStructure, "fields" | "lang">) => {
    const c = conceptsOf(s);
    out[key] = Object.fromEntries(s.fields.map((f) => [f.fieldId, c[f.fieldId] ?? "none"]));
  };
  for (const file of readdirSync(GUIDES).filter((f) => f.endsWith(".json")).sort()) {
    const g = JSON.parse(readFileSync(join(GUIDES, file), "utf8")) as FormGuide;
    if (g.demo) continue;
    add(`guide:${g.id}`, guideStructure(g));
  }
  for (const fx of loadCorpus()) {
    const w = await openFixture(fx);
    try {
      add(`corpus:${fx.slug}`, await extractForm(w.document as unknown as Document, `https://corpus.example/${fx.slug}`));
    } finally {
      await w.happyDOM.close();
    }
  }
  return out;
}

describe("papers by label over the guides and the corpus", () => {
  it("every field gets exactly the concept in the person-checked expectation file", async () => {
    const got = await actual();
    if (process.env.PAPERS_UPDATE === "1") writeFileSync(EXPECT, JSON.stringify(got, null, 2) + "\n");
    const want = JSON.parse(readFileSync(EXPECT, "utf8")) as Table;
    expect(got).toEqual(want);
  }, 60_000);
});
