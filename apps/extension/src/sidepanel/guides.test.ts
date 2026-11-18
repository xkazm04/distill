// The extension carries the guide library inside its bundle (virtual:distill-guides, scripts/guides/library.mjs), so
// the public build, which never calls the cloud, looks a guide up with no network at all. And no build a person uses
// carries a draft guide.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import library from "virtual:distill-guides";
import { extractForm, matchGuide } from "@distill/engine";
import { guideLibrary } from "@distill/web/ui";
import demoHtml from "../../../web/public/demo/form.html?raw";
import { libraryJson } from "../../../../scripts/guides/library.mjs";

afterEach(() => { vi.unstubAllGlobals(); });

describe("the bundled guide library", () => {
  it("is the repository's library without its drafts: reviewed guides and the demo guide only", () => {
    expect(library).toEqual(libraryJson(false));
    const guides = library.guides as { id: string; status: string; demo?: boolean }[];
    expect(guides.map((g) => g.id)).toContain("cz/demo-form");
    for (const g of guides) expect(g.status === "reviewed" || g.demo === true, g.id).toBe(true);
  });

  it("finds the demo form's guide on this device: no fetch, no XMLHttpRequest, no beacon", async () => {
    const fetchSpy = vi.fn(() => { throw new Error("network used"); });
    const xhr = vi.fn(() => { throw new Error("network used"); });
    const beacon = vi.fn(() => { throw new Error("network used"); });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhr);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon });

    const guides = guideLibrary(async () => library);
    const doc = new DOMParser().parseFromString(demoHtml, "text/html");
    const s = await extractForm(doc, "http://127.0.0.1:4321/demo/form.html");
    const m = matchGuide(s, await guides.load(), { drafts: guides.drafts });
    expect(m?.guide.id).toBe("cz/demo-form");
    expect(m?.exact).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe("libraryJson (what a build carries)", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

  it("leaves drafts out unless a developer turns drafts on; the demo guide is always in", () => {
    dir = mkdtempSync(join(tmpdir(), "guides-"));
    mkdirSync(join(dir, "cz"));
    const write = (id: string, g: object) => writeFileSync(join(dir, "cz", `${id}.json`), JSON.stringify({ id: `cz/${id}`, ...g }));
    write("checked", { status: "reviewed" });
    write("draft", { status: "draft" });
    write("demo", { status: "draft", demo: true });
    writeFileSync(join(dir, "cz", "broken.json"), "{ not json");
    const ids = (drafts: boolean) => (libraryJson(drafts, dir).guides as { id: string }[]).map((g) => g.id);
    expect(ids(false)).toEqual(["cz/checked", "cz/demo"]);
    expect(ids(true)).toEqual(["cz/checked", "cz/demo", "cz/draft"]);
  });
});
