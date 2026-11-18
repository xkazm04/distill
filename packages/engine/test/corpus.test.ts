// The form corpus and its baseline. These run in `npm run check`: the fixtures must be sound (their probes fail on the
// untouched page and pass after a by-hand fill), and no benchmark total may fall below test/corpus/baseline.json.
// The baseline changes only through `npm run bench:forms:update`; see test/corpus/README.md.
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkFixture, compareToBaseline, lintExpectation, loadCorpus, openFixture, probeCapabilities, readBaseline, runCorpus,
  type Capability, type CorpusResult,
} from "./bench/forms.js";

const corpus = loadCorpus();
let caps: Record<Capability, boolean>;
let result: CorpusResult;

beforeAll(async () => {
  caps = await probeCapabilities();
  result = await runCorpus(corpus);
}, 60_000);

describe("form corpus", () => {
  it("has the fixtures it promises, each with a page and a well-formed expectation", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(12);
    for (const fx of corpus) expect(lintExpectation(fx), fx.slug).toEqual([]);
  });

  it("knows what this environment can run: page scripts, shadow roots and srcdoc frames yes, declarative shadow roots no", () => {
    // If happy-dom gains declarative shadow DOM, this fails on purpose: re-run the bench and update the baseline.
    expect(caps).toEqual({ javascript: true, "shadow-dom": true, "iframe-srcdoc": true, "declarative-shadow-dom": false });
  });

  it("every fixture the environment can run is sound: probes fail untouched and pass after a by-hand fill", async () => {
    for (const fx of corpus) {
      if ((fx.expect.requires ?? []).some((c) => !caps[c])) continue;
      expect(await checkFixture(fx), fx.slug).toEqual([]);
    }
  }, 60_000);

  it("the framework fixture tells a naive write from a real one: a value set through the element's property never reaches the app state", async () => {
    const fx = corpus.find((f) => f.slug === "framework-controlled")!;
    const w = await openFixture(fx);
    const doc = w.document as unknown as Document;
    const el = doc.getElementById("jmeno") as HTMLInputElement;
    el.value = "Olena";
    el.dispatchEvent(new w.Event("input", { bubbles: true }) as unknown as Event);
    expect(doc.getElementById("davka")!.getAttribute("data-state-jmeno")).toBe("");
    await w.happyDOM.close();
  });

  it("leaves out of the totals only the fixtures the environment cannot run", () => {
    const skipped = result.fixtures.filter((f) => !f.measurable).map((f) => `${f.slug}: ${f.reason}`);
    expect(skipped).toEqual(["declarative-shadow: this environment (happy-dom) has no declarative-shadow-dom"]);
  });

  it("no total falls below the stored baseline", () => {
    expect(compareToBaseline(result, readBaseline())).toEqual([]);
  });
});
