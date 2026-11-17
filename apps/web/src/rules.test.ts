import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertNoValues } from "./ui/data";

const rules = readFileSync(resolve(process.cwd(), "../../firestore.rules"), "utf8").replace(/\/\/.*$/gm, "");

/** The body of the first `match <path> {...}` found in `src`, with nested blocks kept. */
function block(src: string, path: string): string {
  const start = src.indexOf(`match ${path} {`);
  if (start < 0) throw new Error(`no match block for ${path}`);
  const open = start + `match ${path} `.length; // the path itself has braces ({uid}), so count from after it
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unclosed block for ${path}`);
}

/** The body with every nested `match` block cut out: only this level's own allow statements stay. */
const ownLevel = (body: string): string => {
  let out = body;
  for (let m = /match \S+ \{/.exec(out); m; m = /match \S+ \{/.exec(out)) out = out.replace(`${m[0]}${block(out, m[0].slice(6, -2))}}`, "");
  return out;
};

const allows = (body: string): string[] => body.split(/(?=allow )/).filter((s) => s.startsWith("allow ")).map((s) => s.slice(0, s.indexOf(";") + 1).replace(/\s+/g, " ").trim());

const documents = block(rules, "/databases/{database}/documents");
const users = block(documents, "/users/{uid}");
const guides = block(users, "/formGuides/{fingerprint}");

describe("firestore.rules", () => {
  it("keeps form guides per person: only the owner reads or writes users/{uid}/formGuides", () => {
    const stmts = allows(guides);
    expect(stmts.map((s) => s.split(":")[0])).toEqual(["allow read, delete", "allow create, update"]);
    for (const s of stmts) expect(s).toMatch(/: if isOwner\(uid\)( |;)/);
    expect(guides).not.toMatch(/signedIn\(\)/);
  });

  it("keeps the FormGuideDoc shape check and refuses a values key at every level", () => {
    for (const must of [
      "!('values' in request.resource.data)",
      "request.resource.data.keys().hasOnly(['structure', 'wizard', 'updatedAt'])",
      "request.resource.data.structure.keys().hasOnly(['fingerprint', 'url', 'lang', 'title', 'fields'])",
      "!('values' in request.resource.data.structure)",
      "request.resource.data.structure.fingerprint == fingerprint",
      "request.resource.data.wizard.keys().hasOnly(['fingerprint', 'readerLang', 'steps'])",
      "!('values' in request.resource.data.wizard)",
      "request.resource.data.wizard.fingerprint == fingerprint",
    ]) expect(guides).toContain(must);
  });

  it("closes the old shared top-level formGuides path", () => {
    const top = documents.replace(`match /users/{uid} {${users}}`, "");
    expect(top).toContain("match /formGuides/{fingerprint} {");
    const shared = block(top, "/formGuides/{fingerprint}");
    expect(allows(shared)).toEqual(["allow read, write: if false;"]);
  });

  it("lets a user touch only their own documents, and denies everything else", () => {
    for (const s of allows(ownLevel(users))) expect(s).toMatch(/: if isOwner\(uid\)/);
    for (const s of allows(block(users, "/glossary/{termId}"))) expect(s).toMatch(/: if isOwner\(uid\)/);
    expect(allows(block(documents, "/{document=**}"))).toEqual(["allow read, write: if false;"]);
    // Every rule that grants anything is an owner rule.
    for (const s of allows(rules)) expect(s.endsWith("if false;") || /: if isOwner\(uid\)/.test(s)).toBe(true);
  });
});

describe("assertNoValues", () => {
  it("refuses a values key and accepts a guide", () => {
    expect(() => assertNoValues({ structure: { fields: [] }, values: { a: "1" } })).toThrow();
    expect(() => assertNoValues({ structure: { fields: [{ options: [{ value: "x", label: "x" }] }] } })).not.toThrow();
  });
});
