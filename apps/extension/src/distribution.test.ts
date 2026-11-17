// Build-it-yourself distribution: a built extension carries its builder's App Check debug token, so nothing in the
// repository may package or publish one (see README.md, "Why there is no download yet").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const PACKAGING = /\bzip\b|\.zip\b|\bcrx\b|chrome-webstore|webstore|\bpack\b|\bpublish\b/i;

describe("no packaged extension is published", () => {
  for (const file of ["package.json", "../../package.json"]) {
    it(`${file} has no packaging or publishing script`, () => {
      const scripts: Record<string, string> = JSON.parse(read(file)).scripts ?? {};
      for (const [name, cmd] of Object.entries(scripts)) expect(`${name}: ${cmd}`).not.toMatch(PACKAGING);
    });
  }
  it("the build output is ignored by git", () => {
    expect(read("../../.gitignore").split(/\r?\n/)).toContain("dist/");
  });
});
