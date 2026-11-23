// Tours started by hand (r4-08), the page side: a step highlights its exact words (a CSS highlight, no element added),
// stays on while the next one is not asked, finds its words again after a price or a date written your way split
// their text node (r3-07, distill:textsplit), outlines the place when the words are gone, and null takes it all away.
// The e2e (caption-tours.spec.ts) checks it in real Chromium with the strip.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readContacts } from "./contact";
import { TEXT_SPLIT_EVENT } from "./textSplit";
import { quoteRange, TOUR_ATTR, TOUR_HIGHLIGHT, tourShown, tourStep, wholeWords } from "./tour";

/** A stand-in for the browser's CSS highlight registry (happy-dom has none). */
class FakeHighlight extends Set<Range> { priority = 0; constructor(...r: Range[]) { super(r); } }
const reg = new Map<string, FakeHighlight>();
const shown = () => Array.from(reg.get(TOUR_HIGHLIGHT) ?? [], (r) => r.toString());

const PAGE = `<main><article>
  <p id="office">Úřední hodiny: Po, St 8:00 - 17:00. Informace na tel. 377 912 345 nebo e-mailem poplatky@obec.example.</p>
  <p id="addr">Obecní úřad<br>Hlavní 1<br>330 11 Lipová Lhota</p>
</article></main>`;

beforeEach(() => {
  document.body.innerHTML = PAGE;
  Object.assign(window, { Highlight: FakeHighlight, scrollTo: vi.fn() });
  Object.defineProperty(window, "CSS", { value: { highlights: reg }, configurable: true, writable: true });
  reg.clear();
});
afterEach(() => { tourStep(document, null); vi.useRealTimers(); });

describe("quoteRange", () => {
  it("finds words however the spaces run, and words over lines", () => {
    const office = document.getElementById("office") as Element;
    expect(quoteRange(document, office, "377  912 345")?.toString()).toBe("377 912 345");
    const addr = document.getElementById("addr") as Element;
    expect(quoteRange(document, addr, "Hlavní 1 330 11 Lipová Lhota")).not.toBeNull();
    expect(quoteRange(document, office, "nowhere")).toBeNull();
  });
});

describe("wholeWords", () => {
  it("widens a quote cut mid-word to the word's ends, and leaves whole words alone", () => {
    document.body.innerHTML = "<p id='h'>Pondělí-Pátek 9-18 hodin, Sobota</p>";
    const h = document.getElementById("h") as Element;
    const cut = quoteRange(document, h, "dělí-Pátek 9-18 h") as Range;
    wholeWords(cut);
    expect(cut.toString()).toBe("Pondělí-Pátek 9-18 hodin");
    const whole = quoteRange(document, h, "Sobota") as Range;
    wholeWords(whole);
    expect(whole.toString()).toBe("Sobota");
  });
});

describe("tourStep", () => {
  it("highlights a contact's exact words until the tour ends; nothing is added to the page", () => {
    const items = readContacts(document, []);
    const phone = items.find((i) => i.kind === "phone");
    expect(phone).toBeDefined();
    const before = document.body.innerHTML;
    expect(tourStep(document, { kind: "contact", id: phone!.id })).toBe(true);
    expect(shown()).toEqual(["377 912 345"]);
    expect(reg.get(TOUR_HIGHLIGHT)?.priority).toBe(2);
    expect(document.getElementById("distill-tour-style")).not.toBeNull();
    expect(tourShown()).toEqual({ kind: "contact", id: phone!.id });

    expect(tourStep(document, null)).toBe(true);
    expect(reg.has(TOUR_HIGHLIGHT)).toBe(false);
    expect(document.getElementById("distill-tour-style")).toBeNull();
    expect(document.body.innerHTML).toBe(before);
    expect(tourShown()).toBeNull();
  });

  it("the next step replaces the last one's highlight", () => {
    const items = readContacts(document, []);
    const phone = items.find((i) => i.kind === "phone")!;
    const mail = items.find((i) => i.kind === "email")!;
    tourStep(document, { kind: "contact", id: phone.id });
    tourStep(document, { kind: "contact", id: mail.id });
    expect(shown()).toEqual(["poplatky@obec.example"]);
  });

  it("finds its words again when a text node under it was split (distill:textsplit)", () => {
    vi.useFakeTimers();
    const phone = readContacts(document, []).find((i) => i.kind === "phone")!;
    tourStep(document, { kind: "contact", id: phone.id });
    // Split the paragraph's text node the way prices and dates in your terms do, then rejoin it in one go.
    const p = document.getElementById("office") as Element;
    const text = p.firstChild as Text;
    const rest = text.splitText(10);
    const span = document.createElement("span");
    span.setAttribute("data-distill-term", "date");
    rest.replaceWith(span);
    span.append(rest);
    // The DOM moved the old range when its node left: it no longer covers the number.
    expect(shown()).not.toEqual(["377 912 345"]);
    document.dispatchEvent(new Event(TEXT_SPLIT_EVENT));
    vi.advanceTimersByTime(200);
    expect(shown()).toEqual(["377 912 345"]);
  });

  it("a step whose part of the page is gone says so and leaves nothing highlighted", () => {
    const phone = readContacts(document, []).find((i) => i.kind === "phone")!;
    document.getElementById("office")?.remove();
    expect(tourStep(document, { kind: "contact", id: phone.id })).toBe(false);
    expect(reg.has(TOUR_HIGHLIGHT)).toBe(false);
  });

  it("without a highlight registry the place is outlined, and the outline goes with the tour", () => {
    reg.clear();
    Object.defineProperty(window, "CSS", { value: {}, configurable: true, writable: true });
    const phone = readContacts(document, []).find((i) => i.kind === "phone")!;
    expect(tourStep(document, { kind: "contact", id: phone.id })).toBe(true);
    expect(document.querySelectorAll(`[${TOUR_ATTR}]`)).toHaveLength(1);
    tourStep(document, null);
    expect(document.querySelectorAll(`[${TOUR_ATTR}]`)).toHaveLength(0);
  });

  it("a part Clean hid is no step (Original shows it)", () => {
    const phone = readContacts(document, []).find((i) => i.kind === "phone")!;
    document.getElementById("office")?.setAttribute("data-distill-hide", "x");
    expect(tourStep(document, { kind: "contact", id: phone.id })).toBe(false);
  });
});
