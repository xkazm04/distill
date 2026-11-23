// Round 2, card 2: the door for a web check's answer (parseCheck). The model's answer and the sources are untrusted;
// only a verdict from the closed set, plain words and the service's own search results pass.
import { describe, expect, it } from "vitest";
import { CLAIM_VERDICTS, parseCheck, prompts, REASON_MAX, route, schemas, SOURCES_MAX, type CheckSource } from "../src/index.js";

const G: CheckSource[] = [
  { title: "Example News", url: "https://example.com/a" },
  { title: "Example Encyclopedia", url: "https://example.org/b" },
];

describe("parseCheck", () => {
  it("passes a good answer with the service's sources", () => {
    const r = parseCheck({ verdict: "supported", reason: "Two agencies report the same figure." }, G, "c1");
    expect(r).toEqual({
      dropped: 0,
      check: { claimId: "c1", verdict: "supported", reason: "Two agencies report the same figure.", sources: G },
    });
  });

  it("accepts every verdict of the closed set, and nothing else", () => {
    for (const v of CLAIM_VERDICTS) expect(parseCheck({ verdict: v, reason: "x" }, [], "c0").check?.verdict).toBe(v);
    for (const v of ["true", "Supported", "false", "unknown", "", 1, null]) {
      expect(parseCheck({ verdict: v, reason: "x" }, G, "c0")).toEqual({ check: null, dropped: 1 });
    }
    expect(parseCheck({ reason: "no verdict" }, G, "c0")).toEqual({ check: null, dropped: 1 });
  });

  it("refuses an answer that is not an object, and counts it", () => {
    for (const a of [null, undefined, 3, [], ["supported"], "Sure! It is true.", "{not json"]) {
      expect(parseCheck(a, G, "c0")).toEqual({ check: null, dropped: 1 });
    }
  });

  it("reads JSON written as text, with a fence or words around it (no schema with the search tool)", () => {
    expect(parseCheck('```json\n{"verdict":"mixed","reason":"Partly."}\n```', [], "c2").check).toMatchObject({ verdict: "mixed", reason: "Partly." });
    expect(parseCheck('Here you go: {"verdict":"disputed","reason":"No."} Hope it helps.', [], "c2").check).toMatchObject({ verdict: "disputed" });
  });

  it("takes HTML out of the reason and counts it", () => {
    const r = parseCheck({ verdict: "disputed", reason: '<b>Officials</b> say <script>alert(1)</script>the number is <a href="x">lower</a>.' }, [], "c0");
    expect(r.check?.reason).toBe("Officials say alert(1) the number is lower.");
    expect(r.check?.reason).not.toMatch(/[<>]/);
    expect(r.dropped).toBe(1);
    expect(parseCheck({ verdict: "mixed", reason: "a < b > c" }, [], "c0").check?.reason).toBe("a b c");
  });

  it("takes links out of the reason and counts them", () => {
    const r = parseCheck({ verdict: "supported", reason: "See https://evil.example/x?y=1 and www.other.example for details." }, [], "c0");
    expect(r.check?.reason).toBe("See and for details.");
    expect(r.check?.reason).not.toMatch(/https?:|www\./);
    expect(r.dropped).toBe(1);
  });

  it("caps the reason at about 240 characters, at a word", () => {
    const long = `${"The agency revised the figure several times ".repeat(12)}end.`;
    const r = parseCheck({ verdict: "mixed", reason: long }, [], "c0");
    expect(r.check!.reason.length).toBeLessThanOrEqual(REASON_MAX);
    expect(r.check!.reason.endsWith("...")).toBe(true);
    expect(r.check!.reason).not.toMatch(/\s\.\.\.$/);
    expect(r.dropped).toBe(0);
  });

  it("an absent reason is empty; a reason that is not text is refused", () => {
    expect(parseCheck({ verdict: "notFound" }, [], "c0")).toEqual({ dropped: 0, check: { claimId: "c0", verdict: "notFound", reason: "", sources: [] } });
    expect(parseCheck({ verdict: "notFound", reason: { html: "<b>x</b>" } }, [], "c0")).toMatchObject({ dropped: 1, check: { reason: "" } });
  });

  it("never shows a link the model wrote itself: sources come only from the grounding", () => {
    const r = parseCheck({
      verdict: "supported", reason: "Confirmed.",
      sources: [{ title: "Made up", url: "https://made-up.example" }, "https://also-made-up.example"],
      links: ["https://x.example"], url: undefined,
    }, [G[0]!], "c0");
    expect(r.check?.sources).toEqual([G[0]]);
    expect(JSON.stringify(r.check)).not.toContain("made-up");
    expect(r.dropped).toBe(3);
  });

  it("accepts https sources only, and counts the others", () => {
    const r = parseCheck({ verdict: "supported", reason: "x" }, [
      { title: "Plain", url: "http://example.net/x" },
      { title: "Script", url: "javascript:alert(1)" },
      { title: "Data", url: "data:text/html,<b>x</b>" },
      { title: "Broken", url: "not a url" },
      { title: "", url: "" },
      ...G,
    ], "c0");
    expect(r.check?.sources).toEqual(G);
    expect(r.dropped).toBe(5);
  });

  it("lists the same address once, at most five, without counting the service's repeats", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ title: `S${i}`, url: `https://s${i}.example/p` }));
    const r = parseCheck({ verdict: "supported", reason: "x" }, [G[0]!, G[0]!, ...many], "c0");
    expect(r.check?.sources).toHaveLength(SOURCES_MAX);
    expect(r.check?.sources.map((s) => s.url)).toEqual([G[0]!.url, ...many.slice(0, 4).map((s) => s.url)]);
    expect(r.dropped).toBe(0);
  });

  it("keeps the grounding service's redirect links, titled by their page, never by the redirect host", () => {
    const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQabc123";
    const r = parseCheck({ verdict: "disputed", reason: "x" }, [{ title: "reuters.com", url: redirect }, { title: "", url: `${redirect}xyz` }], "c0");
    expect(r.check?.sources).toEqual([{ title: "reuters.com", url: redirect }, { title: "A web source", url: `${redirect}xyz` }]);
  });

  it("source titles are plain text, short, and fall back to the host", () => {
    const r = parseCheck({ verdict: "supported", reason: "x" }, [
      { title: "<img src=x onerror=alert(1)>Agency <i>report</i>", url: "https://www.agency.example/r" },
      { title: "", url: "https://www.stats.example/t" },
      { title: "A".repeat(200), url: "https://long.example" },
    ], "c0");
    expect(r.check?.sources.map((s) => s.title)).toEqual(["Agency report", "stats.example", `${"A".repeat(87)}...`]);
  });
});

describe("checkClaim contract", () => {
  it("routes only in the cloud, as a page task, whatever is configured", () => {
    for (const cfg of ["only_on_device", "prefer_on_device", "prefer_in_cloud", "only_in_cloud", undefined]) {
      expect(route("checkClaim", cfg)).toMatchObject({ promptClass: "page", mode: "only_in_cloud" });
    }
  });

  it("the schema has a verdict and a reason, and no sources", () => {
    const s = schemas.check as { properties: Record<string, { enum?: string[] }> };
    expect(Object.keys(s.properties).sort()).toEqual(["reason", "verdict"]);
    expect(s.properties.verdict?.enum).toEqual([...CLAIM_VERDICTS]);
  });

  it("the prompt asks for JSON with the closed verdicts and no links", () => {
    const p = prompts.checkClaim("The city has 1.3 million people.", "Prague today", "https://news.example/a", "en");
    for (const v of CLAIM_VERDICTS) expect(p).toContain(`"${v}"`);
    expect(p).toMatch(/No links in the reason/);
  });
});
