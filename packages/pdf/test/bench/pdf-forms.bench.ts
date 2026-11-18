/// <reference types="node" />
// `npm run bench:forms -w @distill/pdf` prints the PDF form benchmark; `npm run bench:forms:update -w @distill/pdf`
// also rewrites test/corpus/baseline.json. Not part of `npm test` (the file name does not end in .test.ts); the gate
// lives in test/corpus.test.ts.
import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import { BASELINE_PATH, compareToBaseline, formatTable, readBaseline, runCorpus, writeBaseline } from "./pdf-forms.js";
import { formatPrintTable, loadPrintCorpus, runPrintCorpus } from "./print-forms.js";

it("PDF form benchmark", async () => {
  const r = await runCorpus();
  const corpus = loadPrintCorpus();
  const p = await runPrintCorpus(corpus);
  const heldOut = new Set(corpus.filter((f) => f.expect.heldOut).map((f) => f.slug));
  const lines = [formatTable(r), "", formatPrintTable(p, heldOut), ""];
  if (process.env.BENCH_UPDATE === "1") {
    writeBaseline(r, p);
    lines.push("Baseline written to test/corpus/baseline.json. Commit it on purpose, with the reason in the message.");
  } else if (!existsSync(BASELINE_PATH)) {
    lines.push("No baseline yet: run npm run bench:forms:update -w @distill/pdf to write one.");
  } else {
    const worse = compareToBaseline(r, readBaseline(), p);
    lines.push(worse.length ? `Below the baseline:\n  ${worse.join("\n  ")}` : "At or above the stored baseline.");
  }
  process.stdout.write(`\n${lines.join("\n")}\n`);
  expect(r.fixtures.length).toBeGreaterThan(0);
}, 300_000);
