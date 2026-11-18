// The PDF form corpus and its baseline, in `npm run check`: the fixtures must be sound (a probe of an answer fails on
// the untouched file and passes after a fill with pdf-lib's own API), every PDF Distill cannot fill is refused with
// the right reason, and no total may fall below test/corpus/baseline.json. The baseline changes only through
// `npm run bench:forms:update -w @distill/pdf`; see the PDF section of packages/engine/test/corpus/README.md.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkFixture, compareReader, compareToBaseline, lintExpectation, loadCorpus, readBaseline, readerSnapshot, READER_PATH, runCorpus, type CorpusResult, type ReaderSnapshot } from "./bench/pdf-forms.js";
import { checkPrintFixture, lintPrint, loadPrintCorpus, runPrintCorpus, type PrintCounts, type PrintResult } from "./bench/print-forms.js";

const corpus = loadCorpus();
const printCorpus = loadPrintCorpus();
let result: CorpusResult;
let printed: { fixtures: PrintResult[]; totals: PrintCounts };

beforeAll(async () => {
  result = await runCorpus(corpus);
  printed = await runPrintCorpus(printCorpus);
}, 240_000);

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
    expect(result.refusals.map((r) => r.want).sort()).toEqual(["encrypted", "flat", "locked", "password", "scan", "xfa", "xfa"]);
  });

  it("makes no false claim: nothing reported written that pdf.js does not see in the saved file", () => {
    expect(result.totals.falseClaims).toBe(0);
  });

  it("no total falls below the stored baseline, the print-only section included", () => {
    expect(compareToBaseline(result, readBaseline(), printed)).toEqual([]);
  });
});

describe("print-only PDF corpus", () => {
  it("has its fixtures, each well-formed", () => {
    expect(printCorpus.length).toBeGreaterThanOrEqual(4);
    for (const fx of printCorpus) expect(lintPrint(fx), fx.slug).toEqual([]);
  });

  it("every fixture is sound: no probe holds on the untouched file, and drawing the answers with pdf-lib alone passes them all", async () => {
    for (const fx of printCorpus) expect(await checkPrintFixture(fx), fx.slug).toEqual([]);
  }, 60_000);

  it("makes no false claim: nothing reported written that pdf.js does not find at its place", () => {
    expect(printed.totals.falseClaims).toBe(0);
  });
});

describe("the PDF reader's version", () => {
  it("names what the reader reads: a change to the corpus's titles, field ids, kinds or labels comes with a new PDF_READER", async () => {
    const stored = JSON.parse(readFileSync(READER_PATH, "utf8")) as ReaderSnapshot;
    expect(compareReader(await readerSnapshot(), stored)).toEqual([]);
  }, 60_000);
});
