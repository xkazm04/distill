// The PDF form corpus and its baseline, in `npm run check`: the fixtures must be sound (a probe of an answer fails on
// the untouched file and passes after a fill with pdf-lib's own API), every PDF Distill cannot fill is refused with
// the right reason, and no total may fall below test/corpus/baseline.json. The baseline changes only through
// `npm run bench:forms:update -w @distill/pdf`; see the PDF section of packages/engine/test/corpus/README.md.
import { beforeAll, describe, expect, it } from "vitest";
import { checkFixture, compareToBaseline, lintExpectation, loadCorpus, readBaseline, runCorpus, type CorpusResult } from "./bench/pdf-forms.js";

const corpus = loadCorpus();
let result: CorpusResult;

beforeAll(async () => {
  result = await runCorpus(corpus);
}, 120_000);

describe("PDF form corpus", () => {
  it("has the fixtures it promises, each well-formed", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(6);
    for (const fx of corpus) expect(lintExpectation(fx), fx.slug).toEqual([]);
  });

  it("every fixture is sound: probes of answers fail untouched, pre-filled values hold, and a plain pdf-lib fill passes them all", async () => {
    for (const fx of corpus) expect(await checkFixture(fx), fx.slug).toEqual([]);
  }, 60_000);

  it("refuses every PDF it cannot fill, with the right reason", () => {
    expect(result.refusals.filter((r) => r.got !== r.want)).toEqual([]);
    expect(result.refusals.map((r) => r.want).sort()).toEqual(["encrypted", "flat", "locked", "password", "xfa", "xfa"]);
  });

  it("makes no false claim: nothing reported written that pdf.js does not see in the saved file", () => {
    expect(result.totals.falseClaims).toBe(0);
  });

  it("no total falls below the stored baseline", () => {
    expect(compareToBaseline(result, readBaseline())).toEqual([]);
  });
});
