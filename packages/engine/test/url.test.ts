import { describe, expect, it } from "vitest";
import { extractForm, extractPage } from "../src/index.js";
import { publicUrl } from "../src/url.js";
import { parse } from "./helpers.js";
import czech from "./fixtures/czech-residence-form.html?raw";

const LEAKY = "https://mv.example/zadost?email=zqx%40private.example&rc=870619#access_token=SECRET123";

describe("publicUrl", () => {
  it("keeps origin and path, drops query and fragment", () => {
    expect(publicUrl(LEAKY)).toBe("https://mv.example/zadost");
  });
  it("turns an unparseable or opaque address into an empty string", () => {
    expect(publicUrl("not a url")).toBe("");
    expect(publicUrl("data:text/html,<p>x</p>")).toBe("");
  });
  it("no model carries the query or fragment of the page address", async () => {
    const doc = parse(czech);
    const page = extractPage(doc, LEAKY);
    const form = await extractForm(doc, LEAKY);
    for (const s of [JSON.stringify(page), JSON.stringify(form)]) {
      expect(s).not.toContain("private.example");
      expect(s).not.toContain("870619");
      expect(s).not.toContain("SECRET123");
    }
    expect(form.url).toBe("https://mv.example/zadost");
  });
});
