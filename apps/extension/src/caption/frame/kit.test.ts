// Round 5, r5-04 and r5-09: the strip's kit. Icons draw in the text's own colour only; a count reads as "(3)"; waiting
// is a placeholder with words and no spinner, still under reduced motion; failed says why and offers Try again only
// when given one; the kit's CSS holds no colour literal and moves only when motion is welcome.
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionRow, Empty, FactRow, Facts, Failed, Icon, ICON_KINDS, ListHeader, ReachLink, Rows, Section, sentence, Switch, Waiting } from "./kit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let el: HTMLElement;
let root: Root;
const render = async (node: React.ReactElement) => { await act(async () => { root.render(node); }); };
beforeEach(() => { el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
afterEach(async () => { await act(async () => root.unmount()); el.remove(); });

const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/i;

describe("Icon", () => {
  it("has one line icon per kind, in currentColor, hidden from assistive tech", async () => {
    await render(createElement("div", null, ...ICON_KINDS.map((k) => createElement(Icon, { kind: k, key: k }))));
    const svgs = Array.from(el.querySelectorAll("svg"));
    expect(svgs).toHaveLength(ICON_KINDS.length);
    for (const svg of svgs) {
      expect(svg.getAttribute("stroke")).toBe("currentColor");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M/);
      expect(svg.outerHTML).not.toMatch(LITERAL);
    }
  });
  it("covers every kind the card names", () => {
    for (const k of ["deadline", "payment", "bring", "phone", "email", "address", "hours", "contactPage", "price", "stock", "delivery",
      "warranty", "returns", "spec", "chapter", "sponsor", "published", "updated", "author", "claim"]) expect(ICON_KINDS).toContain(k);
  });
});

describe("headers and sections", () => {
  it("reads a count as 'Title (3)' while showing it as a pill", async () => {
    await render(createElement(ListHeader, { id: "h", title: "Claims to check", count: 3 }));
    const h = el.querySelector("h2")!;
    expect(h.textContent).toBe("Claims to check (3)");
    expect(h.querySelector(".k-count")?.textContent).toBe("(3)");
  });
  it("labels a section by its header and passes its data attributes", async () => {
    await render(createElement(Section, { id: "x-h", title: "Contact", testid: "cap-x", attrs: { "data-phase": "ready" } }, "body"));
    const s = el.querySelector("section")!;
    expect(s.getAttribute("aria-labelledby")).toBe("x-h");
    expect(s.dataset.testid).toBe("cap-x");
    expect(s.dataset.phase).toBe("ready");
    expect(s.hasAttribute("aria-busy")).toBe(false);
  });
});

describe("found data", () => {
  it("a fact row: label, value, where it came from", async () => {
    await render(createElement(Facts, null, createElement(FactRow, { icon: "price", label: "Price", value: "1 290 Kč", from: "From data", emphasis: "strong", testid: "f" })));
    const row = el.querySelector("[data-testid=f]")!;
    expect(row.querySelector("dt")?.textContent).toBe("Price");
    expect(row.querySelector("dd")?.textContent).toBe("1 290 Kč");
    expect(row.querySelector(".k-from")?.textContent).toBe("From data");
    expect(row.className).toContain("k-fact-strong");
  });
  it("an action row: kind, words, quieter line, acts; Call and Write only for tel: and mailto:", async () => {
    await render(createElement(Rows, { ordered: true }, createElement(ActionRow, {
      icon: "phone", kind: "Contact", text: "Call 377 912 345", sub: "the page's words", testid: "r",
      acts: createElement("span", null, createElement(ReachLink, { href: "tel:+420377912345" }), createElement(ReachLink, { href: "mailto:a@b.cz" }), createElement(ReachLink, { href: "https://x.cz" })),
    })));
    expect(el.querySelector("ol.k-rows > li.k-row")).not.toBeNull();
    expect(el.querySelector(".k-kind")?.textContent).toBe("Contact");
    expect(Array.from(el.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("target")])).toEqual([["Call", "_top"], ["Write", "_top"]]);
  });
});

describe("waiting, empty, failed (r5-09)", () => {
  it("waits in the shape of what is coming, with words, and no spinner", async () => {
    await render(createElement(Waiting, { label: "Looking for claims to check...", rows: 3, testid: "w" }));
    const w = el.querySelector("[data-testid=w]")!;
    expect(w.getAttribute("role")).toBe("status");
    expect(w.textContent).toBe("Looking for claims to check...");
    expect(w.querySelectorAll(".k-wait-bar")).toHaveLength(3);
    expect(w.querySelector(".k-wait-bars")?.getAttribute("aria-hidden")).toBe("true");
    expect(w.outerHTML).not.toMatch(/spin/i);
  });
  it("is empty in one short line", async () => {
    await render(createElement(Empty, { testid: "e" }, "No date on this page."));
    expect(el.querySelector("p.k-empty")?.textContent).toBe("No date on this page.");
  });
  it("fails in one line, with Try again only where it can help", async () => {
    const retry = vi.fn();
    await render(createElement("div", null,
      createElement(Failed, { why: "No gist: the AI is busy right now.", onRetry: retry, testid: "f1", retryTestid: "again" }),
      createElement(Failed, { why: "No gist: AI is off in this copy of Distill.", testid: "f2" })));
    const f1 = el.querySelector("[data-testid=f1]")!;
    expect(f1.getAttribute("role")).toBe("status");
    expect(f1.textContent).toBe("No gist: the AI is busy right now.Try again");
    await act(async () => { el.querySelector<HTMLButtonElement>("[data-testid=again]")!.click(); });
    expect(retry).toHaveBeenCalledOnce();
    expect(el.querySelector("[data-testid=f2] button")).toBeNull();
  });
  it("words a failure as one sentence", () => {
    expect(sentence("Not looked for", "the AI is busy right now")).toBe("Not looked for: the AI is busy right now.");
    expect(sentence("No answer", "AI is off.")).toBe("No answer: AI is off.");
    expect(sentence("No gist", undefined)).toBe("No gist: something went wrong.");
  });
});

describe("Switch", () => {
  it("is a real checkbox with the switch role", async () => {
    const on = vi.fn();
    await render(createElement(Switch, { checked: false, onChange: on, label: "Dark page", testid: "s" }));
    const input = el.querySelector<HTMLInputElement>("[data-testid=s]")!;
    expect(input.type).toBe("checkbox");
    expect(input.getAttribute("role")).toBe("switch");
    await act(async () => { input.click(); });
    expect(on).toHaveBeenCalledWith(true);
  });
});

describe("kit.css", () => {
  const css = readFileSync(join(__dirname, "kit.css"), "utf8");
  it("holds no colour literal: theme roles only", () => {
    expect(css).not.toMatch(LITERAL);
  });
  it("moves only when motion is welcome", () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/animation\s*:|transition\s*:/);
    expect(css).toMatch(/prefers-reduced-motion: no-preference[\s\S]*animation: k-breathe/);
  });
  it("draws a clear focus ring on every control of a section", () => {
    expect(css).toMatch(/:focus-visible \{ outline: 3px solid var\(--focus\)/);
  });
});
