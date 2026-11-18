/// <reference types="node" />
// `npm run bench:forms` prints the form benchmark table; `npm run bench:forms:update` also rewrites
// test/corpus/baseline.json. Not part of `npm test` (the file name does not end in .test.ts); the gate lives in
// test/corpus.test.ts.
import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import { BASELINE_PATH, compareToBaseline, formatTable, readBaseline, runCorpus, writeBaseline } from "./forms.js";

it("form benchmark", async () => {
  const r = await runCorpus();
  const lines = [formatTable(r), ""];
  if (process.env.BENCH_UPDATE === "1") {
    writeBaseline(r);
    lines.push("Baseline written to test/corpus/baseline.json. Commit it on purpose, with the reason in the message.");
  } else if (!existsSync(BASELINE_PATH)) {
    lines.push("No baseline yet: run npm run bench:forms:update to write one.");
  } else {
    const worse = compareToBaseline(r, readBaseline());
    lines.push(worse.length ? `Below the baseline:\n  ${worse.join("\n  ")}` : "At or above the stored baseline.");
  }
  process.stdout.write(`\n${lines.join("\n")}\n`);
  expect(r.fixtures.length).toBeGreaterThan(0);
}, 120_000);
