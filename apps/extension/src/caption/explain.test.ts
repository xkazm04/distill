// Explain this word (r4-05), the page side: which selections get the Explain button, the answer from the page with no
// model, the ask to this tab's strip and its answer, and that the note goes (Escape, a press elsewhere, Original, close).
// The e2e (caption-explain.spec.ts) checks it in a real browser with the strip and the stand-in model.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CleanContext } from "./context";
import { clearExplain, explainShown, explainWords, NOTE_TAG, SETTLE_MS, sentenceOf, showExplanation } from "./explain";

const PAGE = `
<nav id="nav">Daně OSVČ Kontakt</nav>
<main id="main"><article>
  <p id="p1">OSVČ mohou při vyplňování daňového přiznání uplatnit různé slevy. Přehledy se podávají do 30 dnů.</p>
  <p id="p2">Plátci daně z přidané hodnoty (DPH) podávají kontrolní hlášení. Každý plátce DPH musí mít datovou schránku.</p>
  <form><input id="field" value="OSVČ v poli"><textarea id="area">OSVČ v textu</textarea></form>
</article></main>
<div id="tags">Daňové přiznání OSVČ (osoby samostatně výdělečně činné) datová schránka</div>`;

let sent: unknown[] = [];

function setup(): CleanContext {
  document.body.innerHTML = PAGE;
  const ps = ["p1", "p2"].map((id) => document.getElementById(id) as Element);
  return { doc: document, win: window, keep: ps, body: ps, main: document.getElementById("main"), protect: [], removed: new Map() };
}

/** Selects `words` inside the element `id` (its first text node), as a drag would, and lets the selection settle. */
function select(id: string, words: string): void {
  const el = document.getElementById(id) as HTMLElement;
  const node = el.firstChild as Text;
  const at = node.data.indexOf(words);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + words.length);
  const sel = document.getSelection() as Selection;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  vi.advanceTimersByTime(SETTLE_MS + 10);
}

const note = () => document.querySelector(NOTE_TAG)?.shadowRoot ?? null;
const button = (name: string) => Array.from(note()?.querySelectorAll("button") ?? []).find((b) => b.textContent === name) ?? null;

describe("explain this word on the page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    (globalThis as { chrome?: unknown }).chrome = { runtime: { sendMessage: (m: unknown) => { sent.push(m); return Promise.resolve(); } } };
    explainWords(setup(), 7);
  });
  afterEach(() => { clearExplain(document); document.getSelection()?.removeAllRanges(); vi.useRealTimers(); });

  it("a word selected in the main text gets the Explain button beside it", () => {
    select("p1", "OSVČ");
    expect(explainShown()).toMatchObject({ phase: "offer", term: "OSVČ" });
    expect(button("Explain")?.getAttribute("aria-label")).toBe('Explain "OSVČ"');
    expect(document.querySelectorAll(NOTE_TAG)).toHaveLength(1);
  });

  it("no button outside the main text, in a form field, or for a selection longer than TERM_MAX", () => {
    select("nav", "OSVČ");
    expect(explainShown()).toBeNull();
    select("tags", "OSVČ");
    expect(explainShown()).toBeNull();
    (document.getElementById("area") as HTMLTextAreaElement).focus();
    select("area", "OSVČ");
    expect(explainShown()).toBeNull();
    (document.activeElement as HTMLElement).blur();
    select("p1", "OSVČ mohou při vyplňování daňového přiznání uplatnit různé slevy. Přehledy se podávají do 30 dnů.");
    expect(explainShown()).toBeNull();
  });

  it("an abbreviation the main text spells out is explained from the page, with nothing sent", () => {
    select("p2", "DPH");
    button("Explain")?.click();
    expect(explainShown()).toMatchObject({ phase: "shown", term: "DPH", text: "daně z přidané hodnoty", source: "page" });
    expect(note()?.textContent).toContain("From this page");
    expect(sent).toHaveLength(0);
  });

  it("one spelled out elsewhere on the page (its tag list) is explained from the page too", () => {
    select("p1", "OSVČ");
    button("Explain")?.click();
    expect(explainShown()).toMatchObject({ phase: "shown", text: "osoby samostatně výdělečně činné", source: "page" });
    expect(sent).toHaveLength(0);
  });

  it("otherwise this tab's strip is asked with the words and their sentence, and its answer is shown", () => {
    select("p1", "daňového přiznání");
    button("Explain")?.click();
    expect(explainShown()).toMatchObject({ phase: "asking" });
    expect(sent).toEqual([{
      type: "distill:caption:explainAsk", tabId: 7, id: expect.stringMatching(/^x\d+$/), term: "daňového přiznání",
      sentence: "OSVČ mohou při vyplňování daňového přiznání uplatnit různé slevy.",
    }]);
    const id = (sent[0] as { id: string }).id;
    showExplanation(document, "x-other", "Not for this one.", "on_device");
    expect(explainShown()?.phase).toBe("asking");
    showExplanation(document, id, "A yearly tax return. <b>not markup</b>", "on_device");
    expect(explainShown()).toMatchObject({ phase: "shown", source: "on_device", text: "A yearly tax return. <b>not markup</b>" });
    expect(note()?.querySelector("b")).toBeNull();
    expect(note()?.textContent).toContain("On this device");
  });

  it("a refusal from the strip says why", () => {
    select("p1", "slevy");
    button("Explain")?.click();
    const id = (sent[0] as { id: string }).id;
    showExplanation(document, id, "Explaining is off: this copy of Distill has no AI set up.", "refused");
    expect(explainShown()).toMatchObject({ phase: "shown", source: "refused" });
    expect(note()?.textContent).toContain("Not explained");
  });

  it("Escape, a press elsewhere, Close, Original and close take it down", () => {
    select("p1", "slevy");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(explainShown()).toBeNull();

    select("p2", "DPH");
    button("Explain")?.click();
    document.getElementById("p1")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(explainShown()).toBeNull();

    select("p2", "kontrolní");
    button("Explain")?.click();
    button("Close")?.click();
    expect(explainShown()).toBeNull();

    select("p1", "slevy");
    document.documentElement.setAttribute("data-distill-original", "");
    return Promise.resolve().then(() => {
      expect(explainShown()).toBeNull();
      document.documentElement.removeAttribute("data-distill-original");
      clearExplain(document);
      expect(document.querySelectorAll(NOTE_TAG)).toHaveLength(0);
      select("p1", "slevy");
      expect(explainShown()).toBeNull();
    });
  });

  it("Tab moves to the button; Tab again gives the key back to the page", () => {
    select("p1", "slevy");
    const tab = (shift = false) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true, composed: true }));
    expect(tab()).toBe(false);
    expect(document.activeElement?.tagName.toLowerCase()).toBe(NOTE_TAG);
    tab();
    expect(document.activeElement).not.toBe(document.querySelector(NOTE_TAG));
    expect(tab()).toBe(true); // not taken again for the same selection
  });
});

describe("sentenceOf", () => {
  it("the sentence holding the words", () => {
    expect(sentenceOf("První věta. Druhá věta s DPH. Třetí.", "DPH")).toBe("Druhá věta s DPH.");
  });
  it("cut around the words when the sentence is very long", () => {
    const s = sentenceOf(`${"slovo ".repeat(200)}DPH ${"slovo ".repeat(200)}`, "DPH");
    expect(s.length).toBeLessThanOrEqual(600);
    expect(s).toContain("DPH");
  });
});
