// Distribution: only the on-device public build is ever packaged, and only after check-dist. The own build (dist)
// carries its builder's App Check debug token, so nothing in the repository may package or publish it (README.md).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extensionIdFromKey } from "../../../scripts/extension-id.mjs";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const PACKAGING = /\bzip\b|\.zip\b|\bcrx\b|chrome-webstore|webstore|\bpack\b|\bpublish\b|pack-extension/i;
const scriptsOf = (file: string): Record<string, string> => JSON.parse(read(file)).scripts ?? {};

describe("only the public build is packaged", () => {
  it("the extension package has no packaging script", () => {
    for (const [name, cmd] of Object.entries(scriptsOf("package.json"))) expect(`${name}: ${cmd}`).not.toMatch(PACKAGING);
  });

  it("the root's only packaging scripts are pack:extension and pack:store, both through pack-extension.mjs", () => {
    const packaging = Object.entries(scriptsOf("../../package.json")).filter(([n, c]) => PACKAGING.test(`${n}: ${c}`));
    expect(Object.fromEntries(packaging)).toEqual({
      "pack:extension": "node scripts/pack-extension.mjs",
      "pack:store": "node scripts/pack-extension.mjs --store",
    });
  });

  it("pack-extension builds and zips dist-public only, and runs check-dist before it writes a zip", () => {
    const src = read("../../scripts/pack-extension.mjs");
    expect(src).toMatch(/const DIST = `\$\{EXT\}\/dist-public`;/);
    expect(src).toContain('"build:public"');
    expect(src).not.toMatch(/apps\/extension\/dist["'`/]/); // never the own build
    const check = src.indexOf('run(process.execPath, ["scripts/check-dist.mjs", DIST])');
    const write = src.indexOf("writeFileSync(file, zip(entries))");
    expect(check).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(check);
  });

  it("the store copy strips the key and the download keeps it", () => {
    const src = read("../../scripts/pack-extension.mjs");
    expect(src).toMatch(/store \? Buffer\.from\(JSON\.stringify\(withoutKey/);
    expect(src).toContain('fail("the store copy still has a `key`")');
    expect(src).toContain('fail("the download lost its `key`")');
  });

  it("build output and release zips are ignored by git", () => {
    const lines = read("../../.gitignore").split(/\r?\n/);
    for (const l of ["dist/", "dist-public/", "apps/extension/release/", "*.pem"]) expect(lines).toContain(l);
  });
});

describe("extension id from the manifest key", () => {
  it("follows Chrome's rule: sha256 of the DER key, first 32 hex digits mapped 0-f -> a-p", () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223... (FIPS 180-2 test vector), mapped by `tr '0-9a-f' 'a-p'`.
    expect(extensionIdFromKey("YWJj")).toBe("lkhibglpipabmpokebebeanofnkocccd");
  });

  it("gives the committed key's id (derived independently with openssl dgst -sha256 | tr)", () => {
    const { key } = JSON.parse(read("public/manifest.json")) as { key: string };
    expect(extensionIdFromKey(key)).toBe("pbmfhppffaiedhljpgpigancfhknohol");
    expect(extensionIdFromKey(` ${key.slice(0, 50)}\n${key.slice(50)} `)).toBe("pbmfhppffaiedhljpgpigancfhknohol");
  });

  it("refuses an empty key", () => {
    expect(() => extensionIdFromKey("")).toThrow(/empty/);
  });
});
