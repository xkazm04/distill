import { describe, expect, it } from "vitest";
import { prompts, schemas, validateAndRepair, type PageModel } from "../src/index.js";

const FORBIDDEN = ["$ref", "oneOf", "anyOf", "allOf", "$defs", "definitions", "additionalProperties", "patternProperties"];
const ALLOWED = new Set(["type", "properties", "required", "items", "enum"]);

function walk(node: unknown, path: string): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => walk(n, `${path}[${i}]`));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const o = node as Record<string, unknown>;
  if (typeof o.type === "string") {
    for (const k of Object.keys(o)) expect(ALLOWED.has(k), `${path}.${k}`).toBe(true);
    for (const k of FORBIDDEN) expect(k in o, `${path}.${k}`).toBe(false);
  }
  for (const [k, v] of Object.entries(o)) if (k !== "enum" && k !== "required") walk(v, `${path}.${k}`);
}

describe("schemas", () => {
  it("are plain JSON and stay in the common subset", () => {
    for (const [name, s] of Object.entries(schemas)) {
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      expect((s as { type: string }).type).toBe("object");
      walk(s, name);
    }
  });

  it("recast schema agrees with the validator's vocabulary", () => {
    const recast = schemas.recast as { properties: { nodes: { items: { properties: { kind: { enum: string[] } } } } } };
    const kinds = recast.properties.nodes.items.properties.kind.enum;
    for (const k of kinds) {
      const r = validateAndRepair({ nodes: [{ kind: k, sourceBlockIds: [] }] });
      expect(r.reasons.join()).not.toMatch(/not a section type/);
    }
    expect(kinds).toHaveLength(7);
  });
});

describe("prompts", () => {
  const page: PageModel = {
    url: "https://x.example/",
    title: "T",
    lang: "cs",
    kind: "article",
    blocks: [
      { id: "b0", kind: "heading", level: 1, text: "Nadpis" },
      { id: "b1", kind: "paragraph", text: "Text stránky." },
    ],
  };
  it("number blocks by id, name the output shape and default the reader language to English", () => {
    expect(prompts.simplifyBlocks(page, "plain", "en")).toContain("[b1]");
    expect(prompts.simplifyBlocks(page, "plain", "en")).toContain("English");
    expect(prompts.recast(page, ["summary"])).toContain("sourceBlockIds");
    expect(prompts.classifyPage(page)).toContain("JSON");
    expect(prompts.readLetter("Vážený pane", "en")).toContain("Vážený pane");
  });
});
