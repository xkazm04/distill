// r3-03: the proof page's build gate, its saved pages and its report. The page itself runs end to end in
// e2e/proof.spec.ts (real Chromium, the stand-in model); here: it is never in the public build, the fixtures carry no
// script, image, tracker or personal data, and the report says, per task, where it ran, how long it took and what the
// door left out.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inputsOf } from "../../vite.config";
import { answerLine, PROOF_KIND, PROOF_TASKS, toMarkdown, type ProofReport } from "./report";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the build", () => {
  it("has the proof page in the developer's own build only", () => {
    expect(inputsOf("own").proof).toBe("proof.html");
    expect(inputsOf("public")).not.toHaveProperty("proof");
    expect(Object.keys(inputsOf("public"))).toEqual(["sidepanel", "caption", "offscreen", "background"]);
  });

  it("check-dist fails a public build with the page or its report marker", () => {
    const src = read("../../scripts/check-dist.mjs");
    expect(src).toContain(`[/${PROOF_KIND}/, "the developer-only proof page`);
    expect(src).toMatch(/kind === "public" && existsSync\(join\(dist, "proof\.html"\)\)/);
  });

  it("the manifest does not expose it to web pages", () => {
    expect(read("public/manifest.json")).not.toContain("proof");
  });
});

describe("the saved pages", () => {
  const list = JSON.parse(read("proof/fixtures/fixtures.json")) as { id: string; url: string; title: string; lang: string; savedOn: string }[];

  it("are the Deník and Aktuálně articles and Přáslavice's village office page", () => {
    expect(list.map((f) => f.id)).toEqual(["denik", "aktualne", "praslavice"]);
    expect(list.map((f) => new URL(f.url).host)).toEqual(["www.denik.cz", "zpravy.aktualne.cz", "www.praslavice.cz"]);
  });

  for (const id of ["denik", "aktualne", "praslavice"]) {
    it(`${id}: trimmed, with no script, image, frame, tracker, e-mail address or phone number`, () => {
      const html = read(`proof/fixtures/${id}.html`);
      const meta = list.find((f) => f.id === id)!;
      expect(html).toContain(`<html lang="${meta.lang}">`);
      expect(html).toContain("<title>");
      expect(html).toMatch(/<h1>/);
      expect(html).not.toMatch(/<(script|img|iframe|picture|video|svg|object|embed|link|style)\b/i);
      expect(html).not.toMatch(/\bon[a-z]+=/i);
      expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(html).not.toMatch(/(\+420\s?)?\b[1-9]\d{2}\s?\d{3}\s?\d{3}\b/);
      expect(html).not.toMatch(/vvbox|doubleclick|googletag|recaptcha|utm_/i);
      expect(html).not.toMatch(/\bvalue="[^"0-9][^"]*"/); // no typed form value (the select's option numbers stay)
      expect(html.length).toBeLessThan(12_000);
    });
  }
});

describe("the report", () => {
  const rep: ProofReport = {
    kind: PROOF_KIND, version: 1, startedAt: "2026-11-23T10:00:00.000Z", finishedAt: "2026-11-23T10:01:00.000Z",
    build: { variant: "own", mode: "production", extension: "0.2.0", userAgent: "Chrome" }, reader: "en",
    model: { before: "available", after: "available" }, available: true,
    fixtures: [{
      id: "denik", url: "https://www.denik.cz/a/", title: "Příspěvek | Deník", savedOn: "2026-11-23",
      clean: { kind: "article", lang: "cs", removed: 2, blocks: 14, ms: 12 },
      tasks: [
        { task: "translate", status: "ok", source: "on_device", ms: 4210, calls: 1, dropped: 1, answer: { from: "cs", to: "en", translated: 13, total: 14, sample: [{ id: "t0", source: "Řada", text: "Many people | leave money" }] } },
        { task: "claims", status: "ok", source: "on_device", ms: 900, calls: 1, dropped: 0, answer: { candidates: 9, claims: [{ text: "x", why: "number" }] } },
        { task: "gist", status: "failed", source: "on_device", ms: 800, calls: 1, dropped: 3, answer: { points: [], from: [] }, error: { kind: "door", words: "the AI's answer could not be used", raw: "" } },
        { task: "plain", status: "ok", source: "in_cloud", ms: 3000, calls: 2, dropped: 1, answer: { lang: "en", applied: 10, total: 12, lostFacts: 1, lostKinds: ["number"], sample: [] } },
        { task: "check", status: "ok", source: "in_cloud", ms: 5000, calls: 1, dropped: 1, answer: { checks: [{ verdict: "supported", sources: [{}, {}], suggestions: true }] } },
      ],
    }],
  };

  it("names every task the page runs", () => {
    expect(PROOF_TASKS).toEqual(["translate", "claims", "gist", "plain", "check"]);
  });

  it("as Markdown: a row per task with where it ran, the time, the door's count and the answer, then each answer in full", () => {
    const md = toMarkdown(rep);
    expect(md).toContain("- On-device model: available at the start, available at the end");
    expect(md).toContain("Clean read an article page in cs: 14 blocks of main text, 2 things it would hide (12 ms).");
    expect(md).toContain("| translate | ok | on device | 4210 ms | 1 | 1 | 13/14 blocks; first: Many people \\| leave money |");
    expect(md).toContain("| gist | failed | on device | 800 ms | 1 | 3 | failed: the AI's answer could not be used (door) |");
    expect(md).toContain("| check | ok | in cloud | 5000 ms | 1 | 1 | supported (2 sources, suggestions) |");
    expect(md).toContain("### denik: plain");
    expect(md).toContain('"lostKinds": [\n    "number"\n  ]');
  });

  it("a skipped task says why", () => {
    expect(answerLine({ task: "claims", status: "skipped", note: "not an article", ms: 0, calls: 0, dropped: 0 })).toBe("skipped: not an article");
  });
});
