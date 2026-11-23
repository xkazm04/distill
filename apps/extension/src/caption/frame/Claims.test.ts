// Claims to check (r2-01) and the gist (r2-10), the frame side: which pages are articles, the status line's count and
// the source chip with the page tasks in it.
import { describe, expect, it } from "vitest";
import type { CleanReport, TextBlock } from "../../messages";
import { withPageTasks, type ClaimsState } from "./Claims";
import { articleLike, firstPart } from "./mainText";
import { statusLine } from "./status";
import { sourceChip, type TranslateState } from "./Translate";

const report = (kind: CleanReport["kind"] = "article"): CleanReport => ({
  items: [], restored: [], lang: "en", kind, unlockedScroll: false, langFrom: "page", widened: 0, comfort: 0,
  calm: { media: 0, motion: 0 }, unstuck: 0, tables: 0,
});
const idle: TranslateState = { phase: "idle", showingSource: false };
const blocks = (n: number, len: number): TextBlock[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, text: "x".repeat(len) }));
const claim = (id: string) => ({ id, blockId: "m0", text: "x", why: "number" as const });
const noClaims: ClaimsState = { phase: "none", claims: [], dropped: 0 };
const noGist = { phase: "none", points: [] };

describe("articleLike", () => {
  it("needs three blocks and 600 characters of main text", () => {
    expect(articleLike(report(), blocks(3, 200))).toBe(true);
    expect(articleLike(report(), blocks(2, 400))).toBe(false);
    expect(articleLike(report(), blocks(5, 100))).toBe(false);
  });
  it("is never a form, a product or a listing", () => {
    for (const kind of ["form", "product", "listing"] as const) expect(articleLike(report(kind), blocks(10, 200))).toBe(false);
    expect(articleLike(report("other"), blocks(10, 200))).toBe(true);
  });
  it("sends the first part of a long article only", () => {
    expect(firstPart(blocks(10, 1000), 3500)).toHaveLength(3);
    expect(firstPart(blocks(1, 9000), 3500)).toHaveLength(1); // one long block still goes
  });
});

describe("the status line's count", () => {
  it("counts the claims to check, only when there are some", () => {
    expect(statusLine(report(), idle, 6)).toBe("Nothing to remove · 6 claims to check");
    expect(statusLine(report(), idle, 1)).toBe("Nothing to remove · 1 claim to check");
    expect(statusLine(report(), idle, 0)).toBe("Nothing to remove");
    expect(statusLine(report(), idle)).toBe("Nothing to remove");
  });
});

describe("the chip with the page tasks", () => {
  it("says No AI used while nothing ran, with the counts for the live run", () => {
    const chip = withPageTasks(sourceChip(idle), { ...noClaims, noModel: true, candidates: 9 }, noGist);
    expect(chip.text).toBe("No AI used");
    expect(chip.data["data-claims"]).toBe("0/9");
    expect(chip.data["data-claims-phase"]).toBe("none");
  });
  it("says where the claims and the gist ran when no translation is on the page", () => {
    const claims: ClaimsState = { phase: "ready", claims: [claim("c0"), claim("c1")], dropped: 0, source: "on_device", candidates: 5, marked: 2 };
    const chip = withPageTasks(sourceChip(idle), claims, { phase: "ready", points: [1, 2, 3], source: "on_device" });
    expect(chip).toMatchObject({ src: "on_device", text: "On this device" });
    expect(chip.title).toMatch(/claims to check ran on this device\. The gist ran on this device\. Clean used no AI/);
    expect(chip.data).toMatchObject({ "data-claims": "2/5", "data-claims-marked": "2", "data-gist": "3", "data-tasks": "claims:on_device gist:on_device" });
  });
  it("is not On this device when one task ran in the cloud", () => {
    const claims: ClaimsState = { phase: "ready", claims: [claim("c0")], dropped: 0, source: "on_device" };
    expect(withPageTasks(sourceChip(idle), claims, { phase: "ready", points: [1], source: "in_cloud" }).src).toBe("in_cloud");
  });
  it("keeps Translate's chip and adds the claims to its title", () => {
    const done: TranslateState = { phase: "done", showingSource: false, from: "cs", source: "on_device", translated: 3, total: 3 };
    const claims: ClaimsState = { phase: "ready", claims: [claim("c0")], dropped: 0, source: "on_device" };
    const chip = withPageTasks(sourceChip(done), claims, noGist);
    expect(chip.text).toBe("On this device");
    expect(chip.title).toMatch(/translation from Czech ran on this device.*The claims to check ran on this device\.$/);
    expect(chip.data["data-translate"]).toBe("done");
  });
});
