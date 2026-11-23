// Tours started by hand (r4-08), the frame side: which tours are offered, their steps in order, and the strip's line.
import { describe, expect, it } from "vitest";
import type { ActionItem, ContactItem } from "../../messages";
import { buildTours, stepLine, type TourInput } from "./Tours";

const NOW = new Date("2026-11-23T12:00:00Z");
const none: TourInput = { gist: [], claims: [], byline: null, actions: [], contacts: [] };
const act = (id: string, kind: ActionItem["kind"], text: string, extra: Partial<ActionItem> = {}): ActionItem =>
  ({ id, kind, text, blockId: "w0", quote: text, ...extra });
const contact = (id: string, kind: ContactItem["kind"], text: string, extra: Partial<ContactItem> = {}): ContactItem =>
  ({ id, kind, text, hidden: false, ...extra });

// The village notice of the demo page caption-actions.html, as things to do and the contact finder see it.
const VILLAGE: TourInput = {
  ...none,
  byline: { from: "data", author: "Marie Svobodová", published: "2023-01-10T09:00:00+01:00" },
  actions: [
    act("a0", "payment", "Pay 800 Kč to 123456789/0100 by 31. 3. 2027"),
    act("a1", "bring", "Bring: občanský průkaz"),
    act("a2", "deadline", "By 28. 2. 2027"),
    act("a3", "hours", "Hours: Po, St 8:00 - 17:00", { value: "Po, St 8:00 - 17:00" }),
    act("a4", "contact", "Call 377 912 345", { href: "tel:+420377912345", value: "377 912 345" }),
    act("a5", "contact", "Write to poplatky@lipova-lhota.example", { href: "mailto:poplatky@lipova-lhota.example" }),
  ],
  contacts: [
    contact("k0", "phone", "+420 377 912 345", { href: "tel:+420377912345" }),
    contact("k1", "email", "poplatky@lipova-lhota.example", { href: "mailto:poplatky@lipova-lhota.example" }),
    contact("k2", "phone", "377 900 111", { href: "tel:377900111" }),
    contact("k3", "address", "Hlavní 1, 330 11 Lipová Lhota"),
    contact("k4", "email", "starosta@lipova-lhota.example", { href: "mailto:starosta@lipova-lhota.example", hidden: true }),
    contact("k5", "hours", "Po, St 8:00 - 17:00"),
  ],
};

describe("buildTours", () => {
  it("offers no tour when Distill found nothing, and no facts tour for a byline alone", () => {
    expect(buildTours(none, NOW)).toEqual([]);
    expect(buildTours({ ...none, byline: VILLAGE.byline }, NOW)).toEqual([]);
  });

  it("Call or write: the things to do first, then the finder's other numbers; none twice, none hidden", () => {
    const call = buildTours(VILLAGE, NOW).find((t) => t.id === "call");
    expect(call?.items.map((i) => i.label)).toEqual([
      "Hours: Po, St 8:00 - 17:00", "Call 377 912 345", "Write to poplatky@lipova-lhota.example", "Call 377 900 111",
    ]);
    expect(call?.items.map((i) => i.step)).toEqual([
      { kind: "action", id: "a3" }, { kind: "action", id: "a4" }, { kind: "action", id: "a5" }, { kind: "contact", id: "k2" },
    ]);
  });

  it("Before you go: a sum with its date, what to bring, the deadline, then the address", () => {
    const before = buildTours(VILLAGE, NOW).find((t) => t.id === "before");
    expect(before?.items.map((i) => i.label)).toEqual([
      "Pay 800 Kč to 123456789/0100 by 31. 3. 2027", "Bring: občanský průkaz", "Deadline: By 28. 2. 2027", "Address: Hlavní 1, 330 11 Lipová Lhota",
    ]);
    expect(before?.items[3]?.step).toEqual({ kind: "contact", id: "k3" });
  });

  it("an address among the things to do is not added again from the finder", () => {
    const tours = buildTours({ ...VILLAGE, actions: [act("a9", "contact", "Address: Hlavní 1, 330 11 Lipová Lhota", { value: "Hlavní 1, 330 11 Lipová Lhota" })] }, NOW);
    expect(tours.find((t) => t.id === "before")?.items.map((i) => i.step)).toEqual([{ kind: "action", id: "a9" }]);
    // ...and an address is no way to call or write.
    expect(tours.find((t) => t.id === "call")?.items.map((i) => i.label)).not.toContain("Address: Hlavní 1, 330 11 Lipová Lhota");
  });

  it("Just the facts: the points, the claims not already a point, then who wrote it and when (in the strip only)", () => {
    const facts = buildTours({
      ...VILLAGE,
      gist: [{ text: "The council approved trams.", blockId: "m0", sentence: "Councillors approved the plan." }],
      claims: [
        { id: "c0", blockId: "m0", text: "Councillors approved the plan.", why: "number" },
        { id: "c1", blockId: "m2", text: "The line will cost 400 million.", why: "number" },
      ],
    }, NOW).find((t) => t.id === "facts");
    expect(facts?.items.map((i) => i.label)).toEqual([
      "Main point 1: The council approved trams.",
      "Claim to check: The line will cost 400 million.",
      "Who wrote it and when: Marie Svobodová, published 10 January 2023, 09:00 (3 years ago)",
    ]);
    expect(facts?.items.map((i) => i.step)).toEqual([
      { kind: "text", blockId: "m0", sentence: "Councillors approved the plan." },
      { kind: "text", blockId: "m2", sentence: "The line will cost 400 million." },
      null,
    ]);
  });

  it("a page with only hidden contacts offers no call tour", () => {
    expect(buildTours({ ...none, contacts: [contact("k0", "phone", "123", { hidden: true })] }, NOW)).toEqual([]);
  });
});

describe("stepLine", () => {
  const tour = buildTours(VILLAGE, NOW).find((t) => t.id === "call")!;
  it("says the step, how many, and what it is", () => {
    expect(stepLine({ tour, index: 1, found: true })).toBe("Step 2 of 4 · Call 377 912 345");
  });
  it("says when a step is no longer on the page", () => {
    expect(stepLine({ tour, index: 0, found: false })).toBe("Step 1 of 4 · Hours: Po, St 8:00 - 17:00 (no longer on the page)");
  });
});
