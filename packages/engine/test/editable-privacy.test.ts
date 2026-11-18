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

  it("nor does an ARIA widget that shows a value: a suggestion list repeating the search, a role=textbox, a combobox's choice", () => {
    const doc = parse(`<!doctype html><html lang="en"><head><title>Find an office</title></head><body><main>
      <h1>Find your office</h1>
      <p>Type your street to see the office that serves it.</p>
      <input role="combobox" aria-controls="sug" aria-expanded="true">
      <ul id="sug" role="listbox"><li role="option">SUGGEST-SECRET-3310 Street, Prague</li><li role="option">SUGGEST-SECRET-3310a Street, Brno</li></ul>
      <div role="textbox">ROLE-TEXTBOX-SECRET-2290</div>
      <div role="spinbutton" aria-valuenow="4">SPIN-SECRET-77</div>
      <div role="combobox" aria-expanded="false">CHOSEN-SECRET-5150</div>
      <p>Offices are open on Monday and Wednesday.</p>
    </main></body></html>`);
    const page = extractPage(doc, "https://office.example/find");
    const all = [JSON.stringify(page), prompts.classifyPage(page), prompts.simplifyBlocks(page, "plain", "en"), prompts.recast(page, ["summary"])];
    for (const s of all) for (const secret of ["SUGGEST-SECRET", "ROLE-TEXTBOX-SECRET", "SPIN-SECRET", "CHOSEN-SECRET"]) expect(s).not.toContain(secret);
    expect(JSON.stringify(page)).toContain("Offices are open on Monday and Wednesday.");
  });
});
