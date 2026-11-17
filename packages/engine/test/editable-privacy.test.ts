import { describe, expect, it } from "vitest";
import { extractPage, prompts } from "../src/index.js";
import { parse } from "./helpers.js";

// Found by the bp adoption judgement (2026-11-17): outside a <form>, the text a person typed into a contenteditable
// editor or a textarea reached the PageModel, which feeds cloud-eligible prompts.
const PAGE = `<!doctype html><html lang="en"><head><title>Inbox</title></head><body>
  <main>
    <h1>Your messages</h1>
    <p>Write a reply to the housing office below.</p>
    <div contenteditable="true" class="compose"><p>Dear office, my passport number is ZQ9988776 and I owe nothing.</p></div>
    <textarea name="note">Private draft TX-SECRET-4411</textarea>
    <div role="textbox" contenteditable="plaintext-only">RICH-SECRET-7731</div>
    <p>Messages are kept for 30 days.</p>
  </main></body></html>`;

describe("typed text outside a form", () => {
  it("never enters the page model or any page prompt", () => {
    const doc = parse(PAGE);
    const ta = doc.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "Typed reply TYPED-SECRET-5521";
    const page = extractPage(doc, "https://mail.example/inbox?thread=1");
    const all = [JSON.stringify(page), prompts.classifyPage(page), prompts.simplifyBlocks(page, "plain", "en"), prompts.recast(page, ["summary"])];
    for (const s of all) {
      for (const secret of ["ZQ9988776", "TX-SECRET-4411", "RICH-SECRET-7731", "TYPED-SECRET-5521"]) expect(s).not.toContain(secret);
    }
    // The page's own text still comes through.
    expect(JSON.stringify(page)).toContain("Write a reply to the housing office below.");
    expect(JSON.stringify(page)).toContain("Messages are kept for 30 days.");
  });
});
